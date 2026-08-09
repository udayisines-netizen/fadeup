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
