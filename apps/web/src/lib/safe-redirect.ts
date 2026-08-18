/**
 * Where a sign-in is allowed to send someone afterwards.
 *
 * Every auth entry point takes a `?redirect=` parameter so a visitor who hit
 * a protected page lands back on it, and OAuth adds a second, sharper edge:
 * the value survives a round trip through an external identity provider and
 * comes back as part of a URL the browser will actually navigate to. An
 * unvalidated value there is a textbook open redirect — a link that looks
 * like it goes to FadeUp, briefly does, and then hands the visitor to an
 * attacker's page with the credibility of having just passed a real sign-in.
 *
 * The rule is "same-origin internal path, or nothing". Not a deny-list of
 * bad shapes — a deny-list is a list of the tricks somebody already thought
 * of, and browsers keep inventing more (`//host`, `/\host`, `/%2f%2fhost`,
 * `https:/host`, control characters, tab/newline splitting). This validates
 * by CONSTRUCTION instead: parse the candidate against the real origin and
 * accept it only if it resolved back to that same origin.
 */

/** Where each entry point sends someone when there is no safe explicit target. */
export const DEFAULT_AFTER_AUTH = '/workspace'

function currentOrigin(): string {
  // Non-browser contexts (tests, any future SSR) get a stable placeholder;
  // it only ever serves as the base for relative-URL parsing.
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://fadeup.invalid'
}

/**
 * Normalizes a caller-supplied redirect target to a safe internal path, or
 * returns null when it is not one.
 *
 * Accepts: '/app/customer', '/search?q=fade#top'
 * Rejects: 'https://evil.example', '//evil.example', '/\\evil.example',
 *          'javascript:...', 'data:...', a same-path-different-host URL,
 *          and anything containing a newline, tab or NUL (header/URL
 *          splitting).
 */
export function safeInternalPath(target: string | null | undefined): string | null {
  if (!target) return null

  // Control characters never legitimately appear in one of our paths, and
  // are the raw material for splitting attacks: a tab or newline inside a
  // URL is stripped by some parsers and honoured by others, so one string
  // can mean two destinations. Written as escapes, never literal bytes.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(target)) return null

  // Must be root-relative. This alone rejects 'https://evil.example' and
  // every scheme-based payload, but NOT '//evil.example' (protocol-relative)
  // or '/\evil.example' (which several browsers normalize to '//'), so the
  // origin check below is what actually closes those.
  if (!target.startsWith('/')) return null

  let parsed: URL
  try {
    parsed = new URL(target, currentOrigin())
  } catch {
    return null
  }

  // The decisive check: after the browser's own parsing rules have been
  // applied, did this still resolve to us?
  if (parsed.origin !== currentOrigin()) return null

  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/**
 * The same rule, narrowed to a prefix — `/platform/login` uses it so a
 * platform sign-in can never be steered into the customer or professional
 * app by a crafted link.
 *
 * This is a UX/anti-confusion boundary, not the authorization boundary:
 * RequirePlatformRole re-checks platform_members on arrival regardless of
 * how someone got there.
 */
export function safeInternalPathWithin(
  target: string | null | undefined,
  prefix: string,
): string | null {
  const path = safeInternalPath(target)
  if (!path) return null
  // `=== prefix` covers the bare '/platform'; the trailing slash stops
  // '/platform-evil' from passing a naive startsWith.
  if (path !== prefix && !path.startsWith(`${prefix}/`)) return null
  return path
}

/** safeInternalPath with a fallback, for the common "redirect or default" case. */
export function safeRedirectOr(target: string | null | undefined, fallback: string): string {
  return safeInternalPath(target) ?? fallback
}
