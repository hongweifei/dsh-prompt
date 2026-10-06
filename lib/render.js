/**
 * Composition: turning selected snippets into the exact text each channel
 * carries, under one shared character budget.
 *
 * Two properties matter more than anything else here, and both come from how
 * the harness treats the text afterwards:
 *
 *   1. **The system channel is registered with `interpolate: false`.** Without
 *      that, the harness would scan the user's own text for `{{name}}` groups
 *      and *throw* on an unknown one — a snippet containing `{{` would turn
 *      every model call into a failure. This plugin therefore does its own
 *      substitution ({@link substituteVariables}) and hands over literal text.
 *   2. **The runtime-context channel cannot opt out.** `PromptContext` has no
 *      `interpolate` field, so the harness always interpolates it, and an
 *      unknown or malformed group throws. Any `{{` surviving substitution is
 *      therefore escaped ({@link escapeGroups}) so the scanner cannot see a
 *      group at all. The escaping is reported in the preview's notes, because a
 *      silently rewritten snippet is exactly the kind of thing a user must be
 *      told about.
 *
 * @module @dsh-external/dsh-prompt/render
 */

import { REMINDER_CLOSE, REMINDER_OPEN, VARIABLES } from './constants.js'

/**
 * Substitute this plugin's own variables.
 *
 * `{{cwd}}`, `{{model}}` and `{{provider}}` are resolved here rather than left
 * to the harness, so one syntax works on all three channels. An unresolved
 * variable is left verbatim — the text is the user's, and quietly deleting a
 * placeholder they wrote would be worse than showing it.
 *
 * @param text - the snippet text.
 * @param variables - `{ cwd, model, provider }`, any of which may be undefined.
 * @returns the text with known variables replaced.
 */
export function substituteVariables(text, variables = {}) {
  let result = String(text ?? '')
  for (const name of VARIABLES) {
    const value = variables[name]
    if (typeof value !== 'string' || value.length === 0) continue
    result = result.replaceAll(`{{${name}}}`, value)
  }
  return result
}

/**
 * Neutralize every `{{` so the harness's strict interpolation cannot see a group.
 *
 * A single space is inserted between the braces. This is deliberately visible
 * rather than a deletion: the user's text survives, and the preview says the
 * substitution happened.
 *
 * The scan is character-by-character, NOT `replaceAll('{{', '{ {')`. That
 * replacement only handles non-overlapping pairs, so a run of three braces
 * (`{{{a}}}`, which a user writing a template or a code fragment really types)
 * came back as `{ {{a}}}` — still holding a `{{a}}` group, which the harness
 * reads as an unknown variable and **throws on, failing the whole model call**.
 * Consuming one brace at a time leaves no two braces adjacent, whatever the run
 * length.
 *
 * @param text - the text to protect.
 * @returns the text with no `{{` sequence anywhere.
 */
export function escapeGroups(text) {
  const source = String(text ?? '')
  if (!source.includes('{{')) return source
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    // Emit one brace plus a space, then let the NEXT brace pair with the one
    // after it — so a run of N braces is separated N-1 times.
    if (source[index] === '{' && source[index + 1] === '{') result += '{ '
    else result += source[index]
  }
  return result
}

/**
 * Whether escaping would change this text.
 *
 * @param text - the text to test.
 * @returns `true` when {@link escapeGroups} has work to do.
 */
export function needsEscaping(text) {
  return String(text ?? '').includes('{{')
}

/**
 * Join the snippets of one channel into its body.
 *
 * Snippets are separated by a blank line and each keeps its own text verbatim:
 * this plugin frames the block, but it does not reformat what the user wrote.
 *
 * @param snippets - the snippets of one channel, already in order.
 * @param variables - substitution values.
 * @returns the joined body, or `''` when nothing applies.
 */
export function composeBody(snippets, variables) {
  const parts = []
  for (const snippet of snippets) {
    const text = substituteVariables(snippet.text, variables).trim()
    if (text.length > 0) parts.push(text)
  }
  return parts.join('\n\n')
}

/**
 * Truncate text to a character ceiling, on a code-point boundary.
 *
 * Slicing a surrogate pair in half produces a replacement character, so the cut
 * is moved back off a low surrogate first.
 *
 * @param text - the text to bound.
 * @param maxChars - the ceiling; `0` yields the empty string.
 * @returns the bounded text.
 */
export function truncateChars(text, maxChars) {
  const source = String(text ?? '')
  if (maxChars <= 0) return ''
  if (source.length <= maxChars) return source
  let end = Math.trunc(maxChars)
  const code = source.charCodeAt(end - 1)
  if (code >= 0xd800 && code <= 0xdbff) end -= 1
  return source.slice(0, end)
}

/**
 * The notice appended to a channel whose text was cut short.
 *
 * Short on purpose: it is spent out of the very budget it reports on, so a long
 * apology would truncate more of the user's text than the overflow did.
 */
const TRUNCATION_NOTICE = '\n\n[truncated to fit the injection budget]'

/**
 * Apply the shared character budget across the three channels.
 *
 * Over budget, the least specific channel gives way first — `context`, then
 * `message`, then `system`. The standing persona is the text the user most
 * expects to survive, and environment facts are the text most likely to be
 * stale, so this order fails in the least surprising direction.
 *
 * One channel absorbs the whole cut, and it either loses its tail (with the
 * notice below) or goes entirely — never both, and never a chain of notices
 * each eating the budget it was supposed to save. A channel that had to go is
 * reported in `dropped` so the preview can say which one disappeared.
 *
 * @param bodies - `{ system, context, message }` bodies.
 * @param maxChars - the combined ceiling; `0` means no cap.
 * @returns `{ bodies, truncated, dropped, usedChars }`.
 */
