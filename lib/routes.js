/**
 * Host HTTP routes backing the settings panel and the composer toggle.
 *
 * The client half fetches these same-origin through the shared `/api` channel,
 * which applies the connection trust fence (Host/Origin validation plus browser
 * authentication) before any handler here runs. Registration is optional: a
 * profile without `connection` (headless, ACP, SDK) simply gets no routes.
 *
 * Every write goes through {@link updateStore}, which rebases onto a concurrent
 * edit rather than clobbering it, and then refreshes the live snapshot so the
 * very next model request already sees the change.
 *
 * @module @dsh-external/dsh-prompt/routes
 */

import { MAX_SNIPPETS } from './constants.js'
import { messageOf, updateStore } from './store.js'
import { clearSession, nextOrder, normalizeSnippet, removeSnippet, setSession, upsertSnippet } from './snippets.js'

/**
 * The exact route paths this module owns.
 *
 * Exported so a test can assert the client half's literals match these: the
 * browser bundle cannot import them, so without that check a rename would fail
 * only at runtime in the browser.
 */
export const ROUTE_PATHS = {
  status: '/api/prompt/status',
  snippet: '/api/prompt/snippet',
  session: '/api/prompt/session',
  toggle: '/api/prompt/toggle',
  preview: '/api/prompt/preview',
}

/** JSON response with no caching: every value here is a live fact. */
function sendJson(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * The session a route speaks for.
 *
 * A route has no agent of its own, so the current initiator is the only session
 * in scope. The caller may also name one explicitly (the panel sends the id it
 * is rendering), and an explicit id wins: a panel showing session A must not
 * silently act on session B.
 *
 * @param ctx - plugin context.
 * @param named - the session id the caller supplied, when any.
 * @returns the live session, or undefined.
 */
function resolveSession(ctx, named) {
  const current = ctx.get('agents')?.currentInitiator?.()
  if (typeof named === 'string' && named.length > 0 && current?.session?.id !== named) {
    return { id: named, header: current?.session?.header }
  }
  return current?.session
}

/**
 * Parse a JSON request body.
 *
 * @param request - the incoming request.
 * @returns `{ ok: true, body }` or `{ ok: false, response }`.
 */
async function readJson(request) {
  try {
    const body = await request.json()
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, response: sendJson(400, { error: 'the body must be a JSON object' }) }
    }
    return { ok: true, body }
  } catch {
    return { ok: false, response: sendJson(400, { error: 'the body must be valid JSON' }) }
  }
}

/**
 * Register the panel's routes.
 *
 * @param ctx - plugin context (must expose `connection`).
 * @param config - the resolved configuration.
 * @param cache - the live store snapshot.
 * @param lifecycle - the plugin's lifetime signal.
 * @param service - the `ctx.prompt` service, for status and preview.
 */
