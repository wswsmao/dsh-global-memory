import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addEntry, changeEntry, emptyStore, updateEntry, validateEntryInput } from '../lib/model.js'
import { viewStore } from '../lib/render.js'
import { ROUTE_PREFIX, registerRoute } from '../lib/route.js'

const OPTIONS = { budgetTokens: 1200, textLanguage: 'auto' }

/** A fake context plus a host half backed by a real in-memory store. */
function makeHarness(initial = emptyStore()) {
  const registered = []
  const ctx = {
    webServer: { register: (route) => { registered.push(route); return () => {} } },
    connection: { requestRejection: () => undefined },
    effect: (factory) => factory(),
  }
  const state = { store: initial, commits: 0, reloads: 0 }
  const host = {
    prefix: ROUTE_PREFIX,
    ready: Promise.resolve(),
    read: () => state.store,
    view: () => viewStore(state.store, OPTIONS),
    commit: async (next) => { state.store = next; state.commits += 1 },
    // Mirrors the host half: reload re-reads storage and adopts what it found.
    reload: async () => { state.reloads += 1; return state.store },
    validate: validateEntryInput,
    add: (value) => addEntry(state.store, value),
    update: (id, value) => updateEntry(state.store, id, value),
    change: (id, change) => changeEntry(state.store, id, change),
    onError: () => {},
  }
  registerRoute(ctx, host)
  return { ctx, registered, state, host }
}

/**
 * Drive one request through the registered handler.
 *
 * The body is delivered on the next macrotask rather than synchronously: the
 * handler awaits `host.ready` before attaching its `data` listener, so a body
 * pushed during the same tick would be emitted before anyone was listening —
 * which would test the fixture, not the route.
 */
async function call(handler, { method = 'POST', path, body } = {}) {
  const listeners = {}
  const req = {
    method,
    url: path,
    on: (event, callback) => { listeners[event] = callback; return req },
    destroy: () => {},
  }
  let statusCode = 0
  let payload = ''
  const res = {
    setHeader: () => {},
    end: (value) => { payload = value ?? '' },
    get statusCode() { return statusCode },
    set statusCode(value) { statusCode = value },
  }
  const done = handler(req, res)
  if (body !== undefined || method !== 'GET') {
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body), 'utf8'))
    listeners.end?.()
  }
  await done
  return { status: statusCode, json: payload === '' ? null : JSON.parse(payload) }
}

test('the API is mounted under the plugin prefix', () => {
  const { registered } = makeHarness()
  assert.equal(registered.length, 1)
  assert.equal(registered[0].path, ROUTE_PREFIX)
})

test('GET /state returns the current store and usage', async () => {
  const { registered } = makeHarness()
  const result = await call(registered[0].handler, { method: 'GET', path: `${ROUTE_PREFIX}/state` })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.deepEqual(result.json.state.entries, [])
  assert.equal(result.json.state.usage.budget, 1200)
})

test('adding an entry persists it and returns the new state', async () => {
  const { registered, state } = makeHarness()
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/add`,
    body: { revision: 0, text: '回答一律用中文', tags: ['style'] },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.state.entries.length, 1)
  assert.equal(result.json.state.entries[0].text, '回答一律用中文')
  assert.equal(state.commits, 1)
})

test('a write built on a stale revision is refused, not merged', async () => {
  const { registered, state } = makeHarness()
  await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/add`,
    body: { revision: 0, text: '第一条', tags: [] },
  })
  const stale = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/add`,
    body: { revision: 0, text: '第二条', tags: [] },
  })
  assert.equal(stale.status, 409)
  assert.equal(stale.json.code, 'stale_revision')
  // The second write must not land: the user has to look first.
  assert.equal(state.store.entries.length, 1)
  assert.equal(state.commits, 1)
})

test('a write without a revision is refused', async () => {
  const { registered } = makeHarness()
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/add`,
    body: { text: '回答一律用中文' },
  })
  assert.equal(result.status, 400)
  assert.match(result.json.message, /revision/)
})

