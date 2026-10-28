/**
 * Host half of the global memory.
 *
 * The store is plugin-owned: unlike the per-session directive ledger, this data
 * has no owning conversation, so it cannot be derived from any session log and
 * must be persisted. It lives in a `storageDomain` domain, which supplies
 * schema validation, atomic writes, and version migration.
 *
 * The single hard limit is a *refusal*, not a truncation: an over-budget block
 * stops the request and tells the user what to change. See docs/design.md 2.5.2.
 *
 * @module global-memory
 */

import {
  addEntry,
  changeEntry,
  emptyStore,
  isStoreShape,
  updateEntry,
  validateEntryInput,
} from './lib/model.js'
import { overflowMessage, renderBlock, viewStore } from './lib/render.js'
import { ROUTE_PREFIX, registerRoute } from './lib/route.js'
import { nativePackage } from './lib/native.js'

const { z } = await nativePackage('zod')
const { defineDomain } = await nativePackage('@deepseek-ai/dsh-storage-domain')
const { createUserMessage } = await nativePackage('@deepseek-ai/dsh-llm')

/** Cordis plugin name. */
export const name = 'global-memory'

/**
 * Services required.
 *
 * `storageDomain` is a hard dependency: without a backend the plugin cannot
 * store anything, and a silent no-op would be worse than staying inactive.
 * `webServer` and `connection` carry the settings-page API.
 */
export const inject = ['storageDomain', 'systemPrompt', 'webServer', 'connection']

/** Where the memory block sits: right after the per-session ledger. */
const CONTEXT_ORDER = 155

/**
 * Backend unit name.
 *
 * The storage layer requires `^[a-z][a-z0-9_]*$`, so this uses an underscore.
 * The route prefix, the projection-free store key, and the plugin id stay
 * independent of it — only the on-disk unit name is constrained.
 */
const DOMAIN_NAME = 'global_memory'

/** One stored entry. Loose on read so an older reader tolerates newer fields. */
const entrySchema = z.object({
  id: z.string(),
  text: z.string(),
  title: z.string().optional(),
  tags: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const storeSchema = z.object({
  version: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  entries: z.array(entrySchema),
})

/** Validate the row config once, at activation. */
function readConfig(config) {
  const budgetTokens = config.budgetTokens ?? 1200
  if (!Number.isSafeInteger(budgetTokens) || budgetTokens < 64) throw new TypeError('budgetTokens must be an integer >= 64')
  const textLanguage = config.textLanguage ?? 'auto'
  if (!['auto', 'zh', 'en'].includes(textLanguage)) throw new TypeError("textLanguage must be 'auto', 'zh' or 'en'")
  const allowAgentWrite = config.allowAgentWrite === true
  return { budgetTokens, textLanguage, allowAgentWrite }
}

/**
 * Mount the plugin.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} config - row config.
 */
export function apply(ctx, config = {}) {
  const options = readConfig(config)
  /** The opened domain; `undefined` until the async open settles. */
  let domain
  /** Last known store, so synchronous prompt reads never await. */
  let cache = emptyStore()

  /** Open the domain once, keeping the handle for the plugin's lifetime. */
  const ready = ctx.storageDomain.open(defineDomain({
    name: DOMAIN_NAME,
    version: 1,
    layout: 'single',
    global: { schema: storeSchema, initial: emptyStore() },
    tables: {},
  })).then((opened) => {
    domain = opened
    const stored = opened.global.get()
    if (isStoreShape(stored)) cache = stored
    return opened
  })
  ctx.effect(() => () => {
    // The facility does not own this handle: closing is the caller's job.
    const closing = domain?.close()
    domain = undefined
    return closing
  }, 'global-memory: domain lifecycle')

  /** Persist the next store and refresh the synchronous cache. */
  const commit = async (next) => {
    const opened = await ready
    await opened.global.set(next)
    cache = next
    return next
  }

  ctx.effect(() => ctx.systemPrompt.context({
    name: 'global-memory',
    order: CONTEXT_ORDER,
    required: true,
    // The provider is synchronous by contract, so it reads the cache rather
    // than awaiting the domain. A cold start shows nothing rather than blocking
    // every request behind a disk read.
    text: () => renderBlock(cache, options).text,
  }), 'global-memory: runtime context')

  /**
   * The size wall.
   *
   * `agent/pre-step` is the only place where the refusal can carry an
   * explanation: a `reject` decision has no room for text and the loop records
   * it as a bare `blocked` turn, so the message is committed to the surface
   * first and the step is rejected afterwards. The user sees exactly why the
   * request did not run, in the conversation, instead of a silent stop.
   */
  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    const rendered = renderBlock(cache, options)
    if (rendered.fits) return next()
    if (payload.step !== 1) return next()
    const notice = createUserMessage({
      content: [{ type: 'text', text: overflowMessage(rendered, options.textLanguage === 'auto' ? 'zh' : options.textLanguage) }],
      source: { kind: 'global-memory', form: 'notice', summary: '全局记忆超出上限' },
    })
    // Commit the explanation to the log, then refuse the step. Appending through
    // the session is what makes the reason durable and visible in the Chat.
    payload.agent.session.append('user/message', notice, { surfaceOp: 'append' })
    return { kind: 'reject' }
  }), 'global-memory: size wall')

  registerRoute(ctx, {
    prefix: ROUTE_PREFIX,
    ready,
    read: () => cache,
    commit,
    view: () => viewStore(cache, options),
    validate: validateEntryInput,
    add: (value) => addEntry(cache, value),
    update: (id, value) => updateEntry(cache, id, value),
    change: (id, change) => changeEntry(cache, id, change),
    onError: (error) => ctx.logger.warn(`[global-memory] ${error instanceof Error ? error.message : String(error)}`),
  })
}
