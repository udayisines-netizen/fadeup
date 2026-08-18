import { createHash } from 'node:crypto'
import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'
import { CloudApiProvider, MockProvider, WhatsAppSendError, type WhatsAppProvider } from './provider.js'

/**
 * The WhatsApp send worker.
 *
 * Order of operations is the whole design:
 *   1. Re-check eligibility IN SQL immediately before sending. The
 *      recipient passed the gate when it was queued, but that may have
 *      been days ago and the barber may have opted out since. A stale
 *      pass is not a pass.
 *   2. Reserve an idempotency key and INSERT the message row FIRST, in
 *      'pending'. The UNIQUE index on idempotency_key is what makes a
 *      crash-and-retry safe: if the row already exists, a send is already
 *      in flight or completed, and we do not send again.
 *   3. Only then call the provider.
 *
 * Doing (3) before (2) is the classic double-send bug: the API call
 * succeeds, the process dies before recording it, the job retries, and a
 * barber receives the same cold message twice.
 */

export interface SendableRecipient {
  recipientId: string
  campaignId: string
  prospectId: string
  destination: string
  renderedBody: string
  renderedVariables: Record<string, string>
  templateId: string
  whatsappAccountId: string
  metaTemplateName: string
  metaTemplateLanguage: string
  variableOrder: string[]
}

export interface SendOutcome {
  recipientId: string
  status: 'sent' | 'skipped' | 'failed'
  reason: string | null
  providerMessageId: string | null
  simulated: boolean
}

/**
 * Builds the provider for an account. Falls back to the mock whenever the
 * account is configured for mock mode OR the required token is absent from
 * the environment — never to an unofficial transport.
 */
export function buildProvider(
  account: { providerMode: 'mock' | 'live'; phoneNumberId: string; accessTokenEnvVar: string },
  config: Config,
  log: Logger,
): WhatsAppProvider {
  if (account.providerMode === 'mock') {
    return new MockProvider()
  }

  const token = process.env[account.accessTokenEnvVar]
  if (!token || token.trim().length === 0) {
    log.warn('whatsapp: account is configured live but its access token env var is absent — using the mock provider', {
      // The NAME of the variable, never its value.
      env_var: account.accessTokenEnvVar,
      phone_number_id: account.phoneNumberId,
    })
    return new MockProvider()
  }

  return new CloudApiProvider({
    phoneNumberId: account.phoneNumberId,
    accessToken: token,
    graphApiVersion: config.META_GRAPH_API_VERSION,
    timeoutMs: config.WHATSAPP_REQUEST_TIMEOUT_MS,
  })
}

/**
 * A stable idempotency key for one (recipient, template) send attempt.
 *
 * Deliberately NOT time-based: the point is that a retry of the SAME
 * logical send produces the SAME key and therefore collides. Including the
 * template id means that if an operator legitimately re-targets a
 * recipient with a different approved template later, that is a distinct
 * send rather than a silently-suppressed one.
 */
export function buildIdempotencyKey(recipientId: string, templateId: string): string {
  return createHash('sha256').update(`fadeup:whatsapp:${recipientId}:${templateId}`).digest('hex').slice(0, 40)
}

/**
 * Loads recipients that are genuinely ready to send: queued, on a running
 * campaign, with an approved template that has a Meta mapping, and — the
 * critical part — currently passing the eligibility gate.
 */