export function registerRoutes(ctx, config, cache, lifecycle, service) {
  const connection = ctx.get('connection')

  /** The filesystem, or a 500 response when the deployment has none. */
  const fsOrFail = () => ctx.get('fs')

  /**
   * Run one store mutation and refresh the snapshot.
   *
   * @param mutate - `(store) => store`.
   * @returns the outcome.
   */
  const write = async (mutate) => {
    const fs = fsOrFail()
    if (fs === undefined) return { ok: false, error: 'no filesystem provider is mounted' }
    const outcome = await updateStore(fs, mutate, lifecycle.signal)
    if (outcome.ok) await cache.refresh(lifecycle.signal)
    return outcome
  }

  ctx.effect(
    () =>
      connection.fetch.register({
        path: ROUTE_PATHS.status,
        methods: ['GET'],
        requestBody: 'buffered',
        async fetch(request) {
          const named = new URL(request.url).searchParams.get('session')
          return sendJson(200, await service.status({ session: resolveSession(ctx, named) }))
        },
      }),
    `prompt: GET ${ROUTE_PATHS.status}`,
  )

  ctx.effect(
    () =>
      connection.fetch.register({
        path: ROUTE_PATHS.preview,
        methods: ['GET'],
        requestBody: 'buffered',
        async fetch(request) {
          const named = new URL(request.url).searchParams.get('session')
          try {
            return sendJson(200, await service.preview(resolveSession(ctx, named)))
          } catch (error) {
            return sendJson(500, { available: false, reason: messageOf(error) })
          }
        },
      }),
    `prompt: GET ${ROUTE_PATHS.preview}`,
  )

  ctx.effect(
    () =>
      connection.fetch.register({
        path: ROUTE_PATHS.snippet,
        methods: ['POST', 'DELETE'],
        requestBody: 'buffered',
        async fetch(request) {
          if (request.method === 'DELETE') {
            const id = new URL(request.url).searchParams.get('id')
            if (typeof id !== 'string' || id.length === 0) return sendJson(400, { error: 'id is required' })
            let removed = false
            const outcome = await write((store) => {
              const result = removeSnippet(store, id)
              removed = result.removed !== undefined
              return result.store
            })
            if (!outcome.ok) return sendJson(500, { error: outcome.error })
            if (!removed) return sendJson(404, { error: `no snippet with id ${id}` })
            return sendJson(200, { ok: true, removed: true })
          }

          const parsed = await readJson(request)
          if (!parsed.ok) return parsed.response
          const body = parsed.body
          // The id decides create vs replace; everything else is validated by
          // the same function the store uses on disk, so the panel cannot write
          // a record the next read would discard.
          const existing = typeof body.id === 'string' ? cache.store?.snippets.find((snippet) => snippet.id === body.id) : undefined
          const fallbackOrder = nextOrder(cache.store?.snippets ?? [], typeof body.target === 'string' ? body.target : 'system')
          const normalized = normalizeSnippet(body, { existing, order: fallbackOrder })
          if (!normalized.ok) return sendJson(400, { error: normalized.error })
          const isNew = existing === undefined && typeof body.id !== 'string'
          let saved
          let failure
          const outcome = await write((store) => {
            if (isNew && store.snippets.length >= MAX_SNIPPETS) {
              failure = `the store already holds ${MAX_SNIPPETS} snippets; delete one first`
              return store
            }
            const result = upsertSnippet(store, normalized.snippet)
            saved = result.snippets.find((snippet) => snippet.id === normalized.snippet.id)
            return result
          })
          if (failure !== undefined) return sendJson(400, { error: failure })
          if (!outcome.ok) return sendJson(500, { error: outcome.error })
          return sendJson(200, { ok: true, snippet: saved ?? normalized.snippet, snippets: outcome.store.snippets })
        },
      }),
    `prompt: POST/DELETE ${ROUTE_PATHS.snippet}`,
  )

  ctx.effect(
    () =>
      connection.fetch.register({
        path: ROUTE_PATHS.session,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          const parsed = await readJson(request)
          if (!parsed.ok) return parsed.response
          const body = parsed.body
          const session = resolveSession(ctx, typeof body.sessionId === 'string' ? body.sessionId : undefined)
          const sessionId = session?.id
          if (typeof sessionId !== 'string' || sessionId.length === 0) {
            return sendJson(400, { error: 'no session is in scope' })
          }
          const action = typeof body.action === 'string' ? body.action : ''
          const now = Date.now()
          let failure
          const outcome = await write((store) => {
            if (action === 'clear-extras') return setSession(store, sessionId, { clearExtras: true }, now)
            if (action === 'add-extra') {
              const target = typeof body.target === 'string' ? body.target : 'message'
              const current = store.sessions[sessionId]?.extras ?? []
              // A name is required by the model but is not something a quick
              // "add this for now" box should demand, so one is derived.
              const normalized = normalizeSnippet(
                {
                  name: typeof body.name === 'string' && body.name.trim().length > 0 ? body.name : `session-${current.length + 1}`,
                  text: body.text,
                  target,
                  enabled: true,
                },
                { order: nextOrder(current, target) },
              )
              if (!normalized.ok) {
                failure = normalized.error
                return store
              }
              return setSession(store, sessionId, { extras: [...current, normalized.snippet] }, now)
            }
            if (action === 'remove-extra') {
              const current = store.sessions[sessionId]?.extras ?? []
              return setSession(store, sessionId, { extras: current.filter((snippet) => snippet.id !== body.id) }, now)
            }
            if (action === 'clear') return clearSession(store, sessionId)
            if (action === 'auto' || action === 'on' || action === 'off') {
              return setSession(store, sessionId, { override: action }, now)
            }
            failure = `unknown action "${action}" — use auto, on, off, add-extra, remove-extra, clear-extras or clear`
            return store
          })
          if (failure !== undefined) return sendJson(400, { error: failure })
          if (!outcome.ok) return sendJson(500, { error: outcome.error })
          return sendJson(200, { ok: true, session: await service.status({ session }).then((status) => status.session) })
        },
      }),
    `prompt: POST ${ROUTE_PATHS.session}`,
  )

  ctx.effect(
    () =>
      connection.fetch.register({
        path: ROUTE_PATHS.toggle,
        methods: ['POST'],
        requestBody: 'buffered',
        async fetch(request) {
          const parsed = await readJson(request)
          if (!parsed.ok) return parsed.response
          const body = parsed.body
          let failure
          const outcome = await write((store) => {
            const next = { ...store }
            // The settings panel's "default mode": what a session that has not
            // chosen for itself gets. It is deliberately NOT a master kill switch
            // — a session with an explicit `on` keeps injecting, which is what the
            // composer button promised the user when they pressed it.
            if (typeof body.defaultEnabled === 'boolean') next.defaultEnabled = body.defaultEnabled
            if (body.inject !== null && typeof body.inject === 'object' && !Array.isArray(body.inject)) {
              next.inject = { ...store.inject }
              for (const [key, value] of Object.entries(body.inject)) {
                if (!(key in next.inject)) {
                  failure = `unknown channel "${key}"`
                  continue
                }
                if (typeof value === 'boolean') next.inject[key] = value
              }
            }
            return next
          })
          if (failure !== undefined) return sendJson(400, { error: failure })
          if (!outcome.ok) return sendJson(500, { error: outcome.error })
          return sendJson(200, { ok: true, defaultEnabled: outcome.store.defaultEnabled, inject: outcome.store.inject })
        },
      }),
    `prompt: POST ${ROUTE_PATHS.toggle}`,
  )
}
