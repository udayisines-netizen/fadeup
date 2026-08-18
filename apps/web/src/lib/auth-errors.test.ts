import { describe, expect, it } from 'vitest'
import { authErrorKey, classifyAuthError, isAlreadyRegistered } from '@/lib/auth-errors'

/**
 * The production symptom this exists to remove: someone who already has a
 * FadeUp account starts the professional journey, reaches a create-account
 * form, and is shown GoTrue's raw "User already registered" — which tells
 * them they have an account but not what to do, and reads like a bug.
 */

/** Supabase returns a plain object whose `instanceof Error` is false. */
function supabaseError(message: string) {
  return { message, status: 400, name: 'AuthApiError' }
}

describe('classifyAuthError', () => {
  it('recognises the duplicate-registration cases across GoTrue wordings', () => {
    // The exact string changes between versions and is never localized, so
    // matching is on stable substrings rather than equality.
    expect(classifyAuthError(supabaseError('User already registered'))).toBe('alreadyRegistered')
    expect(classifyAuthError(supabaseError('A user with this email address has already been registered'))).toBe(
      'alreadyRegistered',
    )
    expect(classifyAuthError(supabaseError('user already exists'))).toBe('alreadyRegistered')
    expect(classifyAuthError(new Error('User already registered'))).toBe('alreadyRegistered')
  })

  it('recognises the other cases a sign-in form actually hits', () => {
    expect(classifyAuthError(supabaseError('Invalid login credentials'))).toBe('invalidCredentials')
    expect(classifyAuthError(supabaseError('Email not confirmed'))).toBe('emailNotConfirmed')
    expect(classifyAuthError(supabaseError('Request rate limit reached'))).toBe('rateLimited')
    expect(classifyAuthError(supabaseError('Password should be at least 8 characters'))).toBe('weakPassword')
  })

  it('falls back to unknown rather than guessing', () => {
    // A wrong guess that swallowed a real error would be worse than showing
    // it, so callers keep the provider's own message for this case.
    expect(classifyAuthError(supabaseError('Database connection failed'))).toBe('unknown')
    expect(classifyAuthError(null)).toBe('unknown')
    expect(classifyAuthError(undefined)).toBe('unknown')
    expect(classifyAuthError({})).toBe('unknown')
  })
})

describe('isAlreadyRegistered', () => {
  it('is true only for the duplicate case', () => {
    expect(isAlreadyRegistered(supabaseError('User already registered'))).toBe(true)
    expect(isAlreadyRegistered(supabaseError('Invalid login credentials'))).toBe(false)
    expect(isAlreadyRegistered(null)).toBe(false)
  })
})

describe('authErrorKey', () => {
  it('maps every known kind into the auth namespace', () => {
    expect(authErrorKey('alreadyRegistered')).toBe('errors.alreadyRegistered')
    expect(authErrorKey('invalidCredentials')).toBe('errors.invalidCredentials')
    expect(authErrorKey('emailNotConfirmed')).toBe('errors.emailNotConfirmed')
    expect(authErrorKey('rateLimited')).toBe('errors.rateLimited')
    expect(authErrorKey('weakPassword')).toBe('errors.weakPassword')
  })

  it('returns null for unknown so the real message survives', () => {
    expect(authErrorKey('unknown')).toBeNull()
  })
})
