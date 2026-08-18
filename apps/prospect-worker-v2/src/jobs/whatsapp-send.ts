import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'
import type { ProspectJob } from '../queue/types.js'
import { buildProvider, loadSendableRecipients, sendOne } from '../whatsapp/sender.js'

/**
 * Drains a campaign's queued recipients through the WhatsApp provider.
 *
 * Rate limiting is per-campaign and enforced here rather than trusted to
 * the provider: exceeding Meta's messaging limits gets a WABA
 * rate-limited or, worse, flagged for quality.
 */

export interface WhatsAppSendResult {
  campaignId: string
  attempted: number
  sent: number
  skipped: number
  failed: number
  simulated: number
  providerMode: 'mock' | 'live'
  campaignCompleted: boolean
}

export async function runWhatsAppSendJob(
  pool: DbPool,
  job: ProspectJob,
  config: Config,
  log: Logger,
): Promise<WhatsAppSendResult> {
  const payload = job.payload as Record<string, unknown>
  const campaignId = String(payload['campaignId'] ?? '')
  if (!campaignId) throw new Error('whatsapp_send: payload.campaignId is required')

  const campaignResult = await pool.query<{
    id: string
    status: string
    max_sends_per_hour: number
    whatsapp_account_id: string | null
  }>(
    `select id, status::text, max_sends_per_hour, whatsapp_account_id
     from public.outreach_campaigns where id = $1`,
    [campaignId],
  )
  const campaign = campaignResult.rows[0]
  if (!campaign) throw new Error(`whatsapp_send: campaign ${campaignId} not found`)

  // Pausing a campaign from /platform must stop sends immediately, not at
  // the end of the current batch's natural life.
  if (campaign.status !== 'running') {
    log.info('whatsapp_send: campaign is not running — nothing sent', {
      campaign_id: campaignId,
      status: campaign.status,
    })
    return {
      campaignId,
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      simulated: 0,
      providerMode: 'mock',
      campaignCompleted: false,
    }
  }

  if (!campaign.whatsapp_account_id) {
    throw new Error(`whatsapp_send: campaign ${campaignId} has no WhatsApp account configured`)
  }

  const accountResult = await pool.query<{
    id: string
    provider_mode: 'mock' | 'live'
    phone_number_id: string
    access_token_env_var: string
    is_active: boolean
  }>(
    `select id, provider_mode, phone_number_id, access_token_env_var, is_active
     from public.whatsapp_accounts where id = $1`,
    [campaign.whatsapp_account_id],
  )
  const account = accountResult.rows[0]
  if (!account) throw new Error(`whatsapp_send: WhatsApp account ${campaign.whatsapp_account_id} not found`)
  if (!account.is_active) throw new Error(`whatsapp_send: WhatsApp account ${account.id} is inactive`)

  const provider = buildProvider(
    {
      providerMode: account.provider_mode,
      phoneNumberId: account.phone_number_id,
      accessTokenEnvVar: account.access_token_env_var,
    },
    config,
    log,
  )

  // Per-hour throughput guard, computed from what this campaign actually
  // sent in the last hour rather than from a process-local counter (there
  // may be several worker processes).
  const sentLastHourResult = await pool.query<{ count: string }>(
    `select count(*) from public.outreach_recipients
     where campaign_id = $1 and sent_at > now() - interval '1 hour'`,
    [campaignId],
  )
  const sentLastHour = Number(sentLastHourResult.rows[0]?.count ?? 0)
  const remainingThisHour = Math.max(0, campaign.max_sends_per_hour - sentLastHour)

  if (remainingThisHour === 0) {
    log.info('whatsapp_send: campaign hourly send limit reached — deferring', {
      campaign_id: campaignId,
      sent_last_hour: sentLastHour,
      limit: campaign.max_sends_per_hour,
    })
    return {
      campaignId,
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      simulated: 0,
      providerMode: provider.mode,
      campaignCompleted: false,
    }
  }

  const batchSize = Math.min(config.WHATSAPP_SEND_BATCH_SIZE, remainingThisHour)
  const recipients = await loadSendableRecipients(pool, campaignId, batchSize)

  const result: WhatsAppSendResult = {
    campaignId,
    attempted: recipients.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    simulated: 0,
    providerMode: provider.mode,
    campaignCompleted: false,
  }

  for (const recipient of recipients) {
    const outcome = await sendOne(pool, provider, recipient, log)
    if (outcome.status === 'sent') {
      result.sent++
      if (outcome.simulated) result.simulated++
    } else if (outcome.status === 'skipped') {
      result.skipped++
    } else {
      result.failed++
    }
  }

  // The campaign is complete when nothing is left in a pre-send state.
  const remainingResult = await pool.query<{ count: string }>(
    `select count(*) from public.outreach_recipients
     where campaign_id = $1 and state in ('pending', 'queued')`,
    [campaignId],
  )
  const remaining = Number(remainingResult.rows[0]?.count ?? 0)

  if (remaining === 0) {
    await pool.query(
      `update public.outreach_campaigns set status = 'completed', completed_at = now()
       where id = $1 and status = 'running'`,
      [campaignId],
    )
    result.campaignCompleted = true
  }

  log.info('whatsapp_send: batch complete', {
    campaign_id: campaignId,
    provider_mode: provider.mode,
    sent: result.sent,
    simulated: result.simulated,
    skipped: result.skipped,
    failed: result.failed,
    remaining,
  })

  return result
}
