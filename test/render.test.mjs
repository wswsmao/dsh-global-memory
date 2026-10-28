import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addEntry, changeEntry, emptyStore } from '../lib/model.js'
import { collapseDuplicates, estimateTokens, overflowMessage, renderBlock, viewStore } from '../lib/render.js'

/** Options used by most cases. */
const OPTIONS = { budgetTokens: 1200, textLanguage: 'auto' }

/** Build a store from a list of texts. */
function storeOf(texts) {
  let store = emptyStore()
  for (const text of texts) store = addEntry(store, { text, tags: [] }, 1000 + store.revision)
  return store
}

test('an empty store renders nothing at all', () => {
  const rendered = renderBlock(emptyStore(), OPTIONS)
  assert.equal(rendered.text, '')
  assert.equal(rendered.fits, true)
})

test('a store with only disabled entries renders nothing', () => {
  const store = storeOf(['回答一律用中文'])
  const disabled = changeEntry(store, store.entries[0].id, { enabled: false })
  assert.equal(renderBlock(disabled, OPTIONS).text, '')
})

test('the block lists entries in store order under a header', () => {
  const rendered = renderBlock(storeOf(['回答一律用中文', '统一用 pnpm']), OPTIONS)
  assert.ok(rendered.text.startsWith('用户的全局偏好'))
  const lines = rendered.text.split('\n')
  assert.equal(lines[1], '- 回答一律用中文')
  assert.equal(lines[2], '- 统一用 pnpm')
})

test('an unchanged store renders identical bytes', () => {
  // The host compares this text with the snapshot it retained; a difference
  // writes a new durable user message on every single step.
  const store = storeOf(['回答一律用中文', '统一用 pnpm'])
  assert.equal(renderBlock(store, OPTIONS).text, renderBlock(store, OPTIONS).text)
})

test('exact duplicates collapse at render time without touching the store', () => {
  const store = storeOf(['回答一律用中文', '回答一律用中文。', '统一用 pnpm'])
  const rendered = renderBlock(store, OPTIONS)
  assert.equal(rendered.included, 2)
  assert.equal(rendered.dropped, 1)
  // The stored list still holds all three: collapsing is a view, not an edit.
  assert.equal(store.entries.length, 3)
})

test('duplicate collapse keeps the first occurrence', () => {
  const store = storeOf(['统一用 pnpm', '统一用 pnpm'])
  const { kept, dropped } = collapseDuplicates(store.entries)
  assert.equal(kept.length, 1)
  assert.equal(dropped.length, 1)
  assert.equal(kept[0].id, store.entries[0].id)
})

test('a block within budget fits', () => {
  const rendered = renderBlock(storeOf(['回答一律用中文']), OPTIONS)
  assert.equal(rendered.fits, true)
  assert.ok(rendered.tokens <= OPTIONS.budgetTokens)
})

test('an over-budget block refuses instead of truncating', () => {
  const many = Array.from({ length: 200 }, (_, index) => `第 ${index} 条要求都要一直遵守`)
  const rendered = renderBlock(storeOf(many), { budgetTokens: 200, textLanguage: 'auto' })
  assert.equal(rendered.fits, false)
  // Every entry is still accounted for: nothing was silently dropped to fit.
  assert.equal(rendered.included + rendered.dropped, 200)
})

test('the overflow message states size, limit, excess and where to act', () => {
  const message = overflowMessage({ tokens: 1500, budget: 1200, included: 40 })
  assert.match(message, /1500/)
  assert.match(message, /1200/)
  assert.match(message, /超出约 300/)
  assert.match(message, /设置 → 记忆/)
  // It must also say that nothing was truncated, or the user will suspect it was.
  assert.match(message, /没有做任何自动截断/)
})

test('the overflow message has an English form', () => {
  const message = overflowMessage({ tokens: 1500, budget: 1200, included: 40 }, 'en')
  assert.match(message, /over its limit/)
  assert.match(message, /Settings → Memory/)
})

test('the wire view reports usage the settings page can show', () => {
  const store = storeOf(['回答一律用中文'])
  const view = viewStore(store, OPTIONS)
  assert.equal(view.entries.length, 1)
  assert.equal(view.entries[0].chars, 7)
  assert.equal(view.usage.budget, 1200)
  assert.equal(view.usage.fits, true)
  assert.equal(view.usage.included, 1)
})

test('the wire view counts duplicate collapse so the page can explain it', () => {
  const view = viewStore(storeOf(['统一用 pnpm', '统一用 pnpm']), OPTIONS)
  assert.equal(view.usage.duplicateCount, 1)
  assert.equal(view.entries.length, 2)
})

test('the estimator charges CJK per character and Latin per four', () => {
  assert.equal(estimateTokens('中文'), 2)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens(''), 0)
})
