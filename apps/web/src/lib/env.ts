export interface Env {
  VITE_SUPABASE_URL: string
  VITE_SUPABASE_ANON_KEY: string
}

let cached: Env | null = null

/**
 * Validates and returns public runtime config. Only ever reads
 * `VITE_`-prefixed, browser-safe values — never a secret key.
 *
 * PERF: hand-rolled validation (was zod) — this module sits in the consumer
 * entry graph via the supabase client, and zod's ~13 KB gzip bought two
 * checks. Same contract: throws at first use when a value is missing/invalid.
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
    cached = { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: anonKey }
  }
  return cached
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}
