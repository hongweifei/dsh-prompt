/**
 * dsh-prompt — editable prompt snippets injected into the model.
 *
 * Three channels, because "a prompt" means three different lifetimes:
 *
 *   system   standing persona and rules, part of the system prompt on every
 *            request. Registered with `interpolate: false`, because this plugin
 *            substitutes its own `{{cwd}}`/`{{model}}`/`{{provider}}` and the
 *            harness would otherwise throw on a user's literal `{{`.
 *   context  facts about the current environment, delivered as the harness's
 *            per-turn runtime-context snapshot (a user-role message).
 *   message  transient requirements, a user message added to each turn's
 *            entering batch through the `agent/pre-step` waterfall.
 *
 * The store is one JSON file under `$DSH_HOME/prompt`, owned by the Host half.
 * The Client half (`./client.js`) renders Settings → Prompt and the composer's
 * quick toggle; both talk to the Host over the same-origin `/api/prompt/*`
 * routes, so the panel works in any profile that has a web connection and the
 * slash commands work in one that does not.
 *
 * Harness mapping (verified against the installed 0.1.7-rc.2 packages):
 *   system channel     ctx.systemPrompt.section({ interpolate: false })
 *   context channel    ctx.systemPrompt.context(...)
 *   message channel    agent/pre-step waterfall
 *   file I/O           ctx.fs (the deployment's own provider)
 *   runtime methods    ctx.provide('prompt', …)
 *   panel              Client slot settings.section + conversation.input.left
 *
 * @module @dsh-external/dsh-prompt
 */

import { registerCommands } from './commands.js'
import { Config, resolvePromptConfig } from './config.js'
import { registerMessageChannel, registerPromptChannels, StoreCache } from './inject.js'
import { readStore } from './store.js'
import { registerRoutes } from './routes.js'
import { createPromptService } from './service.js'

export const name = 'prompt'

export { Config }
export { CONFIG_DEFAULTS, resolvePromptConfig } from './config.js'
export { TARGETS, TARGET_PURPOSE, INJECT_DEFAULTS, OVERRIDES, VARIABLES } from './constants.js'
export { CONTEXT_NAME, SYSTEM_SECTION_NAME, StoreCache, channelOpen, variablesFor } from './inject.js'
export {
  composeInjection, composeBody, substituteVariables, escapeGroups, needsEscaping,
  applyBudget, truncateChars, contextText, systemText, messageText, injectionIdentity,
} from './render.js'
export {
  createStore, normalizeStore, normalizeSnippet, sortSnippets, countByTarget,
  upsertSnippet, removeSnippet, nextOrder, sessionRecord, setSession, clearSession,
  globalSwitches, effectiveState, selectSnippets, isTarget, isOverride, newSnippetId,
} from './snippets.js'
export { readStore, writeStore, updateStore, messageOf } from './store.js'
export { resolveDshHome, promptDir, storePath, shortSessionId } from './paths.js'

/**
 * Wire the plugin.
 *
 * @param ctx - plugin context.
 * @param validatedConfig - the Loader-validated configuration.
 */
export function apply(ctx, validatedConfig) {
  const config = resolvePromptConfig(validatedConfig)
  const lifecycle = new AbortController()
  const logger = ctx.logger

  ctx.effect(() => () => {
    lifecycle.abort(new Error('dsh-prompt disposed'))
    cache.stop()
  }, 'prompt.lifecycle')

  /**
   * The live store snapshot every seam reads.
   *
   * Created even when the plugin is disabled, because `ctx.prompt` is still
   * expected to answer.
   */
  const cache = new StoreCache((signal) => {
    const fs = ctx.get('fs')
    if (fs === undefined) {
      return Promise.resolve({ store: undefined, error: 'no filesystem provider is mounted' })
    }
    return readStore(fs, signal ?? lifecycle.signal)
  })

  const service = createPromptService(ctx, config, cache, lifecycle)
  ctx.provide('prompt', service)

  if (!config.enabled) {
    logger.info('prompt: disabled by configuration')
    return
  }

  /* ---------------- injection seams ---------------- */

  // `systemPrompt` is a hard dependency of the injection itself; without it the
  // plugin has nothing to inject into, so it waits rather than half-starting.
  // Each registration is wrapped in an explicit `ctx.effect` rather than relying
  // on the injected fiber to unwind it: the lifecycle is then stated in one
  // place, and a test can observe it without simulating Cordis's scoping.
  ctx.inject(['systemPrompt'], (promptCtx) => {
    ctx.effect(() => registerPromptChannels(promptCtx, config, cache), 'prompt.channels')
  })
  ctx.effect(() => registerMessageChannel(ctx, config, cache), 'prompt.messageChannel')

  /* ---------------- store snapshot ---------------- */

  // The synchronous section callback reads this snapshot, so it is warmed at
  // startup and kept fresh. The first read is fire-and-forget: a slow disk must
  // not delay plugin activation.
  cache.refresh(lifecycle.signal).then((read) => {
    if (read?.error !== null && read?.error !== undefined) logger.warn('prompt: store read failed: %s', read.error)
  })
  if (config.refreshMs > 0) {
    const timer = setInterval(() => {
      cache.refresh(lifecycle.signal)
    }, config.refreshMs)
    // A pending timer must not hold the host process open.
    timer.unref?.()
    ctx.effect(() => () => clearInterval(timer), 'prompt.storeTimer')
  }

  /* ---------------- panel routes ---------------- */

  // Optional: a profile without a web connection (headless, ACP, SDK) gets no
  // routes, and the panel is simply absent.
  ctx.inject(['connection', 'fs'], (webCtx) => {
    ctx.effect(() => registerRoutes(webCtx, config, cache, lifecycle, service), 'prompt.routes')
  })

  /* ---------------- slash commands ---------------- */

  ctx.inject(['commands', 'fs'], (commandCtx) => {
    ctx.effect(() => registerCommands(commandCtx, config, cache, lifecycle), 'prompt.commands')
  })
}