export async function loadSendableRecipients(pool: DbPool, campaignId: string, limit: number): Promise<SendableRecipient[]> {
  const result = await pool.query<{
    recipient_id: string
    campaign_id: string
    prospect_id: string
    destination: string
    rendered_body: string
    rendered_variables: Record<string, string>
    template_id: string
    whatsapp_account_id: string
    meta_template_name: string
    meta_template_language: string
    variable_order: string[]
  }>(
    `select r.id as recipient_id, r.campaign_id, r.prospect_id, r.destination,
            r.rendered_body, r.rendered_variables, r.template_id,
            m.whatsapp_account_id, m.meta_template_name, m.meta_template_language, m.variable_order
     from public.outreach_recipients r
     join public.outreach_campaigns c on c.id = r.campaign_id
     join public.outreach_templates t on t.id = r.template_id
     join public.whatsapp_template_mappings m
       on m.template_id = t.id and m.whatsapp_account_id = c.whatsapp_account_id
     where r.campaign_id = $1
       and r.state = 'queued'
       and c.status = 'running'
       -- The template must STILL be approved. Pausing a template from
       -- /platform stops the queue immediately (spec §72).
       and t.status = 'approved'
       and m.approval_state in ('approved', 'unknown')
       -- Re-assert the eligibility gate at send time, not just at queue
       -- time. This is the check that catches an opt-out that arrived
       -- after the campaign was prepared.
       and public.outreach_block_reason(r.prospect_id, 'whatsapp') is null
     order by r.queued_at
     limit $2`,
    [campaignId, limit],
  )

  return result.rows.map((row) => ({
    recipientId: row.recipient_id,
    campaignId: row.campaign_id,
    prospectId: row.prospect_id,
    destination: row.destination,
    renderedBody: row.rendered_body,
    renderedVariables: row.rendered_variables ?? {},
    templateId: row.template_id,
    whatsappAccountId: row.whatsapp_account_id,
    metaTemplateName: row.meta_template_name,
    metaTemplateLanguage: row.meta_template_language,
    variableOrder: row.variable_order ?? [],
  }))
}

/**
 * Sends one recipient's message.
 *
 * Never throws — every outcome is a SendOutcome, because one bad recipient
 * must not abort a campaign batch.
 */
