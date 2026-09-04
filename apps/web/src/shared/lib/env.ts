import { z } from 'zod'

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(1),
  /** Gates the /demo composition shell. Absent (thus disabled) in production. */
  VITE_ENABLE_DEMO: z.string().optional(),
})

export type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/** Validated, browser-safe (`VITE_`-prefixed only) runtime configuration. */
export function getEnv(): Env {
  if (!cached) {
    cached = envSchema.parse(import.meta.env)
  }
  return cached
}

export function isDemoEnabled(): boolean {
  return getEnv().VITE_ENABLE_DEMO === 'true'
}
