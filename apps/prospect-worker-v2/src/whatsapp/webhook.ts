import { createHmac, timingSafeEqual } from 'node:crypto'
import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'

/**
 * WhatsApp Cloud API webhook handling (spec §62).
 *
 * Three properties this module guarantees:
 *   1. AUTHENTICITY — X-Hub-Signature-256 is verified against the Meta app
 *      secret with a constant-time comparison. An unverified payload is
 *      stored for forensics but NEVER processed.
 *   2. IDEMPOTENCY — every envelope is keyed by a stable provider event id
 *      and inserted under a UNIQUE index. Meta retries aggressively; a
 *      redelivery is a no-op.
 *   3. ORDER INDEPENDENCE — statuses are applied as monotonic advances
 *      (sent -> delivered -> read). An out-of-order 'sent' arriving after
 *      'read' cannot move a message backwards.
 */

/** Verification challenge on webhook setup (GET). */
export interface VerificationRequest {
  mode: string | null
  token: string | null
  challenge: string | null
}

/**
 * Answers Meta's subscription challenge. Returns the challenge to echo, or
 * null to reject with 403.
 */
export function handleVerification(request: VerificationRequest, expectedVerifyToken: string): string | null {
  if (request.mode !== 'subscribe') return null
  if (!request.token || !request.challenge) return null
  if (!constantTimeEquals(request.token, expectedVerifyToken)) return null
  return request.challenge
}

/**
 * Verifies X-Hub-Signature-256 over the RAW request body.
 *
 * The raw bytes matter: re-serializing parsed JSON changes whitespace and
 * key order, and the signature would never match. The HTTP layer must hand
 * this function the exact body it received.
 */
export function verifySignature(rawBody: Buffer | string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader) return false

  const expectedPrefix = 'sha256='
  if (!signatureHeader.startsWith(expectedPrefix)) return false

  const provided = signatureHeader.slice(expectedPrefix.length)
  const computed = createHmac('sha256', appSecret).update(rawBody).digest('hex')

  return constantTimeEquals(provided, computed)
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf-8')
  const bufferB = Buffer.from(b, 'utf-8')
  // timingSafeEqual throws on length mismatch, which would itself leak
  // length via the exception path — compare lengths first, explicitly.
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

export type ParsedWebhookEvent =
  | {
      kind: 'status'
      providerEventId: string
      providerMessageId: string
      status: 'sent' | 'delivered' | 'read' | 'failed'
      occurredAt: Date
      recipientWaId: string | null
      idempotencyKey: string | null
      errorCode: string | null
      errorMessage: string | null
    }
  | {
      kind: 'inbound'
      providerEventId: string
      providerMessageId: string
      fromWaId: string
      body: string | null
      occurredAt: Date
      phoneNumberId: string | null
    }

/**
 * Parses a Meta webhook envelope into flat events.
 *
 * Deliberately total: any shape it does not understand yields no events
 * rather than an exception, because a malformed or newly-extended payload
 * must not crash the webhook endpoint (Meta would retry it forever).
 */
export function parseWebhookPayload(payload: unknown): ParsedWebhookEvent[] {
  const events: ParsedWebhookEvent[] = []
  if (!payload || typeof payload !== 'object') return events

  const entries = (payload as Record<string, unknown>)['entry']
  if (!Array.isArray(entries)) return events

  for (const entry of entries.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue
    const changes = (entry as Record<string, unknown>)['changes']
    if (!Array.isArray(changes)) continue

    for (const change of changes.slice(0, 100)) {
      if (!change || typeof change !== 'object') continue
      const value = (change as Record<string, unknown>)['value']
      if (!value || typeof value !== 'object') continue

      const metadata = (value as Record<string, unknown>)['metadata']
      const phoneNumberId =
        metadata && typeof metadata === 'object' ? asString((metadata as Record<string, unknown>)['phone_number_id']) : null

      // --- Delivery statuses -------------------------------------------
      const statuses = (value as Record<string, unknown>)['statuses']
      if (Array.isArray(statuses)) {
        for (const raw of statuses.slice(0, 500)) {
          if (!raw || typeof raw !== 'object') continue
          const status = raw as Record<string, unknown>
          const providerMessageId = asString(status['id'])
          const statusValue = asString(status['status'])
          if (!providerMessageId || !statusValue) continue
          if (!['sent', 'delivered', 'read', 'failed'].includes(statusValue)) continue

          const errors = status['errors']
          const firstError = Array.isArray(errors) && errors[0] && typeof errors[0] === 'object' ? (errors[0] as Record<string, unknown>) : null

          events.push({
            kind: 'status',
            // Meta does not send a per-delivery id, so the event identity
            // is (message, status) — which is exactly the granularity that
            // makes redelivery idempotent without suppressing a legitimate
            // later status for the same message.
            providerEventId: `${providerMessageId}:${statusValue}`,
            providerMessageId,
            status: statusValue as 'sent' | 'delivered' | 'read' | 'failed',
            occurredAt: parseTimestamp(status['timestamp']),
            recipientWaId: asString(status['recipient_id']),
            idempotencyKey: asString(status['biz_opaque_callback_data']),
            errorCode: firstError ? asString(firstError['code']) : null,
            errorMessage: firstError ? asString(firstError['title']) ?? asString(firstError['message']) : null,
          })
        }
      }

      // --- Inbound messages --------------------------------------------
      const messages = (value as Record<string, unknown>)['messages']
      if (Array.isArray(messages)) {
        for (const raw of messages.slice(0, 500)) {
          if (!raw || typeof raw !== 'object') continue
          const message = raw as Record<string, unknown>
          const providerMessageId = asString(message['id'])
          const fromWaId = asString(message['from'])
          if (!providerMessageId || !fromWaId) continue

          const textNode = message['text']
          const body =
            textNode && typeof textNode === 'object' ? asString((textNode as Record<string, unknown>)['body']) : null

          events.push({
            kind: 'inbound',
            providerEventId: providerMessageId,
            providerMessageId,
            fromWaId,
            // Bound the stored body; whatsapp_messages.body caps at 8000.
            body: body === null ? null : body.slice(0, 8000),
            occurredAt: parseTimestamp(message['timestamp']),
            phoneNumberId,
          })
        }
      }
    }
  }

  return events
}

