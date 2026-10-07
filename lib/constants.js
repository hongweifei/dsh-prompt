/**
 * Shared vocabulary of the prompt-injection model.
 *
 * These live in their own leaf module because `snippets` (which validates a
 * record), `render` (which composes one) and `inject` (which decides whether a
 * channel is live) all need the same three names, and the layering forbids a
 * lower module from importing a higher one.
 *
 * @module @dsh-external/dsh-prompt/constants
 */

/** The three injection channels, in the order the panel presents them. */
export const TARGETS = ['system', 'context', 'message']

/**
 * What each channel is for, in one sentence.
 *
 * Exported rather than written in the panel because the Host explains the same
 * distinction in `/prompt` and in the README, and three copies would drift.
 */
export const TARGET_PURPOSE = {
  system: 'Standing persona and rules; part of the system prompt on every request.',
  context: 'Facts about the current environment; a per-turn runtime-context snapshot.',
  message: 'Transient requirements; a user message injected at the start of each turn.',
}

/** The default per-channel switches. All three are on. */
export const INJECT_DEFAULTS = { system: true, context: true, message: true }

/**
 * The default mode: whether a session that has not chosen injects at all.
 *
 * **Off by default.** Injection changes every request, so it is opt-in: the user
 * turns it on from the composer button for the session they are in, or flips
 * this default in the settings panel. A plugin that silently rewrote every
 * prompt from the moment it was installed would be a nasty surprise.
 */
export const DEFAULT_ENABLED = false

/** Per-session override vocabulary. `auto` follows the global switch. */
export const OVERRIDES = ['auto', 'on', 'off']

/** The override a session that never made a choice carries. */
export const OVERRIDE_DEFAULT = 'auto'

/**
 * Placement of the injected system-prompt section.
 *
 * 0 is the deployment persona prefix and 500 is the plan policy, so 100 puts
 * the user's standing instructions directly after the persona and before every
 * policy and tool document — the place a "who you are and how you work" block
 * belongs. Measured against the harness's own SECTION_ORDERS.
 */
export const SYSTEM_SECTION_ORDER = 100

/**
 * Placement of the injected runtime context.
 *
 * The harness's own contexts are 110 (sandbox policy), 115 (approval policy)
 * and 120 (subagent delegation); 200 puts the user's facts after all three, so
 * a snippet can reference the sandbox it is running under.
 */
export const CONTEXT_ORDER = 200

/** Source kind on every message this plugin injects. */
export const MESSAGE_KIND = 'prompt'

/** Identity prefix for the injected message, so a session can tell them apart. */
export const IDENTITY_PREFIX = 'prompt'

/** The `<system-reminder>` frame the injected user message is wrapped in. */
export const REMINDER_OPEN = '<system-reminder>'
export const REMINDER_CLOSE = '</system-reminder>'

/**
 * The variables this plugin substitutes in snippet text itself.
 *
 * The harness's own `{{variable}}` interpolation is switched off for the
 * system channel (`interpolate: false`) and is unavoidable-but-escapable for
 * the runtime-context channel, so a user who writes `{{cwd}}` would otherwise
 * get either a literal or a thrown model call. These three are resolved here
 * instead, before the text is handed over.
 */
export const VARIABLES = ['cwd', 'model', 'provider']

/** Default cap on the composed text of all three channels together. */
export const MAX_CHARS_DEFAULT = 8000

/** Per-snippet text ceiling, so one paste cannot become the whole context. */
export const MAX_SNIPPET_CHARS = 20000

/** How many snippets the store accepts before a write is refused. */
export const MAX_SNIPPETS = 200

/**
 * How many sessions keep a recorded override and extras.
 *
 * The store is a small JSON file under `$DSH_HOME`; an unbounded per-session
 * map would grow forever on a long-lived installation, so the oldest entries
 * are dropped on write.
 */
export const MAX_TRACKED_SESSIONS = 50

/**
 * The store file's schema version; a mismatch is abandoned, never migrated.
 *
 * Bumped to 2 when `enabled` became `defaultEnabled` with an off default: the old
 * field meant "the plugin is on" and defaulted to on, so reading it as the new
 * one would leave injection on for a user who never asked for it.
 */
export const STORE_VERSION = 2
