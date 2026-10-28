/**
 * The memory store: what a memory is, and the invariants that keep it usable.
 *
 * Deliberately free of Cordis and of zod: the fold and every rule here are pure
 * functions over plain JSON, so they can be unit-tested without a harness and
 * cannot accidentally depend on the plugin's lifecycle.
 *
 * @module global-memory/model
 */

/** Storage format version. Bumped only for changes a migration must repair. */
export const STORE_VERSION = 1

/** Longest text a single entry may hold before the write is refused. */
export const MAX_ENTRY_CHARS = 2000

/** An empty store; also the `DomainSpec.global.initial` value. */
export function emptyStore() {
  return { version: STORE_VERSION, revision: 0, entries: [] }
}

/**
 * Whether two texts say the same thing after normalization.
 *
 * Used only for the read-time duplicate collapse (see `render.js`), never to
 * reject a write: a user who types the same sentence twice may be doing it on
 * purpose, and silently merging would lose the second edit.
 * @param {string} text - entry text.
 * @returns {string} comparison key.
 */
export function normalizeText(text) {
  return String(text)
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[。；;.!！,，、]+$/u, '')
    .toLowerCase()
}

/** Total characters across all entries, ignoring enabled state. */
export function totalChars(store) {
  let total = 0
  for (const entry of store?.entries ?? []) total += [...String(entry.text)].length
  return total
}

/** Entries that contribute to the injected block, in stable order. */
export function injectableEntries(store) {
  return (store?.entries ?? []).filter((entry) => entry.enabled !== false)
}

/**
 * Validate one candidate entry.
 * @param {{text?: unknown, title?: unknown, tags?: unknown}} input - proposed values.
 * @returns {{ok: true, value: {text: string, title: string|undefined, tags: string[]}} | {ok: false, reason: string}} result.
 */
export function validateEntryInput(input) {
  const raw = typeof input?.text === 'string' ? input.text : ''
  const text = raw.trim()
  if (text === '') return { ok: false, reason: '内容不能为空。' }
  const length = [...text].length
  if (length > MAX_ENTRY_CHARS) {
    return { ok: false, reason: `单条最长 ${MAX_ENTRY_CHARS} 字，当前 ${length} 字。请拆分，或把这段内容放进 skill / 项目的 AGENTS.md。` }
  }
  const title = typeof input?.title === 'string' && input.title.trim() !== '' ? input.title.trim() : undefined
  const tags = Array.isArray(input?.tags)
    ? [...new Set(input.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim()).filter((tag) => tag !== ''))]
    : []
  return { ok: true, value: { text, title, tags } }
}

/** Mint an entry identity. Not security-sensitive; only needs to be unique here. */
export function newEntryId(seed = Date.now()) {
  const random = Math.random().toString(36).slice(2, 8)
  return `m${seed.toString(36)}${random}`
}

/**
 * Add one entry.
 * @param {object} store - current store.
 * @param {{text: string, title?: string, tags: string[]}} value - validated input.
 * @param {number} now - timestamp.
 * @returns {object} the next store.
 */
export function addEntry(store, value, now = Date.now()) {
  const entry = {
    id: newEntryId(now),
    text: value.text,
    ...value.title === undefined ? {} : { title: value.title },
    tags: value.tags,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
  return { ...store, revision: store.revision + 1, entries: [...store.entries, entry] }
}

/**
 * Replace one entry's editable fields.
 * @param {object} store - current store.
 * @param {string} id - entry identity.
 * @param {{text: string, title?: string, tags: string[]}} value - validated input.
 * @param {number} now - timestamp.
 * @returns {object|undefined} the next store, or undefined when the id is unknown.
 */
export function updateEntry(store, id, value, now = Date.now()) {
  const index = store.entries.findIndex((entry) => entry.id === id)
  if (index < 0) return undefined
  const previous = store.entries[index]
  const next = {
    ...previous,
    text: value.text,
    tags: value.tags,
    updatedAt: now,
    ...value.title === undefined ? { title: undefined } : { title: value.title },
  }
  if (value.title === undefined) delete next.title
  const entries = [...store.entries]
  entries[index] = next
  return { ...store, revision: store.revision + 1, entries }
}

/**
 * Toggle or remove one entry.
 * @param {object} store - current store.
 * @param {string} id - entry identity.
 * @param {{enabled?: boolean, removed?: boolean}} change - the intended change.
 * @param {number} now - timestamp.
 * @returns {object|undefined} the next store, or undefined when the id is unknown.
 */
export function changeEntry(store, id, change, now = Date.now()) {
  const index = store.entries.findIndex((entry) => entry.id === id)
  if (index < 0) return undefined
  if (change.removed === true) {
    return {
      ...store,
      revision: store.revision + 1,
      entries: store.entries.filter((entry) => entry.id !== id),
    }
  }
  if (typeof change.enabled !== 'boolean') return undefined
  const entries = [...store.entries]
  entries[index] = { ...entries[index], enabled: change.enabled, updatedAt: now }
  return { ...store, revision: store.revision + 1, entries }
}

/** Accept only a plain JSON object with the expected top-level shape. */
export function isStoreShape(value) {
  return value !== null
    && typeof value === 'object'
    && Array.isArray(value.entries)
    && Number.isSafeInteger(value.revision)
    && value.revision >= 0
}
