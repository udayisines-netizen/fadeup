/**
 * V2 translations live in ONE i18next namespace, `v2`, assembled from six
 * section files per locale (`locales/<lng>/{common,auth,nav,errors,states,empty}.json`).
 *
 * Why one namespace: the legacy /platform surface already owns the
 * `common` and `auth` namespace names with entirely different key trees, and
 * it is in production — mounting V2 keys into those trees would gamble the
 * platform console's copy on merge order. A single fresh namespace keeps the
 * two worlds airtight while preserving the P1b key convention verbatim:
 * `v2:auth.login.submit`, `v2:states.queue.full`, `v2:empty.bookings.title`.
 */
export const V2_NAMESPACE = 'v2' as const

export const V2_SECTIONS = ['common', 'auth', 'nav', 'errors', 'states', 'empty'] as const
export type V2Section = (typeof V2_SECTIONS)[number]

/** The launch selector exposes exactly these, even though the DB constraint allows ten. */
export const V2_LOCALES = ['fr', 'en'] as const
export type V2Locale = (typeof V2_LOCALES)[number]
