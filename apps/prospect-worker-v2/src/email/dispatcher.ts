import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import type { DbPool } from '../db.js'
import type { Config } from '../config.js'
import { logger } from '../logger.js'
import { renderEmail } from './templates.js'

/**
 * Delivers rows from public.email_outbox.
 *
 * It lives inside this worker rather than in a new service because the
 * worker already runs continuously in Docker, already holds a direct
 * PostgreSQL connection as the least-privileged `prospect_worker` role, and
 * already owns a `FOR UPDATE SKIP LOCKED` queue — all three of which this
 * needs and none of which an Edge Function has.
 *
 * The contract with the approval transaction: enqueueing happens in the same
 * transaction as the decision, delivery happens here afterwards. An approval
 * is never rolled back because SMTP was down, and a failed send is parked as
 * `failed` with its error rather than disappearing, so the platform outbox
 * view shows it and it can be retried.
 */

interface OutboxRow {
  id: string
  to_email: string
  template: string
  locale: string
  payload: Record<string, unknown>
  attempts: number
}

export class EmailDispatcher {
  private transporter: Transporter | undefined
  private timer: NodeJS.Timeout | undefined
  private running = false
  private draining = false

  constructor(
    private readonly pool: DbPool,
    private readonly config: Config,
  ) {}

  /** No SMTP host configured means no dispatcher: rows simply stay queued and visible, which is the honest failure mode. */
  get enabled(): boolean {
    return Boolean(this.config.SMTP_HOST)
  }

  start(): void {
    if (this.running) return
    if (!this.enabled) {
      logger.info('email dispatcher disabled (no SMTP_HOST configured); outbox rows will remain queued')
      return
    }
    this.running = true
    this.timer = setInterval(() => void this.drain(), this.config.EMAIL_POLL_INTERVAL_MS)
    logger.info('email dispatcher started', { intervalMs: this.config.EMAIL_POLL_INTERVAL_MS })
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (this.transporter) {
      this.transporter.close()
      this.transporter = undefined
    }
  }

  private getTransporter(): Transporter {
    if (this.transporter) return this.transporter
    this.transporter = nodemailer.createTransport({
      host: this.config.SMTP_HOST,
      port: this.config.SMTP_PORT,
      // 465 is implicit TLS; everything else negotiates STARTTLS.
      secure: this.config.SMTP_PORT === 465,
      auth:
        this.config.SMTP_USER && this.config.SMTP_PASS
          ? { user: this.config.SMTP_USER, pass: this.config.SMTP_PASS }
          : undefined,
    })
    return this.transporter
  }

  /** Claims a batch and attempts each one. Overlapping ticks are skipped rather than queued up. */
  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      const { rows } = await this.pool.query<OutboxRow>(
        'select id, to_email, template, locale, payload, attempts from private.claim_next_email($1)',
        [this.config.EMAIL_BATCH_SIZE],
      )

      for (const row of rows) {
        await this.deliver(row)
      }
    } catch (error) {
      logger.error('email dispatcher drain failed', error)
    } finally {
      this.draining = false
    }
  }

  private async deliver(row: OutboxRow): Promise<void> {
    const log = logger.child({ outboxId: row.id, template: row.template })
    try {
      const rendered = renderEmail(row.template, row.locale, row.payload ?? {}, this.config.APP_BASE_URL)

      await this.getTransporter().sendMail({
        from: `"${this.config.EMAIL_FROM_NAME}" <${this.config.EMAIL_FROM_ADDRESS}>`,
        to: row.to_email,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })

      await this.pool.query('select private.mark_email_sent($1)', [row.id])
      // Recipient address is deliberately not logged — the outbox row already
      // holds it, and worker logs are a wider audience than the database.
      log.info('email sent')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await this.pool
        .query('select private.mark_email_failed($1, $2, $3)', [row.id, message, this.config.EMAIL_MAX_ATTEMPTS])
        .catch((markError) => log.error('could not record email failure', markError))
      log.warn('email delivery failed', { attempts: row.attempts, error: message })
    }
  }
}