/**
 * Deterministic opt-out detection.
 *
 * Keyword matching only — no model, no sentiment analysis. A false
 * negative here means a barber who asked to be left alone gets contacted
 * again, so the list is intentionally broad and matching is generous.
 * Classifying a reply as POSITIVE, by contrast, is a human judgement made
 * in /platform (spec §34) and is never inferred here.
 */
const OPT_OUT_KEYWORDS = [
  'stop',
  'unsubscribe',
  'desabonner',
  'désabonner',
  'desinscription',
  'désinscription',
  'ne plus me contacter',
  'ne me contactez plus',
  'arretez',
  'arrêtez',
  'supprimez mes donnees',
  'supprimez mes données',
  'remove me',
  'do not contact',
  'dont contact me',
  "don't contact me",
  'leave me alone',
  'opt out',
  'opt-out',
]

export function isOptOutMessage(body: string | null): boolean {
  if (!body) return false
  const normalized = body
    .toLowerCase()
    .normalize('NFD')
    // Strip combining accents so 'arrêtez' and 'arretez' both match.
    .replace(/[\u0300-\u036f]/g, '')
    .trim()

  // A bare "STOP" (the WhatsApp/SMS convention) as the whole message.
  if (/^(stop|arret|arretez)[.!\s]*$/.test(normalized)) return true

  return OPT_OUT_KEYWORDS.some((keyword) =>
    normalized.includes(keyword.normalize('NFD').replace(/[\u0300-\u036f]/g, '')),
  )
}

/** Statuses ordered by progression, so an out-of-order webhook cannot regress a message. */
const STATUS_RANK: Record<string, number> = { pending: 0, sent: 1, delivered: 2, read: 3 }

/**
 * Stores an envelope. Returns false when this exact event was already
 * received (Meta redelivery) — the caller should then acknowledge with 200
 * and do nothing else.
 */
export async function recordWebhookEnvelope(
  pool: DbPool,
  input: {
    providerEventId: string
    eventType: string
    payload: unknown
    signatureValid: boolean
    whatsappAccountId: string | null
  },
): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    `insert into public.whatsapp_webhook_events
       (provider_event_id, event_type, payload, signature_valid, whatsapp_account_id)
     values ($1, $2, $3, $4, $5)
     on conflict (provider_event_id) do nothing
     returning id`,
    [input.providerEventId, input.eventType, JSON.stringify(input.payload), input.signatureValid, input.whatsappAccountId],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Applies one parsed event to the message/recipient/outcome tables.
 *
 * Every write is idempotent and monotonic. Called only for envelopes whose
 * signature verified.
 */
export async function processWebhookEvent(pool: DbPool, event: ParsedWebhookEvent, log: Logger): Promise<void> {
  if (event.kind === 'status') {
    await applyStatusEvent(pool, event, log)
    return
  }
  await applyInboundEvent(pool, event, log)
}