test('an invalid entry is refused with the model reason', async () => {
  const { registered } = makeHarness()
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/add`,
    body: { revision: 0, text: '   ' },
  })
  assert.equal(result.status, 400)
  assert.match(result.json.message, /不能为空/)
})

test('changing an entry toggles it', async () => {
  const { registered, state } = makeHarness()
  await call(registered[0].handler, { path: `${ROUTE_PREFIX}/add`, body: { revision: 0, text: '回答一律用中文', tags: [] } })
  const id = state.store.entries[0].id
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/change`,
    body: { revision: 1, id, enabled: false },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.state.entries[0].enabled, false)
})

test('removing an entry deletes it', async () => {
  const { registered, state } = makeHarness()
  await call(registered[0].handler, { path: `${ROUTE_PREFIX}/add`, body: { revision: 0, text: '回答一律用中文', tags: [] } })
  const id = state.store.entries[0].id
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/change`,
    body: { revision: 1, id, removed: true },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.state.entries.length, 0)
})

test('a change to an unknown entry reports not-found', async () => {
  const { registered } = makeHarness()
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/change`,
    body: { revision: 0, id: 'missing', removed: true },
  })
  assert.equal(result.status, 404)
})

test('updating an entry rewrites its text', async () => {
  const { registered, state } = makeHarness()
  await call(registered[0].handler, { path: `${ROUTE_PREFIX}/add`, body: { revision: 0, text: '旧内容', tags: [] } })
  const id = state.store.entries[0].id
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/update`,
    body: { revision: 1, id, text: '新内容', tags: [] },
  })
  assert.equal(result.status, 200)
  assert.equal(result.json.state.entries[0].text, '新内容')
})

test('the trust fence rejects before the store is touched', async () => {
  const { ctx, registered, state } = makeHarness()
  ctx.connection.requestRejection = () => 401
  const result = await call(registered[0].handler, {
    path: `${ROUTE_PREFIX}/add`,
    body: { revision: 0, text: '回答一律用中文', tags: [] },
  })
  assert.equal(result.status, 401)
  assert.equal(result.json, null)
  assert.equal(state.commits, 0)
})

test('an unknown sub-route is refused', async () => {
  const { registered } = makeHarness()
  const result = await call(registered[0].handler, { path: `${ROUTE_PREFIX}/nuke`, body: {} })
  assert.equal(result.status, 404)
})

test('a GET to a mutation route is refused', async () => {
  const { registered } = makeHarness()
  const result = await call(registered[0].handler, { method: 'GET', path: `${ROUTE_PREFIX}/add` })
  assert.equal(result.status, 405)
})

test('reload re-reads storage and returns the fresh state', async () => {
  // The regression this guards: the host keeps the document in memory, so an
  // edit made outside the process stayed invisible in both the page and the
  // prompt until a full restart.
  const { registered, state } = makeHarness()
  const seeded = addEntry(state.store, { text: '旧内容', tags: [] }, 1000)
  state.store = seeded
  // Simulate another process rewriting the file, then reloading.
  const rewritten = addEntry({ ...seeded, entries: [] }, { text: '外部写入的内容', tags: [] }, 2000)
  state.store = rewritten
  const result = await call(registered[0].handler, { path: `${ROUTE_PREFIX}/reload` })
  assert.equal(result.status, 200)
  assert.equal(result.json.ok, true)
  assert.equal(state.reloads, 1)
  assert.equal(result.json.state.entries[0].text, '外部写入的内容')
})

test('reload does not require a revision', async () => {
  // Reload is a read of the medium, not a write built on a prior read, so the
  // optimistic-lock precondition that guards mutations must not apply here.
  const { registered, state } = makeHarness()
  const result = await call(registered[0].handler, { path: `${ROUTE_PREFIX}/reload` })
  assert.equal(result.status, 200)
  assert.equal(state.reloads, 1)
})

test('reload never commits a write', async () => {
  const { registered, state } = makeHarness()
  await call(registered[0].handler, { path: `${ROUTE_PREFIX}/reload` })
  assert.equal(state.commits, 0)
})
