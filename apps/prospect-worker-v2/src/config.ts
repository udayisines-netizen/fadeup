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

  // Transactional email dispatch (public.email_outbox). SMTP_HOST unset
  // simply disables the dispatcher — rows stay queued and visible rather
  // than being silently dropped.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM_NAME: z.string().min(1).default('FadeUp'),
  EMAIL_FROM_ADDRESS: z.string().min(1).default('no-reply@fadeup.app'),
  EMAIL_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  EMAIL_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  EMAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  APP_BASE_URL: z.string().url().default('https://fadeup.app'),

  DEFAULT_COUNTRY: z.string().length(2).default('FR'),
  DEFAULT_LOCALE: z.string().min(2).default('fr-FR'),

  // --- WhatsApp Business Cloud API (official Meta platform only) -------
  // Every one of these is OPTIONAL. With no token present, whatsapp_accounts
  // rows fall back to the MOCK provider and the outreach pipeline stays
  // fully exercisable without sending anything (spec §61). There is no
  // browser-automation fallback and never will be.
  META_WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  // Validates X-Hub-Signature-256 on inbound webhooks. Without it the
  // webhook endpoint stores envelopes but refuses to PROCESS them.
  META_APP_SECRET: z.string().optional(),
  // Echoed back during Meta's webhook subscription challenge.
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  META_GRAPH_API_VERSION: z.string().regex(/^v\d+\.\d+$/).default('v23.0'),
  WHATSAPP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  WHATSAPP_SEND_BATCH_SIZE: z.coerce.number().int().positive().default(25),

  // --- Webhook HTTP listener -------------------------------------------
  // Bound to localhost by default: the endpoint is meant to sit behind the
  // existing Nginx TLS terminator, never exposed directly.
  // Explicit opt-in only: an unset, empty or unrecognised value means
  // disabled, so a typo can never accidentally open an HTTP listener.
  WEBHOOK_HTTP_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  WEBHOOK_HTTP_PORT: z.coerce.number().int().positive().default(8088),
  WEBHOOK_HTTP_HOST: z.string().default('0.0.0.0'),
  WEBHOOK_PATH: z.string().startsWith('/').default('/webhooks/whatsapp'),

  // --- Machine learning -------------------------------------------------
  // Where train.py writes model artifacts and where inference reads them.
  // Inference REFUSES any registry artifact_path outside this directory.
  ML_ARTIFACT_DIR: z.string().default('/app/ml-artifacts'),
  ML_MODEL_CACHE_TTL_MS: z.coerce.number().int().positive().default(300_000),

  // --- Planity public establishment pages -------------------------------
  // No credential: these are public pages. The knobs exist so the source can
  // be slowed or switched off without a deploy; per-source pause/quota is
  // already handled by prospect_sources + api_source_limits and is NOT
  // duplicated here.
  //
  // Explicit opt-in string handling, matching WEBHOOK_HTTP_ENABLED: an unset,
  // empty or unrecognised value means DISABLED, so a typo can never
  // accidentally start sending requests to a third party.
  PLANITY_ENABLED: z
    .string()
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  PLANITY_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  // Deliberately slow: one page per prospect, and a salon's listing does not
  // change minute to minute. There is no volume target to trade against.
  PLANITY_MIN_REQUEST_INTERVAL_MS: z.coerce.number().int().nonnegative().default(2_000),
  PLANITY_BATCH_SIZE: z.coerce.number().int().positive().max(200).default(25),
  PLANITY_RECHECK_AFTER_HOURS: z.coerce.number().int().positive().default(720),

  // --- Website enrichment crawler --------------------------------------
  CRAWLER_MAX_PAGES_PER_DOMAIN: z.coerce.number().int().positive().max(50).default(8),
  CRAWLER_MAX_DEPTH: z.coerce.number().int().nonnegative().max(4).default(2),
  CRAWLER_TOTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
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
