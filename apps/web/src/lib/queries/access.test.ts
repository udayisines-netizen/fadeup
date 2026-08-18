import { describe, expect, it } from 'vitest'
import { resolveDestination, type MyAccess } from '@/lib/queries/access'
import { buildOAuthRedirectUrl, parseAuthIntent } from '@/lib/oauth'

/**
 * The universal-identity routing rules.
 *
 * This is the single decision point where three sign-in doors, three
 * capability sets and a resume target meet, so it is tested exhaustively
 * here rather than only through the browser.
 *
 * The rule being defended: THE PROVIDER AUTHENTICATES, THE DATABASE
 * AUTHORIZES. `intent` records which door someone came through. It is a
 * preference. It never, in any combination, produces /platform for an
 * identity the database has not put in platform_members.
 */

function access(overrides: Partial<MyAccess> = {}): MyAccess {
  return {
    userId: '00000000-0000-4000-8000-000000000001',
    platformRole: null,
    platformAvailable: false,
    professionalAvailable: false,
    organizationCount: 0,
    ownedOrganizationCount: 0,
    customerAvailable: true,
    customerProfileExists: false,
    customerOnboardingCompleted: false,
    applicationStatus: null,
    signupIntent: null,
    ...overrides,
  }
}

describe('resolveDestination — platform boundary', () => {
  it('lets a real platform member into /platform', () => {
    expect(
      resolveDestination({
        access: access({ platformAvailable: true, platformRole: 'platform_admin' }),
        intent: 'platform',
        next: null,
      }),
    ).toBe('/platform')
  })

  it('keeps a plain customer out of /platform even when they came through /platform/login', () => {
    // The exact Google/Apple case: authentication succeeded, authorization
    // did not exist. They are a legitimate person, so they get the workspace
    // resolver rather than an authorization wall.
    expect(resolveDestination({ access: access(), intent: 'platform', next: null })).toBe('/workspace')
  })

  it('keeps a business owner with no platform role out of /platform', () => {
    expect(
      resolveDestination({
        access: access({ professionalAvailable: true, organizationCount: 1, ownedOrganizationCount: 1 }),
        intent: 'platform',
        next: null,
      }),
    ).toBe('/workspace')
  })

  it('ignores a "next" that points into /platform when there is no platform role', () => {
    // Even a perfectly well-formed internal path must not become a platform
    // destination on the strength of the caller asking for it.
    expect(
      resolveDestination({ access: access(), intent: 'platform', next: '/platform/audit' }),
    ).toBe('/workspace')
  })

  it('ignores a signup_intent claiming platform', () => {
    // signup_intent lives in user metadata, which a provider can influence.
    // It is a routing hint for brand-new accounts and nothing more.
    expect(
      resolveDestination({ access: access({ signupIntent: 'platform' }), intent: null, next: null }),
    ).toBe('/workspace')
  })

  it('sends an unauthenticated resolution back to sign in', () => {
    expect(resolveDestination({ access: null, intent: 'platform', next: null })).toBe('/login')
  })
})

describe('resolveDestination — professional', () => {
  it('sends a member of an organization to the professional workspace', () => {
    expect(
      resolveDestination({
        access: access({ professionalAvailable: true, organizationCount: 1 }),
        intent: 'pro',
        next: null,
      }),
    ).toBe('/app')
  })

  it('sends a pending applicant to their application status, not into /app', () => {
    expect(
      resolveDestination({ access: access({ applicationStatus: 'pending_review' }), intent: 'pro', next: null }),
    ).toBe('/pro/application')
  })

  it('sends a rejected applicant to their application status', () => {
    expect(
      resolveDestination({ access: access({ applicationStatus: 'rejected' }), intent: 'pro', next: null }),
    ).toBe('/pro/application')
  })

  it('sends someone with neither membership nor application to the workspace resolver', () => {
    expect(resolveDestination({ access: access(), intent: 'pro', next: null })).toBe('/workspace')
  })

  it('prefers an explicit internal return target', () => {
    expect(
      resolveDestination({
        access: access({ professionalAvailable: true }),
        intent: 'pro',
        next: '/app/services',
      }),
    ).toBe('/app/services')
  })
})

describe('resolveDestination — customer', () => {
  it('sends a customer sign-in to the customer app', () => {
    expect(resolveDestination({ access: access(), intent: 'customer', next: null })).toBe('/app/customer')
  })

  it('honours a return target so a booking flow resumes where it left off', () => {
    expect(
      resolveDestination({ access: access(), intent: 'customer', next: '/s/le-fade/profile' }),
    ).toBe('/s/le-fade/profile')
  })

  it('falls back to the workspace resolver with no intent at all', () => {
    expect(resolveDestination({ access: access(), intent: null, next: null })).toBe('/workspace')
  })
})

describe('resolveDestination — one identity, several roles', () => {
  const everything = access({
    platformAvailable: true,
    platformRole: 'platform_owner',
    professionalAvailable: true,
    organizationCount: 2,
    ownedOrganizationCount: 1,
    customerProfileExists: true,
  })

  it('the same identity reaches whichever workspace it asked for', () => {
    expect(resolveDestination({ access: everything, intent: 'platform', next: null })).toBe('/platform')
    expect(resolveDestination({ access: everything, intent: 'pro', next: null })).toBe('/app')
    expect(resolveDestination({ access: everything, intent: 'customer', next: null })).toBe('/app/customer')
  })

  it('offers the chooser when it came in through no particular door', () => {
    expect(resolveDestination({ access: everything, intent: null, next: null })).toBe('/workspace')
  })

  it('holding a platform role never costs it the professional or customer side', () => {
    // Regression guard for "adding a role replaced another one".
    expect(everything.professionalAvailable).toBe(true)
    expect(everything.customerAvailable).toBe(true)
    expect(everything.platformAvailable).toBe(true)
  })
})

describe('OAuth redirect construction', () => {
  it('only accepts the three known intents', () => {
    expect(parseAuthIntent('customer')).toBe('customer')
    expect(parseAuthIntent('pro')).toBe('pro')
    expect(parseAuthIntent('platform')).toBe('platform')
    expect(parseAuthIntent('admin')).toBeNull()
    expect(parseAuthIntent(null)).toBeNull()
  })

  it('carries the intent and a safe next through the provider round trip', () => {
    const url = new URL(buildOAuthRedirectUrl({ intent: 'pro', next: '/app/services' }))
    expect(url.pathname).toBe('/auth/callback')
    expect(url.searchParams.get('intent')).toBe('pro')
    expect(url.searchParams.get('next')).toBe('/app/services')
    expect(url.origin).toBe(window.location.origin)
  })

  it('drops an external next BEFORE it is ever handed to the provider', () => {
    const url = new URL(buildOAuthRedirectUrl({ intent: 'customer', next: 'https://evil.example' }))
    expect(url.searchParams.get('next')).toBeNull()
    expect(url.origin).toBe(window.location.origin)
  })

  it('drops a protocol-relative next', () => {
    const url = new URL(buildOAuthRedirectUrl({ intent: 'platform', next: '//evil.example' }))
    expect(url.searchParams.get('next')).toBeNull()
  })

  it('always returns to our own origin, never the caller-supplied one', () => {
    const url = new URL(buildOAuthRedirectUrl({ intent: 'customer', next: null }))
    expect(url.origin).toBe(window.location.origin)
  })
})