export async function sendOne(
  pool: DbPool,
  provider: WhatsAppProvider,
  recipient: SendableRecipient,
  log: Logger,
): Promise<SendOutcome> {
  // Belt and braces: the SQL above already filtered on this, but the row
  // may have changed between that query and this send.
  const blockResult = await pool.query<{ outreach_block_reason: string | null }>(
    `select public.outreach_block_reason($1, 'whatsapp')`,
    [recipient.prospectId],
  )
  const blockReason = blockResult.rows[0]?.outreach_block_reason ?? null

  if (blockReason) {
    await pool.query(
      `update public.outreach_recipients set state = 'blocked', blocked_reason = $2 where id = $1`,
      [recipient.recipientId, blockReason],
    )
    log.info('whatsapp: recipient became ineligible before send — blocked', {
      recipient_id: recipient.recipientId,
      reason: blockReason,
    })
    return { recipientId: recipient.recipientId, status: 'skipped', reason: blockReason, providerMessageId: null, simulated: false }
  }

  const idempotencyKey = buildIdempotencyKey(recipient.recipientId, recipient.templateId)

  // Step 2: claim the send BEFORE calling the provider. A conflict means
  // this send already happened (or is happening) — do not send again.
  const claim = await pool.query<{ id: string }>(
    `insert into public.whatsapp_messages
       (whatsapp_account_id, recipient_id, prospect_id, direction, status, idempotency_key,
        to_phone_e164, template_id, meta_template_name, meta_template_language, body, attempts)
     values ($1, $2, $3, 'outbound', 'pending', $4, $5, $6, $7, $8, $9, 1)
     on conflict (idempotency_key) do nothing
     returning id`,
    [
      recipient.whatsappAccountId,
      recipient.recipientId,
      recipient.prospectId,
      idempotencyKey,
      recipient.destination,
      recipient.templateId,
      recipient.metaTemplateName,
      recipient.metaTemplateLanguage,
      recipient.renderedBody,
    ],
  )

  const messageId = claim.rows[0]?.id
  if (!messageId) {
    log.info('whatsapp: idempotency key already claimed — not sending again', {
      recipient_id: recipient.recipientId,
    })
    return {
      recipientId: recipient.recipientId,
      status: 'skipped',
      reason: 'duplicate_idempotency_key',
      providerMessageId: null,
      simulated: false,
    }
  }

  // Meta template parameters are POSITIONAL. variable_order maps our named
  // variables onto {{1}}..{{n}}; a mismatch is a configuration error that
  // Meta rejects with 132000, so fail fast and clearly instead.
  const bodyParameters = recipient.variableOrder.map((name) => recipient.renderedVariables[name] ?? '')
  const missing = recipient.variableOrder.filter((name) => !recipient.renderedVariables[name])

  if (missing.length > 0) {
    const reason = `template mapping expects variables [${recipient.variableOrder.join(', ')}] but [${missing.join(', ')}] were not rendered`
    await failMessage(pool, messageId, recipient.recipientId, 'variable_mapping_mismatch', reason)
    return { recipientId: recipient.recipientId, status: 'failed', reason, providerMessageId: null, simulated: false }
  }

  try {
    const sendResult = await provider.sendTemplateMessage({
      toPhoneE164: recipient.destination,
      metaTemplateName: recipient.metaTemplateName,
      metaTemplateLanguage: recipient.metaTemplateLanguage,
      bodyParameters,
      idempotencyKey,
    })

    await pool.query(
      `update public.whatsapp_messages
       set status = 'sent', provider_message_id = $2, sent_at = now()
       where id = $1`,
      [messageId, sendResult.providerMessageId],
    )

    await pool.query(
      `update public.outreach_recipients
       set state = 'sent', sent_at = now(), attempts = attempts + 1
       where id = $1`,
      [recipient.recipientId],
    )

    await pool.query(
      `insert into public.outreach_events (recipient_id, prospect_id, event_type, provider_event_id, metadata)
       values ($1, $2, 'sent', $3, $4)
       on conflict (provider_event_id, event_type) where provider_event_id is not null do nothing`,
      [
        recipient.recipientId,
        recipient.prospectId,
        `${sendResult.providerMessageId}:sent`,
        JSON.stringify({ simulated: sendResult.simulated, provider_mode: provider.mode }),
      ],
    )

    return {
      recipientId: recipient.recipientId,
      status: 'sent',
      reason: null,
      providerMessageId: sendResult.providerMessageId,
      simulated: sendResult.simulated,
    }
  } catch (error) {
    const sendError = error instanceof WhatsAppSendError ? error : null
    const code = sendError?.errorCode ?? 'unknown_error'
    const message = error instanceof Error ? error.message : String(error)

    await failMessage(pool, messageId, recipient.recipientId, code, message)

    // A permanent destination failure suppresses the contact so the next
    // campaign does not select it again.
    if (sendError?.permanent) {
      await pool.query(
        `update public.prospect_outreach_eligibility
         set destination_invalid = true, is_eligible = false,
             suppression_reason = $2, last_evaluated_at = now()
         where prospect_id = $1 and channel = 'whatsapp'`,
        [recipient.prospectId, `provider_permanent_error:${code}`],
      )
    }

    log.warn('whatsapp: send failed', {
      recipient_id: recipient.recipientId,
      error_code: code,
      permanent: sendError?.permanent ?? false,
    })

    return { recipientId: recipient.recipientId, status: 'failed', reason: message, providerMessageId: null, simulated: false }
  }
}

async function failMessage(
  pool: DbPool,
  messageId: string,
  recipientId: string,
  errorCode: string,
  errorMessage: string,
): Promise<void> {
  await pool.query(
    `update public.whatsapp_messages
     set status = 'failed', failed_at = now(), error_code = $2, error_message = $3
     where id = $1`,
    [messageId, errorCode, errorMessage.slice(0, 2000)],
  )
  await pool.query(
    `update public.outreach_recipients
     set state = 'failed', last_error = $2, attempts = attempts + 1
     where id = $1`,
    [recipientId, errorMessage.slice(0, 2000)],
  )
}
