import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { DbPool } from '../db.js'
import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import {
  handleVerification,
  markEnvelopeProcessed,
  parseWebhookPayload,
  processWebhookEvent,
  recordWebhookEnvelope,
  verifySignature,
} from './webhook.js'

/**
 * The WhatsApp webhook listener.
 *
 * A deliberately minimal HTTP server (no framework, no new dependency) —
 * it serves exactly two routes and is intended to sit behind the existing
 * Nginx TLS terminator, never to face the Internet directly. It binds
 * inside the container network and exposes no other surface.
 *
 * Security posture:
 *   - Body size is capped before parsing, so a large POST cannot exhaust
 *     memory.
 *   - Signature verification runs on the RAW bytes.
 *   - An unverified payload is STORED (for forensics) but never processed.
 *   - Meta is acknowledged with 200 as soon as the envelope is durable;
 *     processing failures are recorded, not surfaced as a 500, because a
 *     non-2xx makes Meta retry the same payload indefinitely.
 */

const MAX_BODY_BYTES = 1024 * 1024

export class WebhookServer {
  private server: Server | undefined

  constructor(
    private readonly pool: DbPool,
    private readonly config: Config,
    private readonly log: Logger,
  ) {}

  start(): void {
    if (!this.config.WEBHOOK_HTTP_ENABLED) {
      this.log.info('webhook server: disabled (WEBHOOK_HTTP_ENABLED is not true)')
      return
    }

    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        this.log.error('webhook server: unhandled error', error)
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'text/plain' })
          res.end('internal error')
        }
      })
    })

    this.server.listen(this.config.WEBHOOK_HTTP_PORT, this.config.WEBHOOK_HTTP_HOST, () => {
      this.log.info('webhook server: listening', {
        host: this.config.WEBHOOK_HTTP_HOST,
        port: this.config.WEBHOOK_HTTP_PORT,
        path: this.config.WEBHOOK_PATH,
        signature_validation: this.config.META_APP_SECRET ? 'enabled' : 'DISABLED — META_APP_SECRET is not set',
      })
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    await new Promise<void>((resolve) => this.server?.close(() => resolve()))
    this.server = undefined
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

    // Liveness, for the container healthcheck and the reverse proxy.
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
      return
    }

    if (url.pathname !== this.config.WEBHOOK_PATH) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }

    if (req.method === 'GET') {
      this.handleVerificationRequest(url, res)
      return
    }

    if (req.method !== 'POST') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST' })
      res.end('method not allowed')
      return
    }

    await this.handleEvent(req, res)
  }

  private handleVerificationRequest(url: URL, res: ServerResponse): void {
    const verifyToken = this.config.META_WEBHOOK_VERIFY_TOKEN
    if (!verifyToken) {
      this.log.warn('webhook server: verification attempted but META_WEBHOOK_VERIFY_TOKEN is not configured')
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
      return
    }

    const challenge = handleVerification(
      {
        mode: url.searchParams.get('hub.mode'),
        token: url.searchParams.get('hub.verify_token'),
        challenge: url.searchParams.get('hub.challenge'),
      },
      verifyToken,
    )

    if (challenge === null) {
      this.log.warn('webhook server: verification challenge rejected')
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
      return
    }

    this.log.info('webhook server: verification challenge accepted')
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(challenge)
  }

  private async handleEvent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let rawBody: Buffer
    try {
      rawBody = await readBody(req, MAX_BODY_BYTES)
    } catch {
      res.writeHead(413, { 'content-type': 'text/plain' })
      res.end('payload too large')
      return
    }

    const signatureHeader = headerValue(req.headers['x-hub-signature-256'])
    const appSecret = this.config.META_APP_SECRET

    // Without an app secret we cannot prove authenticity. Store the
    // envelope for forensics, acknowledge so Meta stops retrying, and
    // refuse to act on it.
    const signatureValid = appSecret ? verifySignature(rawBody, signatureHeader, appSecret) : false

    let payload: unknown
    try {
      payload = JSON.parse(rawBody.toString('utf-8'))
    } catch {
      this.log.warn('webhook server: payload is not valid JSON — acknowledged and discarded')
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }

    const events = parseWebhookPayload(payload)

    if (events.length === 0) {
      // An envelope shape we do not handle (e.g. a template status update).
      // Acknowledge; retrying would not help.
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }

    for (const event of events) {
      const isNew = await recordWebhookEnvelope(this.pool, {
        providerEventId: event.providerEventId,
        eventType: event.kind,
        payload,
        signatureValid,
        whatsappAccountId: null,
      })

      if (!isNew) {
        this.log.debug('webhook server: duplicate delivery ignored', { provider_event_id: event.providerEventId })
        continue
      }

      if (!signatureValid) {
        this.log.warn('webhook server: signature invalid or unverifiable — envelope stored but NOT processed', {
          provider_event_id: event.providerEventId,
          app_secret_configured: Boolean(appSecret),
        })
        await markEnvelopeProcessed(this.pool, event.providerEventId, 'signature_invalid_or_unverifiable')
        continue
      }

      try {
        await processWebhookEvent(this.pool, event, this.log)
        await markEnvelopeProcessed(this.pool, event.providerEventId, null)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log.error('webhook server: event processing failed', error, { provider_event_id: event.providerEventId })
        await markEnvelopeProcessed(this.pool, event.providerEventId, message.slice(0, 500))
      }
    }

    // Always 200 once the envelope is durable: a 5xx would make Meta
    // redeliver the same payload on an exponential schedule for days.
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

/** Reads the request body, aborting past `maxBytes` rather than buffering an unbounded upload. */
function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0

    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        req.destroy()
        reject(new Error('payload too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