async function applyStatusEvent(pool: DbPool, event: Extract<ParsedWebhookEvent, { kind: 'status' }>, log: Logger): Promise<void> {
  // Correlate by Meta's message id, or by our own idempotency key when the
  // status echoed biz_opaque_callback_data back.
  const messageResult = await pool.query<{ id: string; recipient_id: string | null; prospect_id: string | null; status: string }>(
    `select id, recipient_id, prospect_id, status
     from public.whatsapp_messages
     where provider_message_id = $1
        or (idempotency_key is not null and idempotency_key = $2)
     limit 1`,
    [event.providerMessageId, event.idempotencyKey],
  )

  const message = messageResult.rows[0]
  if (!message) {
    log.warn('webhook: status for an unknown message', { provider_message_id: event.providerMessageId, status: event.status })
    return
  }

  if (event.status === 'failed') {
    await pool.query(
      `update public.whatsapp_messages
       set status = 'failed', failed_at = coalesce(failed_at, $2), error_code = $3, error_message = $4
       where id = $1`,
      [message.id, event.occurredAt, event.errorCode, event.errorMessage],
    )

    if (message.recipient_id) {
      await pool.query(
        `update public.outreach_recipients
         set state = 'failed', last_error = $2
         where id = $1 and state in ('queued', 'sent')`,
        [message.recipient_id, event.errorMessage ?? event.errorCode],
      )
      await insertOutreachEvent(pool, message.recipient_id, 'failed', event.providerEventId, {
        error_code: event.errorCode,
        error_message: event.errorMessage,
      })
    }

    // A permanently undeliverable destination is suppressed so the next
    // campaign does not select it again.
    if (message.prospect_id && event.errorCode && ['131026', '133010'].includes(event.errorCode)) {
      await pool.query(
        `update public.prospect_outreach_eligibility
         set destination_invalid = true, is_eligible = false,
             suppression_reason = $2, last_evaluated_at = now()
         where prospect_id = $1 and channel = 'whatsapp'`,
        [message.prospect_id, `provider_permanent_error:${event.errorCode}`],
      )
    }
    return
  }

  // Monotonic advance only.
  const currentRank = STATUS_RANK[message.status] ?? 0
  const incomingRank = STATUS_RANK[event.status] ?? 0
  if (incomingRank <= currentRank) {
    log.debug('webhook: ignoring out-of-order/duplicate status', {
      provider_message_id: event.providerMessageId,
      current: message.status,
      incoming: event.status,
    })
    return
  }

  const timestampColumn = event.status === 'sent' ? 'sent_at' : event.status === 'delivered' ? 'delivered_at' : 'read_at'

  await pool.query(
    `update public.whatsapp_messages
     set status = $2::public.whatsapp_message_status,
         ${timestampColumn} = coalesce(${timestampColumn}, $3)
     where id = $1`,
    [message.id, event.status, event.occurredAt],
  )

  if (!message.recipient_id) return

  const recipientColumn = event.status === 'sent' ? 'sent_at' : event.status === 'delivered' ? 'delivered_at' : 'read_at'

  await pool.query(
    `update public.outreach_recipients
     set state = case
           -- Never regress a recipient that has already replied or
           -- converted just because a delivery receipt arrived late.
           when state in ('replied','positive_reply','negative_reply','opted_out','claimed','activated','paid') then state
           else $2::public.outreach_recipient_state
         end,
         ${recipientColumn} = coalesce(${recipientColumn}, $3)
     where id = $1`,
    [message.recipient_id, event.status, event.occurredAt],
  )

  await insertOutreachEvent(pool, message.recipient_id, event.status, event.providerEventId, {})
}