export function applyBudget(bodies, maxChars) {
  const result = { system: bodies.system ?? '', context: bodies.context ?? '', message: bodies.message ?? '' }
  const total = () => result.system.length + result.context.length + result.message.length
  if (!Number.isFinite(maxChars) || maxChars <= 0) {
    return { bodies: result, truncated: [], dropped: [], usedChars: total() }
  }

  const truncated = []
  const dropped = []
  for (const channel of ['context', 'message', 'system']) {
    const overflow = total() - maxChars
    if (overflow <= 0) break
    const current = result[channel]
    if (current.length === 0) continue
    // The channel cannot cover the overflow, so it goes whole: keeping a stub of
    // it would cost a notice and say less than nothing.
    if (current.length <= overflow) {
      result[channel] = ''
      dropped.push(channel)
      continue
    }
    const cut = overflow + TRUNCATION_NOTICE.length
    // Cutting far enough to fit the notice would leave less than the notice
    // itself, which reads as a bug rather than as a truncated snippet.
    if (cut >= current.length) {
      result[channel] = ''
      dropped.push(channel)
      continue
    }
    result[channel] = truncateChars(current, current.length - cut) + TRUNCATION_NOTICE
    truncated.push(channel)
  }
  return { bodies: result, truncated, dropped, usedChars: total() }
}

/**
 * The text the runtime-context channel contributes.
 *
 * @param body - the composed body.
 * @returns the escaped body, or `''`.
 */
export function contextText(body) {
  const escaped = escapeGroups(body)
  return escaped.length > 0 ? escaped : ''
}

/**
 * The text the system-prompt section contributes.
 *
 * @param body - the composed body.
 * @returns the body, or `''`.
 */
export function systemText(body) {
  return body.length > 0 ? body : ''
}

/**
 * Wrap the injected user message in the harness's reminder frame.
 *
 * The frame is the same one `dsh-agent-instructions` uses for injected context,
 * and it carries the one warning that matters: these are the user's own
 * standing instructions, so they outrank the model's guesses but never the
 * system prompt or the user's live message. A literal closing tag inside the
 * text is escaped so it cannot end the frame early.
 *
 * @param body - the composed body.
 * @returns the framed message text.
 */
export function messageText(body) {
  const safe = body.replaceAll(REMINDER_CLOSE, `<\\${REMINDER_CLOSE.slice(1)}`)
  return [REMINDER_OPEN, safe, REMINDER_CLOSE].join('\n')
}

/**
 * Compose all three channels for one session.
 *
 * @param selected - `{ system, context, message }` snippet arrays.
 * @param options - `{ variables, maxChars }`.
 * @returns `{ system, context, message, truncated, usedChars, notes, chars }`.
 */
export function composeInjection(selected, options = {}) {
  const variables = options.variables ?? {}
  const raw = {
    system: composeBody(selected.system ?? [], variables),
    context: composeBody(selected.context ?? [], variables),
    message: composeBody(selected.message ?? [], variables),
  }
  const budgeted = applyBudget(raw, options.maxChars ?? 0)
  // Notes are structured codes, not prose: the panel renders them in the user's
  // language, so a Chinese page never shows a host string in English. `channel`
  // rides along for the ones that name one.
  const notes = []
  if (needsEscaping(raw.context)) notes.push({ code: 'escaped' })
  for (const channel of budgeted.truncated) notes.push({ code: 'truncated', channel })
  for (const channel of budgeted.dropped) notes.push({ code: 'dropped', channel })
  return {
    system: systemText(budgeted.bodies.system),
    context: contextText(budgeted.bodies.context),
    message: messageText(budgeted.bodies.message),
    truncated: budgeted.truncated,
    dropped: budgeted.dropped,
    usedChars: budgeted.usedChars,
    notes,
    chars: {
      system: budgeted.bodies.system.length,
      context: budgeted.bodies.context.length,
      message: budgeted.bodies.message.length,
    },
    /** The snippet ids that actually contributed, per channel. */
    contributed: {
      system: (selected.system ?? []).map((snippet) => snippet.id),
      context: (selected.context ?? []).map((snippet) => snippet.id),
      message: (selected.message ?? []).map((snippet) => snippet.id),
    },
  }
}

/**
 * A stable identity for one composed injection.
 *
 * A session compares this against what it was last shown, so an unchanged
 * composition is not re-injected on every step — the same "silent unless it
 * changed" discipline `dsh-memory` applies, and the reason a per-step seam does
 * not spam the transcript.
 *
 * @param injection - a {@link composeInjection} result.
 * @param switches - the effective `{ system, context, message }` booleans.
 * @returns a short deterministic hash.
 */
export function injectionIdentity(injection, switches) {
  const source = JSON.stringify({
    system: switches.system ? injection.system : '',
    context: switches.context ? injection.context : '',
    message: switches.message ? injection.message : '',
  })
  let hash = 5381
  for (let index = 0; index < source.length; index += 1) hash = (33 * hash) ^ source.charCodeAt(index)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
