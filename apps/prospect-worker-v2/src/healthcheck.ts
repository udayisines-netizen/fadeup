import { readFile } from 'node:fs/promises'

// Run by Docker's HEALTHCHECK (see Dockerfile). "Healthy" means the poll
// loop wrote a heartbeat within the last 3 poll intervals (default
// 15s, generous enough to absorb a slow job holding a lane without
// flapping the healthcheck) — see src/worker.ts's writeHeartbeat().
const HEARTBEAT_FILE = process.env['HEARTBEAT_FILE'] ?? '/tmp/prospect-worker-heartbeat'
const MAX_STALENESS_MS = 3 * Number(process.env['WORKER_POLL_INTERVAL_MS'] ?? 5000)

async function main(): Promise<void> {
  const raw = await readFile(HEARTBEAT_FILE, 'utf-8')
  const lastHeartbeatAt = Number(raw)
  if (!Number.isFinite(lastHeartbeatAt)) {
    throw new Error('heartbeat file contents are not a valid timestamp')
  }
  const staleness = Date.now() - lastHeartbeatAt
  if (staleness > MAX_STALENESS_MS) {
    throw new Error(`heartbeat is stale (${staleness}ms > ${MAX_STALENESS_MS}ms)`)
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`unhealthy: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  })
