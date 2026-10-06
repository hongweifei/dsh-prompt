/**
 * Configuration: the Loader-facing schema plus the plugin's own defaults.
 *
 * The store holds everything the *user* changes (snippets, switches, per-session
 * overrides). Configuration holds what an *operator* sets once: whether the
 * plugin runs at all, the shared character budget, and the two placement orders.
 * Keeping the split strict is what makes "edit a snippet in the panel" and
 * "change the plugin's policy in the profile" different acts with different
 * lifetimes.
 *
 * @module @dsh-external/dsh-prompt/config
 */

import z from '@deepseek-ai/schemastery'
import { MAX_CHARS_DEFAULT, SYSTEM_SECTION_ORDER, CONTEXT_ORDER } from './constants.js'

/** Defaults applied after the schema, so an absent field still has a value. */
export const CONFIG_DEFAULTS = {
  enabled: true,
  maxChars: MAX_CHARS_DEFAULT,
  sectionOrder: SYSTEM_SECTION_ORDER,
  contextOrder: CONTEXT_ORDER,
  refreshMs: 3000,
}

/**
 * The schema the Loader validates and the Config inspector projects.
 *
 * Every field has a default, so the schema never rejects a sparse profile entry
 * and `resolvePromptConfig` below is the only place a default is applied.
 */
export const Config = z.object({
  enabled: z.boolean().default(true),
  /**
   * The combined character ceiling across all three channels. `0` means no cap.
   * A character ceiling rather than a token ceiling on purpose: the harness's
   * token meter is not always mounted, and a budget the plugin cannot measure
   * honestly is worse than one it can.
   */
  maxChars: z.natural().default(MAX_CHARS_DEFAULT),
  /** Placement of the injected system-prompt section. */
  sectionOrder: z.number().default(SYSTEM_SECTION_ORDER),
  /** Placement of the injected runtime context. */
  contextOrder: z.number().default(CONTEXT_ORDER),
  /**
   * How often the live store snapshot is re-read from disk, in milliseconds.
   * `0` disables the timer; the snapshot is then refreshed only on startup and
   * after a panel write, which is enough for a single-window installation but
   * will not notice an edit made by another process.
   */
  refreshMs: z.natural().default(CONFIG_DEFAULTS.refreshMs),
})

/**
 * Apply the plugin's defaults to a validated config.
 *
 * @param config - the schema-validated configuration.
 * @returns the resolved configuration.
 */
export function resolvePromptConfig(config) {
  const maxChars = typeof config?.maxChars === 'number' ? config.maxChars : CONFIG_DEFAULTS.maxChars
  const refreshMs = typeof config?.refreshMs === 'number' ? config.refreshMs : CONFIG_DEFAULTS.refreshMs
  return {
    enabled: config?.enabled !== false,
    // A negative value would be a budget that can never be met; treat it as the
    // default rather than silently truncating every channel to nothing.
    maxChars: Number.isFinite(maxChars) && maxChars >= 0 ? Math.trunc(maxChars) : CONFIG_DEFAULTS.maxChars,
    sectionOrder: Number.isFinite(config?.sectionOrder) ? config.sectionOrder : CONFIG_DEFAULTS.sectionOrder,
    contextOrder: Number.isFinite(config?.contextOrder) ? config.contextOrder : CONFIG_DEFAULTS.contextOrder,
    // `0` explicitly disables the refresh timer; an absent value takes the default.
    refreshMs: Number.isFinite(refreshMs) && refreshMs > 0 ? Math.trunc(refreshMs) : refreshMs === 0 ? 0 : CONFIG_DEFAULTS.refreshMs,
  }
}
