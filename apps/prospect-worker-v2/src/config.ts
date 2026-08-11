import { z } from 'zod'

// Every key here matches infra/worker/.env.worker exactly — that file is
// gitignored and already provisioned; this module only describes its
// shape and validates it at startup. Never widen this schema to accept a
// key that isn't also documented in docs/worker-v2/operations.md.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  WORKER_NAME: z.string().min(1).default('prospect-worker-v2'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL: z.coerce.boolean().default(false),

  // Every one of these is OPTIONAL — an empty/missing key means "that
  // source/adapter is unusable", never a startup failure. See
  // src/sources/registry.ts for how adapters check their own credential.
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  GEOAPIFY_API_KEY: z.string().optional(),
  INSEE_API_KEY: z.string().optional(),
  META_ACCESS_TOKEN: z.string().optional(),
  META_INSTAGRAM_BUSINESS_ACCOUNT_ID: z.string().optional(),

  OVERPASS_ENDPOINT: z.string().url().default('https://overpass-api.de/api/interpreter'),

  GOOGLE_MAX_REQUESTS_PER_MINUTE: z.coerce.number().int().positive().default(20),
  GEOAPIFY_MAX_REQUESTS_PER_SECOND: z.coerce.number().int().positive().default(5),
  OVERPASS_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().positive().default(2),
  INSEE_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().positive().default(2),

  DEFAULT_COUNTRY: z.string().length(2).default('FR'),
  DEFAULT_LOCALE: z.string().min(2).default('fr-FR'),
})

export type Config = z.infer<typeof envSchema>

let cached: Config | undefined

/** Validates process.env once and caches the result. Throws with a clear, secret-free message if a REQUIRED key is missing — DB_* only, never an optional provider key. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached

  const result = envSchema.safeParse(env)
  if (!result.success) {
    const missing = result.error.issues.map((issue) => issue.path.join('.')).join(', ')
    throw new Error(`Prospect Worker V2 config invalid — check these keys in infra/worker/.env.worker: ${missing}`)
  }

  cached = result.data
  return cached
}

/** Test-only: clears the cached config so a test can load a different process.env. */
export function resetConfigCache(): void {
  cached = undefined
}