async function applyInboundEvent(pool: DbPool, event: Extract<ParsedWebhookEvent, { kind: 'inbound' }>, log: Logger): Promise<void> {
  const accountResult = await pool.query<{ id: string }>(
    `select id from public.whatsapp_accounts where phone_number_id = $1 limit 1`,
    [event.phoneNumberId],
  )
  const accountId = accountResult.rows[0]?.id
  if (!accountId) {
    log.warn('webhook: inbound message for an unknown phone_number_id', { phone_number_id: event.phoneNumberId })
    return
  }

  // Find the most recent outbound message to this contact, to attribute
  // the reply to the right campaign/recipient.
  const contactE164 = `+${event.fromWaId.replace(/^\+/, '')}`

  const conversationResult = await pool.query<{ id: string; prospect_id: string | null }>(
    `insert into public.whatsapp_conversations (whatsapp_account_id, contact_wa_id, last_inbound_at, prospect_id)
     values ($1, $2, $3, (
       select prospect_id from public.whatsapp_messages
       where whatsapp_account_id = $1 and to_phone_e164 = $4 and direction = 'outbound'
       order by created_at desc limit 1
     ))
     on conflict (whatsapp_account_id, contact_wa_id)
     do update set last_inbound_at = excluded.last_inbound_at
     returning id, prospect_id`,
    [accountId, event.fromWaId, event.occurredAt, contactE164],
  )

  const conversation = conversationResult.rows[0]

  const outboundResult = await pool.query<{ recipient_id: string | null; prospect_id: string | null }>(
    `select recipient_id, prospect_id
     from public.whatsapp_messages
     where whatsapp_account_id = $1 and to_phone_e164 = $2 and direction = 'outbound'
     order by created_at desc
     limit 1`,
    [accountId, contactE164],
  )
  const outbound = outboundResult.rows[0]

  await pool.query(
    `insert into public.whatsapp_messages
       (whatsapp_account_id, conversation_id, recipient_id, prospect_id, direction, status,
        provider_message_id, from_phone_e164, body, received_at)
     values ($1, $2, $3, $4, 'inbound', 'received', $5, $6, $7, $8)
     on conflict (provider_message_id) do nothing`,
    [
      accountId,
      conversation?.id ?? null,
      outbound?.recipient_id ?? null,
      outbound?.prospect_id ?? conversation?.prospect_id ?? null,
      event.providerMessageId,
      contactE164,
      event.body,
      event.occurredAt,
    ],
  )

  if (!outbound?.recipient_id) return

  const optOut = isOptOutMessage(event.body)

  if (optOut) {
    await pool.query(
      `update public.outreach_recipients
       set state = 'opted_out', replied_at = coalesce(replied_at, $2)
       where id = $1`,
      [outbound.recipient_id, event.occurredAt],
    )
    await insertOutreachEvent(pool, outbound.recipient_id, 'opted_out', event.providerEventId, {
      matched: 'deterministic_keyword',
    })

    if (outbound.prospect_id) {
      await pool.query(
        `update public.prospect_outreach_eligibility
         set is_eligible = false, opt_in_status = 'withdrawn', opted_out_at = $2,
             do_not_contact = true, suppression_reason = 'inbound_opt_out', last_evaluated_at = now()
         where prospect_id = $1 and channel = 'whatsapp'`,
        [outbound.prospect_id, event.occurredAt],
      )
      // Also suppress the phone globally, so re-discovery under a new
      // prospect id cannot resurrect this contact.
      await pool.query(
        `insert into public.prospect_suppressions (scope, value, reason)
         values ('phone', $1, 'WhatsApp inbound opt-out')
         on conflict (scope, value) where value is not null do nothing`,
        [contactE164],
      )
    }
    return
  }

  // A reply that is not an opt-out is recorded as 'replied'. Whether it is
  // POSITIVE is a human call made from /platform — the Worker never
  // guesses sentiment.
  await pool.query(
    `update public.outreach_recipients
     set state = case when state in ('positive_reply','negative_reply','claimed','activated','paid')
                      then state else 'replied'::public.outreach_recipient_state end,
         replied_at = coalesce(replied_at, $2)
     where id = $1`,
    [outbound.recipient_id, event.occurredAt],
  )
  await insertOutreachEvent(pool, outbound.recipient_id, 'replied', event.providerEventId, {})
}

async function insertOutreachEvent(
  pool: DbPool,
  recipientId: string,
  eventType: string,
  providerEventId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await pool.query(
    `insert into public.outreach_events (recipient_id, prospect_id, event_type, provider_event_id, metadata)
     select $1, r.prospect_id, $2::public.outreach_event_type, $3, $4
     from public.outreach_recipients r where r.id = $1
     on conflict (provider_event_id, event_type) where provider_event_id is not null do nothing`,
    [recipientId, eventType, providerEventId, JSON.stringify(metadata)],
  )
}

/** Narrows an unknown JSON field to a non-empty string, or null. */
function asString(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null
  if (typeof value === 'number') return String(value)
  return null
}

/**
 * Meta sends timestamps as unix SECONDS in a string. A missing or
 * unparseable timestamp falls back to now() rather than 1970 — an epoch
 * date would silently corrupt every funnel time-to-event metric.
 */
function parseTimestamp(value: unknown): Date {
  const raw = asString(value)
  if (!raw) return new Date()
  const seconds = Number.parseInt(raw, 10)
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date()
  return new Date(seconds * 1000)
}

/** Marks an envelope processed, so the unprocessed-events index stays a real work queue. */
export async function markEnvelopeProcessed(pool: DbPool, providerEventId: string, error: string | null): Promise<void> {
  await pool.query(
    `update public.whatsapp_webhook_events
     set processed = $2, processed_at = now(), processing_error = $3
     where provider_event_id = $1`,
    [providerEventId, error === null, error],
  )
}
