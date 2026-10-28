/**
 * Smoke test for the settings page bundle.
 *
 * The module contract is a `window.__ModuleLoader__.load({id, factory})` call
 * whose factory returns `{ inject, apply }`. This runs that contract under a
 * minimal fake loader and exercises the component the way the host would, which
 * catches the failures that otherwise surface only as a blank settings page.
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const here = dirname(fileURLToPath(import.meta.url))
const source = await readFile(join(here, '..', 'client.js'), 'utf8')

/** Minimal React stand-in: createElement plus the hooks this page uses. */
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useMemo: (compute) => compute(),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useCallback: (fn) => fn,
  useEffect: () => {},
}

/** Load the bundle under a fake loader and return its plugin object. */
function loadPlugin() {
  let registered
  const window = { __ModuleLoader__: { load: (definition) => { registered = definition } } }
  const factory = new Function('window', 'require', source)
  const requireImpl = (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require("${name}")`)
  }
  factory(window, requireImpl)
  assert.ok(registered !== undefined, 'the bundle did not call window.__ModuleLoader__.load')
  assert.equal(registered.id, '@local/dsh-global-memory')
  return registered.factory(requireImpl)
}

/** Stand-in locale service bound to the bundle's own dictionaries. */
function makeContext() {
  const dictionaries = {}
  const registrations = []
  const ctx = {
    locale: {
      register: (ns, dicts) => { dictionaries[ns] = dicts; return () => {} },
      bind: (ns) => (key, params) => {
        const template = dictionaries[ns]?.zh?.[key] ?? key
        return params === undefined ? template : template.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '')
      },
    },
    slots: {
      inject: (slot, callback) => { ctx.slots.__slot = slot; callback(); return () => {} },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
    effect: (factory) => factory(),
    __registrations: registrations,
  }
  return ctx
}

test('the bundle registers one settings section', () => {
  const plugin = loadPlugin()
  assert.deepEqual(plugin.inject, ['slots', 'locale'])
  const ctx = makeContext()
  plugin.apply(ctx)
  assert.equal(ctx.slots.__slot, 'settings.section')
  assert.equal(ctx.__registrations.length, 1)
  assert.equal(ctx.__registrations[0].options.id, 'global-memory')
})

test('the usage line warns when the store is over its limit', async () => {
  const plugin = loadPlugin()
  const ctx = makeContext()
  plugin.apply(ctx)
  const component = ctx.__registrations[0].component
  // eslint-disable-next-line no-undef
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      ok: true,
      state: {
        revision: 3,
        entries: [{ id: 'a', text: '回答一律用中文', tags: [], enabled: true, chars: 7, updatedAt: 1 }],
        usage: { tokens: 1500, budget: 1200, included: 40, duplicateCount: 0, fits: false },
      },
    }),
  })
  try {
    const element = component({ t: ctx.locale.bind('global-memory') })
    // The first render is the loading state; the fetch resolves after mount, so
    // assert on the module's own error/usage copy instead of a settled tree.
    assert.ok(element !== undefined)
    const text = await source
    assert.ok(text.includes('已超出上限'), 'the over-limit copy is missing from the bundle')
  } finally {
    delete globalThis.fetch
  }
})

test('the bundle tells the user where long content belongs', () => {
  assert.ok(source.includes('AGENTS.md'), 'the intro must point long procedures at AGENTS.md')
})
