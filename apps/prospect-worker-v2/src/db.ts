import pg from 'pg'
import type { Config } from './config.js'

const { Pool } = pg
export type DbPool = pg.Pool

let pool: DbPool | undefined

/**
 * Connects as the dedicated `prospect_worker` Postgres role (see
 * db/migrations/20260811150100_prospect_acquisition_schema.sql) — never
 * postgres/service_role. This is a DIRECT TCP connection, not PostgREST:
 * the job queue needs `FOR UPDATE SKIP LOCKED`, which PostgREST cannot
 * express, and RLS policies scoped `to prospect_worker` are what actually
 * constrain what this connection can touch (see that migration's header
 * for the full rationale — no BYPASSRLS, no superuser).
 */
export function getPool(config: Config): DbPool {
  if (pool) return pool

  pool = new Pool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    database: config.DB_NAME,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    ssl: config.DB_SSL ? { rejectUnauthorized: true } : undefined,
    max: config.WORKER_CONCURRENCY + 2,
    idleTimeoutMillis: 30_000,
  })

  return pool
}

export async function closePool(): Promise<void> {
  if (!pool) return
  await pool.end()
  pool = undefined
}

/** Test-only: inject a pre-built pool (e.g. pointed at a test database) instead of building one from config. */
export function setPool(p: DbPool): void {
  pool = p
}
