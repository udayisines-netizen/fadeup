import { z } from 'zod'

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/**
 * Validates and returns public runtime config. Only ever reads
 * `VITE_`-prefixed, browser-safe values — never a secret key.
 */
export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(import.meta.env)
  }
  return cached
}
