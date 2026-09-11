export interface Env {
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_ANON_KEY: string
  /** Gates the /demo composition shell. Absent (thus disabled) in production. */
  VITE_ENABLE_DEMO?: string | undefined
  /**
   * X1 — error tracking. Absent: reporting is a no-op and the Sentry SDK is
   * never even downloaded. The DSN is public by construction (it ships in the
   * bundle); the sourcemap upload token is NOT this and never appears here.
   */
  VITE_SENTRY_DSN?: string | undefined
  /** Release identifier stamped on error events (set by the build). */
  VITE_SENTRY_RELEASE?: string | undefined
}

let cached: Env | null = null

/**
 * Validated, browser-safe (`VITE_`-prefixed only) runtime configuration.
 *
 * PERF: hand-rolled validation (was zod) — this module sits in the consumer
 * entry graph (guards, supabase client), and zod's ~13 KB gzip bought two
 * required checks. Same contract: throws at first use on a missing/invalid
 * value; optional values pass through untouched.
 */
export function getEnv(): Env {
  if (!cached) {
    const url = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (typeof url !== 'string' || !isValidUrl(url)) {
      throw new Error('Invalid environment: VITE_SUPABASE_URL must be a valid URL')
    }
    if (typeof anonKey !== 'string' || anonKey.length < 1) {
      throw new Error('Invalid environment: VITE_SUPABASE_ANON_KEY must be a non-empty string')
    }
    cached = {
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_ANON_KEY: anonKey,
      VITE_ENABLE_DEMO: optionalString(import.meta.env.VITE_ENABLE_DEMO),
      VITE_SENTRY_DSN: optionalString(import.meta.env.VITE_SENTRY_DSN),
      VITE_SENTRY_RELEASE: optionalString(import.meta.env.VITE_SENTRY_RELEASE),
    }
  }
  return cached
}

export function isDemoEnabled(): boolean {
  return getEnv().VITE_ENABLE_DEMO === 'true'
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
