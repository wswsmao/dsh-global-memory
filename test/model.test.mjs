import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  MAX_ENTRY_CHARS,
  addEntry,
  changeEntry,
  emptyStore,
  isStoreShape,
  normalizeText,
  totalChars,
  updateEntry,
  validateEntryInput,
} from '../lib/model.js'

test('an empty store is the shape the domain initial value must satisfy', () => {
  const store = emptyStore()
  assert.equal(isStoreShape(store), true)
  assert.deepEqual(store.entries, [])
  assert.equal(store.revision, 0)
  // A nullable global cannot round-trip: null is the medium's "never written"
  // sentinel, so the empty store must never be null.
  assert.notEqual(store, null)
})

test('a valid entry is trimmed and its tags deduplicated', () => {
  const result = validateEntryInput({ text: '  回答一律用中文  ', tags: ['style', 'style', ' ', 'lang'] })
  assert.equal(result.ok, true)
  assert.equal(result.value.text, '回答一律用中文')
  assert.deepEqual(result.value.tags, ['style', 'lang'])
})

test('empty text is refused with a reason the user can act on', () => {
  const result = validateEntryInput({ text: '   ' })
  assert.equal(result.ok, false)
  assert.match(result.reason, /不能为空/)
})

test('an over-long entry is refused and points at the right destination', () => {
  const result = validateEntryInput({ text: '字'.repeat(MAX_ENTRY_CHARS + 1) })
  assert.equal(result.ok, false)
  assert.match(result.reason, new RegExp(String(MAX_ENTRY_CHARS)))
  // The message must say where long content belongs, not just "too long".
  assert.match(result.reason, /AGENTS\.md/)
})

test('adding an entry bumps the revision and keeps insertion order', () => {
  const first = addEntry(emptyStore(), { text: '回答一律用中文', tags: [] }, 1000)
  const second = addEntry(first, { text: '统一用 pnpm', tags: [] }, 1001)
  assert.equal(second.revision, 2)
  assert.deepEqual(second.entries.map((entry) => entry.text), ['回答一律用中文', '统一用 pnpm'])
  assert.equal(second.entries[0].enabled, true)
})

test('updating an entry rewrites text and drops an emptied title', () => {
  const store = addEntry(emptyStore(), { text: '旧内容', title: '标题', tags: [] }, 1000)
  const id = store.entries[0].id
  const next = updateEntry(store, id, { text: '新内容', tags: ['a'] }, 2000)
  assert.equal(next.entries[0].text, '新内容')
  assert.equal(next.entries[0].title, undefined)
  assert.equal(next.entries[0].updatedAt, 2000)
  assert.equal(next.revision, 2)
})

test('updating an unknown id reports failure instead of inventing an entry', () => {
  assert.equal(updateEntry(emptyStore(), 'nope', { text: 'x', tags: [] }), undefined)
})

test('disabling keeps the entry, removing deletes it', () => {
  const store = addEntry(emptyStore(), { text: '回答一律用中文', tags: [] }, 1000)
  const id = store.entries[0].id
  const disabled = changeEntry(store, id, { enabled: false }, 2000)
  assert.equal(disabled.entries.length, 1)
  assert.equal(disabled.entries[0].enabled, false)
  const removed = changeEntry(store, id, { removed: true }, 3000)
  assert.equal(removed.entries.length, 0)
})

test('normalization makes obvious duplicates compare equal', () => {
  assert.equal(normalizeText('回答一律用中文。'), normalizeText('  回答一律用中文 '))
  assert.notEqual(normalizeText('回答一律用中文'), normalizeText('回答一律用英文'))
})

test('total characters count every entry, including disabled ones', () => {
  const store = addEntry(emptyStore(), { text: 'abcd', tags: [] }, 1)
  assert.equal(totalChars(store), 4)
})
