import { describe, expect, it } from 'vitest'
import { resolveActiveOrganizationId } from '@/lib/current-organization'

/**
 * One rule, three callers: CurrentOrgProvider, RequireProAccess and the
 * onboarding wizard. It used to be written out separately in each, which is
 * how they drift into disagreeing about which shop is being configured — and
 * a setup wizard editing the wrong business is a genuinely bad failure.
 */

const orgA = { organizationId: 'org-a' }
const orgB = { organizationId: 'org-b' }

describe('resolveActiveOrganizationId', () => {
  it('returns null when there are no memberships', () => {
    expect(resolveActiveOrganizationId([], 'org-a')).toBeNull()
    expect(resolveActiveOrganizationId([], null)).toBeNull()
  })

  it('resolves a single membership automatically, whatever the preference says', () => {
    expect(resolveActiveOrganizationId([orgA], null)).toBe('org-a')
    expect(resolveActiveOrganizationId([orgA], 'org-a')).toBe('org-a')
  })

  it('honours a preference that names an organization the user belongs to', () => {
    expect(resolveActiveOrganizationId([orgA, orgB], 'org-b')).toBe('org-b')
  })

  it('IGNORES a preference for an organization the user does not belong to', () => {
    // The injection case. `preferredId` comes from localStorage or `?org=`,
    // both of which a user can set to anything; the membership list is the
    // RLS-scoped answer from the database, so it is what decides.
    expect(resolveActiveOrganizationId([orgA], 'org-somebody-else')).toBe('org-a')
    expect(resolveActiveOrganizationId([orgA, orgB], '../../etc/passwd')).toBe('org-a')
    expect(resolveActiveOrganizationId([orgA, orgB], '')).toBe('org-a')
  })

  it('falls back to the first membership when there is no preference', () => {
    expect(resolveActiveOrganizationId([orgA, orgB], null)).toBe('org-a')
    expect(resolveActiveOrganizationId([orgA, orgB], undefined)).toBe('org-a')
  })

  it('is stable — the same inputs always resolve the same organization', () => {
    const memberships = [orgA, orgB]
    const first = resolveActiveOrganizationId(memberships, 'org-b')
    expect(resolveActiveOrganizationId(memberships, 'org-b')).toBe(first)
  })
})
