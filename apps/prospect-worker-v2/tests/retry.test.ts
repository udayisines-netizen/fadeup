import { describe, expect, it } from 'vitest'
import { classifyError, computeBackoffMs } from '../src/retry.js'

describe('classifyError', () => {
  it('never retries 401/403 (invalid credentials / permission denied)', () => {
    expect(classifyError(new Error('nope'), 401).retryable).toBe(false)
    expect(classifyError(new Error('nope'), 403).retryable).toBe(false)
  })

  it('never retries 400/404/422 (bad request)', () => {
    expect(classifyError(new Error('nope'), 400).retryable).toBe(false)
    expect(classifyError(new Error('nope'), 404).retryable).toBe(false)
    expect(classifyError(new Error('nope'), 422).retryable).toBe(false)
  })

  it('retries 429 (rate limited)', () => {
    expect(classifyError(new Error('nope'), 429).retryable).toBe(true)
  })

  it('retries 5xx', () => {
    expect(classifyError(new Error('nope'), 500).retryable).toBe(true)
    expect(classifyError(new Error('nope'), 503).retryable).toBe(true)
  })

  it('retries a timeout error', () => {
    const error = new Error('The operation was aborted')
    error.name = 'AbortError'
    expect(classifyError(error).retryable).toBe(true)
  })

  it('retries a network-level TypeError from fetch', () => {
    const error = new TypeError('fetch failed')
    expect(classifyError(error).retryable).toBe(true)
  })

  it('defaults unknown errors to retryable (bounded by max_attempts elsewhere)', () => {
    expect(classifyError(new Error('mystery failure')).retryable).toBe(true)
  })
})

describe('computeBackoffMs', () => {
  it('grows with attempt number, bounded by maxMs', () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const ms = computeBackoffMs({ attempt, baseMs: 1000, maxMs: 60_000 })
      expect(ms).toBeGreaterThanOrEqual(0)
      expect(ms).toBeLessThanOrEqual(60_000)
    }
  })

  it('attempt 0 is bounded by baseMs', () => {
    for (let i = 0; i < 50; i++) {
      expect(computeBackoffMs({ attempt: 0, baseMs: 1000 })).toBeLessThanOrEqual(1000)
    }
  })
})
