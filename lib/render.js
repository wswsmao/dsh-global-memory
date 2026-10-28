/**
 * Rendering the memory block, and deciding whether it fits.
 *
 * Two rules shape this file.
 *
 * First, the output must be BYTE-STABLE for an unchanged store: the host
 * compares the rendered runtime context with the one it already retained, and
 * any difference writes a new durable `user/message`. No timestamps, no counts
 * that drift, no Map iteration order — entries render in store order.
 *
 * Second, the size check is a refusal, not a truncation. A truncated block
 * would make the model believe the whole memory is in force while part of it was
 * silently dropped, which is the exact confusion this plugin exists to prevent.
 *
 * @module global-memory/render
 */

import { injectableEntries, normalizeText } from './model.js'

const HEADER = Object.freeze({
  zh: '用户的全局偏好（所有会话通用）：',
  en: 'The user\'s global preferences (apply to every conversation):',
})

/**
 * Cheap deterministic token estimate: one token per CJK character, one per four
 * other characters. Deliberately conservative, so the limit errs towards too
 * strict rather than too generous.
 * @param {string} text - text to measure.
 * @returns {number} estimated tokens.
 */
export function estimateTokens(text) {
  let cjk = 0
  let other = 0
  for (const character of String(text)) {
    if (/[\u3000-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(character)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

/** Whether the text contains CJK characters. */
function hasCJK(text) {
  return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text)
}

/** Resolve the rendering language. */
function languageOf(entries, configured) {
  if (configured === 'zh' || configured === 'en') return configured
  return entries.some((entry) => hasCJK(entry.text)) ? 'zh' : 'en'
}

/**
 * Collapse entries that say the same thing.
 *
 * This is the only lossy-looking step in the design, and it is lossless: it
 * removes exact duplicates after whitespace/punctuation normalization, keeping
 * the first occurrence. It is applied at render time so the stored list keeps
 * every entry the user created.
 * @param {object[]} entries - injectable entries in store order.
 * @returns {{kept: object[], dropped: object[]}} the split.
 */
export function collapseDuplicates(entries) {
  const seen = new Set()
  const kept = []
  const dropped = []
  for (const entry of entries) {
    const key = normalizeText(entry.text)
    if (seen.has(key)) {
      dropped.push(entry)
      continue
    }
    seen.add(key)
    kept.push(entry)
  }
  return { kept, dropped }
}

/**
 * Render the injected block and report whether it fits the budget.
 *
 * @param {object} store - current store.
 * @param {{budgetTokens: number, textLanguage: string}} options - limits and language.
 * @returns {{fits: boolean, text: string, tokens: number, budget: number, included: number, dropped: number}} the outcome.
 */
export function renderBlock(store, options) {
  const injectable = injectableEntries(store)
  const { kept, dropped } = collapseDuplicates(injectable)
  if (kept.length === 0) {
    return { fits: true, text: '', tokens: 0, budget: options.budgetTokens, included: 0, dropped: dropped.length }
  }
  const language = languageOf(kept, options.textLanguage)
  const body = kept.map((entry) => `- ${entry.text}`).join('\n')
  const text = `${HEADER[language]}\n${body}`
  const tokens = estimateTokens(text)
  return {
    fits: tokens <= options.budgetTokens,
    text,
    tokens,
    budget: options.budgetTokens,
    included: kept.length,
    dropped: dropped.length,
  }
}

/**
 * Describe what to do when the block does not fit.
 *
 * The refusal is only useful if it tells the user the size, the limit, and where
 * to act. It must also stay honest about the fact that it is a wall, not a
 * suggestion.
 *
 * @param {{tokens: number, budget: number, included: number}} rendered - the overflow.
 * @param {string} language - `zh` or `en`.
 * @returns {string} the message shown in the conversation.
 */
export function overflowMessage(rendered, language = 'zh') {
  const over = rendered.tokens - rendered.budget
  if (language === 'en') {
    return [
      'Global memory is over its limit, so this request was not sent to the model.',
      `- Current: ~${rendered.tokens} tokens across ${rendered.included} entries`,
      `- Limit: ${rendered.budget} tokens (over by ~${over})`,
      '- To fix: open Settings → Memory, then delete or disable some entries.',
      '- Nothing was truncated automatically: what is stored is exactly what you see.',
    ].join('\n')
  }
  return [
    '全局记忆超出上限，本次请求没有发送给模型。',
    `- 当前占用：约 ${rendered.tokens} token，共 ${rendered.included} 条`,
    `- 上限：${rendered.budget} token（超出约 ${over}）`,
    '- 处理办法：打开 设置 → 记忆，删除或停用一些条目。',
    '- 没有做任何自动截断：存储里是什么，你看到的就是什么。',
  ].join('\n')
}

/**
 * The client-facing summary for the settings page.
 * @param {object} store - current store.
 * @param {{budgetTokens: number, textLanguage: string}} options - limits and language.
 * @returns {object} wire value.
 */
export function viewStore(store, options) {
  const rendered = renderBlock(store, options)
  return {
    revision: store.revision,
    entries: store.entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      ...entry.title === undefined ? {} : { title: entry.title },
      tags: entry.tags,
      enabled: entry.enabled !== false,
      chars: [...String(entry.text)].length,
      updatedAt: entry.updatedAt,
    })),
    usage: {
      tokens: rendered.tokens,
      budget: rendered.budget,
      included: rendered.included,
      duplicateCount: rendered.dropped,
      fits: rendered.fits,
    },
  }
}
