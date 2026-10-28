/**
 * The settings-page API.
 *
 * Reads and writes are separate verbs on purpose: the page refreshes far more
 * often than the user edits, and a single "post the whole store" endpoint would
 * make every save a lost-update hazard.
 *
 * Every mutation carries the `revision` the client last saw. A mismatch is
 * refused instead of merged, so two open tabs cannot silently overwrite each
 * other — the user is told to refresh and look at what changed.
 *
 * @module global-memory/route
 */

/** Every endpoint lives below this prefix. */
export const ROUTE_PREFIX = '/plugins/global-memory'

/** Request bodies are short JSON documents; anything larger is refused. */
const MAX_BODY_BYTES = 64 * 1024

/** A failure the route reports with a specific status. */
export class RouteError extends Error {
  constructor(status, message, code = 'error') {
    super(message)
    this.name = 'RouteError'
    this.status = status
    this.code = code
  }
}

/** Send one JSON response. */
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Read one bounded JSON request body.
 * @param {import('node:http').IncomingMessage} req - request.
 * @returns {Promise<Record<string, unknown>>} parsed object; `{}` when empty.
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_BODY_BYTES) {
        reject(new RouteError(413, '请求体过大。'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim()
      if (text === '') return resolve({})
      try {
        const parsed = JSON.parse(text)
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch (error) {
        reject(new RouteError(400, `请求体不是合法 JSON：${error.message}`))
      }
    })
    req.on('error', reject)
  })
}

/** Require one string field. */
function requireString(body, key) {
  const value = body?.[key]
  if (typeof value !== 'string' || value.trim() === '') throw new RouteError(400, `缺少字段：${key}`)
  return value.trim()
}

/**
 * Mount the API.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {object} host - the host half's store operations.
 */
export function registerRoute(ctx, host) {
  /** Refuse a write built on a stale read. */
  const assertRevision = (body, current) => {
    const expected = body?.revision
    if (!Number.isSafeInteger(expected)) throw new RouteError(400, '缺少 revision；请刷新后重试。')
    if (expected !== current().revision) {
      throw new RouteError(409, '这份记忆已在别处被修改，请刷新后再改。', 'stale_revision')
    }
  }

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: host.prefix,
    async handler(req, res) {
      // Same trust fence every plugin route uses; a request that did not come
      // through this Host's authenticated channel never reaches the store.
      const rejection = ctx.connection.requestRejection(req)
      if (rejection !== undefined) {
        res.statusCode = rejection
        res.end()
        return
      }
      const url = new URL(String(req.url ?? '/'), 'http://global-memory.invalid')
      const rest = url.pathname.startsWith(host.prefix) ? url.pathname.slice(host.prefix.length) : ''
      try {
        await host.ready
        if (req.method === 'GET' && (rest === '/state' || rest === '')) {
          sendJson(res, 200, { ok: true, state: host.view() })
          return
        }
        if (req.method !== 'POST') throw new RouteError(405, '只支持 GET /state 与 POST。')
        const body = await readJsonBody(req)
        if (rest === '/add') {
          assertRevision(body, host.read)
          const validated = host.validate(body)
          if (!validated.ok) throw new RouteError(400, validated.reason)
          const next = host.add(validated.value)
          await host.commit(next)
          sendJson(res, 200, { ok: true, state: host.view() })
          return
        }
        if (rest === '/update') {
          assertRevision(body, host.read)
          const id = requireString(body, 'id')
          const validated = host.validate(body)
          if (!validated.ok) throw new RouteError(400, validated.reason)
          const next = host.update(id, validated.value)
          if (next === undefined) throw new RouteError(404, '没有找到这条记忆。')
          await host.commit(next)
          sendJson(res, 200, { ok: true, state: host.view() })
          return
        }
        if (rest === '/change') {
          assertRevision(body, host.read)
          const id = requireString(body, 'id')
          const change = {
            ...typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {},
            ...body.removed === true ? { removed: true } : {},
          }
          if (change.enabled === undefined && change.removed === undefined) throw new RouteError(400, '缺少 enabled 或 removed。')
          const next = host.change(id, change)
          if (next === undefined) throw new RouteError(404, '没有找到这条记忆。')
          await host.commit(next)
          sendJson(res, 200, { ok: true, state: host.view() })
          return
        }
        throw new RouteError(404, '未知接口。')
      } catch (error) {
        const status = error instanceof RouteError ? error.status : 500
        const message = error instanceof Error ? error.message : String(error)
        const code = error instanceof RouteError ? error.code : 'error'
        if (status >= 500) host.onError(error)
        sendJson(res, status, { ok: false, code, message })
      }
    },
  }), 'global-memory: settings API')
}
