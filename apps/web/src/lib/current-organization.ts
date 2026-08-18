// Simple, real (not throwaway) mechanism for remembering which organization
// the current user last worked in. A user can belong to multiple
// organizations (memberships is many-to-many via user_id); later lots that
// build org-scoped views on top of /app will read/write the same key.
const STORAGE_KEY = 'fadeup.currentOrganizationId'

export function getStoredOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    // Storage may be unavailable (private browsing, disabled storage, SSR).
    return null
  }
}

export function setStoredOrganizationId(organizationId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, organizationId)
  } catch {
    // Selection just won't persist across reloads — non-fatal.
  }
}

/**
 * THE rule for "which organization is this user working in", in one place.
 *
 * Three callers need it — CurrentOrgProvider (the /app workspace),
 * RequireProAccess (the setup-vs-workspace decision) and the onboarding
 * wizard — and three copies is how they drift into disagreeing about which
 * shop is being configured.
 *
 * `preferredId` is a PREFERENCE, never authority. It comes from localStorage
 * or a `?org=` parameter, both of which a user can set to anything. It is
 * honoured only when it appears in `memberships`, which is itself the
 * RLS-scoped answer from the database — so an id for someone else's
 * organization silently falls back to one the caller genuinely belongs to
 * rather than being trusted. Even if this returned a foreign id, every
 * downstream read and write is re-checked server-side; this function is
 * about picking sensibly, not about permission.
 */
export function resolveActiveOrganizationId<T extends { organizationId: string }>(
  memberships: readonly T[],
  preferredId: string | null | undefined,
): string | null {
  if (memberships.length === 0) return null
  const preferred = memberships.find((membership) => membership.organizationId === preferredId)
  return (preferred ?? memberships[0]).organizationId
}
