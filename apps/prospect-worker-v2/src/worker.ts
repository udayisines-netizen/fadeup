import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import type { Config } from './config.js'
import { getPool, closePool } from './db.js'
import { logger } from './logger.js'
import { EmailDispatcher } from './email/dispatcher.js'
import { claimNextJob, completeJob, extendLease, failJob, recoverStaleLeases } from './queue/claim.js'
import { classifyError, computeNextAttemptAt } from './retry.js'
import { buildSourceRegistry } from './sources/registry.js'
import { runJob } from './jobs/runner.js'
import { HttpError } from './quota.js'
import { ModelCache } from './ml/inference.js'
import { WebhookServer } from './whatsapp/webhook-server.js'

const LEASE_SECONDS = 300
const LEASE_EXTEND_INTERVAL_MS = (LEASE_SECONDS * 1000) / 2
const STALE_LEASE_SWEEP_INTERVAL_MS = 60_000

// Liveness signal for Docker's HEALTHCHECK (see Dockerfile +
// healthcheck.js) — this is a background worker with no HTTP endpoint, so
// "healthy" means "a poll loop touched this file recently", not "an HTTP
// server answered". Written on every lane's poll iteration, whether or
// not a job was claimed that cycle.
const HEARTBEAT_FILE = process.env['HEARTBEAT_FILE'] ?? '/tmp/prospect-worker-heartbeat'

export class ProspectWorker {
  private readonly emailDispatcher: EmailDispatcher
  private readonly webhookServer: WebhookServer
  private readonly modelCache: ModelCache
  private readonly workerId: string
  private readonly pool
  private readonly sources
  private running = false
  private staleLeaseTimer: NodeJS.Timeout | undefined
  private inFlight = 0

  constructor(private readonly config: Config) {
    this.workerId = `${config.WORKER_NAME}-${randomUUID().slice(0, 8)}`
    this.pool = getPool(config)
    this.sources = buildSourceRegistry(config)
    // Shares this worker's pool and lifecycle: it is a second small queue
    // consumer, not a second service.
    this.emailDispatcher = new EmailDispatcher(this.pool, config)
    // The WhatsApp webhook listener. Disabled unless WEBHOOK_HTTP_ENABLED
    // is set, so the Worker stays a pure outbound process by default.
    this.webhookServer = new WebhookServer(this.pool, config, logger.child({ component: 'webhook' }))
    // Promoted-model cache for template ranking. Holding it on the worker
    // (not per-job) means one artifact read per TTL rather than per
    // recipient.
    this.modelCache = new ModelCache(config.ML_ARTIFACT_DIR, config.ML_MODEL_CACHE_TTL_MS)
  }

  async start(): Promise<void> {
    this.running = true
    logger.info('worker starting', { worker_id: this.workerId, concurrency: this.config.WORKER_CONCURRENCY })

    // No pg_cron in this environment (see db/migrations/20260811150200's
    // header) — the Worker sweeps stale leases itself, opportunistically,
    // same pattern as LOT 13's no-show rule.
    this.staleLeaseTimer = setInterval(() => void this.sweepStaleLeases(), STALE_LEASE_SWEEP_INTERVAL_MS)
    this.emailDispatcher.start()
    this.webhookServer.start()
    void this.sweepStaleLeases()

    const lanes = Array.from({ length: this.config.WORKER_CONCURRENCY }, (_, i) => this.runLane(i))
    await Promise.all(lanes)
  }

  async stop(): Promise<void> {
    await this.emailDispatcher.stop()
    await this.webhookServer.stop()
    logger.info('worker stopping — waiting for in-flight jobs to finish', { worker_id: this.workerId, in_flight: this.inFlight })
    this.running = false
    if (this.staleLeaseTimer) clearInterval(this.staleLeaseTimer)

    const deadline = Date.now() + 30_000
    while (this.inFlight > 0 && Date.now() < deadline) {
      await sleep(250)
    }
    await closePool()
    logger.info('worker stopped', { worker_id: this.workerId })
  }

  private async sweepStaleLeases(): Promise<void> {
    try {
      const count = await recoverStaleLeases(this.pool)
      if (count > 0) logger.warn('recovered stale job leases', { count })
    } catch (error) {
      logger.error('stale lease sweep failed', error)
    }
  }

  private async runLane(lane: number): Promise<void> {
    const laneLog = logger.child({ worker_id: this.workerId, lane })
    while (this.running) {
      await this.writeHeartbeat()
      const job = await this.claimSafely(laneLog)
      if (!job) {
        await sleep(this.config.WORKER_POLL_INTERVAL_MS)
        continue
      }

      this.inFlight++
      const jobLog = laneLog.child({ job_id: job.id, job_type: job.jobType })
      const leaseExtender = setInterval(() => void extendLease(this.pool, job.id, this.workerId, LEASE_SECONDS), LEASE_EXTEND_INTERVAL_MS)

      try {
        jobLog.info('job started', { attempt: job.attempts })
        const result = await runJob(
          {
            pool: this.pool,
            config: this.config,
            sources: this.sources,
            modelCache: this.modelCache,
            log: jobLog,
          },
          job,
        )
        await completeJob(this.pool, job.id, this.workerId, result)
        jobLog.info('job completed', { result })
      } catch (error) {
        const statusCode = error instanceof HttpError ? error.statusCode : undefined
        const { retryable, reason } = classifyError(error, statusCode)
        const message = error instanceof Error ? error.message : String(error)
        jobLog.error('job failed', error, { retryable, reason })
        await failJob(this.pool, job.id, this.workerId, message, retryable, retryable ? computeNextAttemptAt(job.attempts) : undefined)
      } finally {
        clearInterval(leaseExtender)
        this.inFlight--
      }
    }
  }

  private async writeHeartbeat(): Promise<void> {
    try {
      await writeFile(HEARTBEAT_FILE, String(Date.now()), 'utf-8')
    } catch (error) {
      logger.warn('failed to write heartbeat file', { error: error instanceof Error ? error.message : String(error) })
    }
  }

  private async claimSafely(log: ReturnType<typeof logger.child>) {
    try {
      return await claimNextJob(this.pool, this.workerId, LEASE_SECONDS)
    } catch (error) {
      log.error('claim failed — will retry after poll interval', error)
      return null
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
