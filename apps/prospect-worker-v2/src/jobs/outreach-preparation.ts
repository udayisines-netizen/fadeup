import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import type { Config } from '../config.js'
import type { ProspectJob } from '../queue/types.js'
import { selectTemplate, NoEligibleTemplateError, type SelectionContext } from '../outreach/selector.js'
import { renderTemplate, TemplateRenderError, type TemplateVariables } from '../outreach/template-engine.js'
import { assignToExperiment } from '../outreach/experiments.js'
import { ModelCache, rankCandidatesWithModel, type InferenceFeatures } from '../ml/inference.js'
import { parseTribool } from '../features/tribool.js'

/**
 * Campaign preparation: turn a campaign's selected prospects into queued,
 * rendered, gated recipients.
 *
 * Every prospect ends in exactly one of two states:
 *   queued  — passed the eligibility gate, has an approved template in its
 *             own language, and has a fully-rendered body.
 *   blocked — with an explicit, human-readable reason.
 *
 * Nothing is silently dropped. A Platform Owner who selected 500 prospects
 * and gets 320 queued can see precisely why the other 180 were not, which
 * is the difference between a trustworthy tool and a black box.
 */

export interface OutreachPreparationResult {
  campaignId: string
  considered: number
  queued: number
  blocked: number
  blockedReasons: Record<string, number>
  selectionMethods: Record<string, number>
}

export async function runOutreachPreparationJob(
  pool: DbPool,
  job: ProspectJob,
  config: Config,
  modelCache: ModelCache,
  log: Logger,
): Promise<OutreachPreparationResult> {
  const payload = job.payload as Record<string, unknown>
  const campaignId = String(payload['campaignId'] ?? '')
  if (!campaignId) throw new Error('outreach_preparation: payload.campaignId is required')

  const campaignResult = await pool.query<{ id: string; status: string; channel: string }>(
    `select id, status, channel::text from public.outreach_campaigns where id = $1`,
    [campaignId],
  )
  const campaign = campaignResult.rows[0]
  if (!campaign) throw new Error(`outreach_preparation: campaign ${campaignId} not found`)

  if (!['draft', 'preparing', 'ready', 'paused'].includes(campaign.status)) {
    throw new Error(`outreach_preparation: campaign ${campaignId} is ${campaign.status} and cannot be prepared`)
  }

  await pool.query(`update public.outreach_campaigns set status = 'preparing' where id = $1`, [campaignId])

  const result: OutreachPreparationResult = {
    campaignId,
    considered: 0,
    queued: 0,
    blocked: 0,
    blockedReasons: {},
    selectionMethods: {},
  }

  const recipients = await pool.query<{ id: string; prospect_id: string }>(
    `select id, prospect_id from public.outreach_recipients
     where campaign_id = $1 and state = 'pending'
     order by created_at`,
    [campaignId],
  )

  for (const row of recipients.rows) {
    result.considered++
    try {
      const outcome = await prepareRecipient(pool, config, modelCache, campaignId, row.id, row.prospect_id, log)
      if (outcome.queued) {
        result.queued++
        result.selectionMethods[outcome.method] = (result.selectionMethods[outcome.method] ?? 0) + 1
      } else {
        result.blocked++
        result.blockedReasons[outcome.reason] = (result.blockedReasons[outcome.reason] ?? 0) + 1
      }
    } catch (error) {
      // One prospect's failure must never abort a 500-recipient campaign.
      const message = error instanceof Error ? error.message : String(error)
      log.warn('outreach_preparation: recipient failed, blocking it and continuing', {
        recipient_id: row.id,
        error: message,
      })
      await blockRecipient(pool, row.id, 'preparation_error')
      result.blocked++
      result.blockedReasons['preparation_error'] = (result.blockedReasons['preparation_error'] ?? 0) + 1
    }
  }

  await pool.query(
    `update public.outreach_campaigns
     set status = case when $2 > 0 then 'ready'::public.outreach_campaign_status
                       else 'draft'::public.outreach_campaign_status end
     where id = $1`,
    [campaignId, result.queued],
  )

  log.info('outreach_preparation: completed', {
    campaign_id: campaignId,
    considered: result.considered,
    queued: result.queued,
    blocked: result.blocked,
  })

  return result
}

interface PrepareOutcome {
  queued: boolean
  reason: string
  method: string
}

async function prepareRecipient(
  pool: DbPool,
  config: Config,
  modelCache: ModelCache,
  campaignId: string,
  recipientId: string,
  prospectId: string,
  log: Logger,
): Promise<PrepareOutcome> {
  // --- 1. Eligibility, server-side, before anything else ---------------
  const blockResult = await pool.query<{ outreach_block_reason: string | null }>(
    `select public.outreach_block_reason($1, 'whatsapp')`,
    [prospectId],
  )
  const blockReason = blockResult.rows[0]?.outreach_block_reason ?? null
  if (blockReason) {
    await blockRecipient(pool, recipientId, blockReason)
    return { queued: false, reason: blockReason, method: 'none' }
  }

  // --- 2. Prospect context ---------------------------------------------
  const ctxResult = await pool.query<{
    canonical_name: string
    country: string
    type: string
    city: string | null
    locale: string
    booking_provider_key: string | null
    booking_provider_display: string | null
    fadeup_fit_score: number | null
    migration_potential_score: number | null
    rating: string | null
    review_count: number | null
    estimated_barber_count: number | null
    destination: string
    segments: string[]
  }>(
    `select p.canonical_name, p.country, p.type::text, pl.city,
            public.prospect_effective_locale(p.id) as locale,
            bp.key as booking_provider_key, bp.display_name as booking_provider_display,
            p.fadeup_fit_score, p.migration_potential_score,
            p.rating, p.review_count, p.estimated_barber_count,
            e.destination,
            coalesce(array_agg(ps.segment_key) filter (where ps.segment_key is not null), '{}') as segments
     from public.prospects p
     left join public.prospect_locations pl on pl.prospect_id = p.id and pl.is_primary
     left join public.booking_providers bp on bp.id = p.current_booking_provider_id
     left join public.prospect_outreach_eligibility e on e.prospect_id = p.id and e.channel = 'whatsapp'
     left join public.prospect_segments ps on ps.prospect_id = p.id
     where p.id = $1
     group by p.id, pl.city, bp.key, bp.display_name, e.destination`,
    [prospectId],
  )

  const prospect = ctxResult.rows[0]
  if (!prospect) {
    await blockRecipient(pool, recipientId, 'prospect_not_found')
    return { queued: false, reason: 'prospect_not_found', method: 'none' }
  }

  const ctx: SelectionContext = {
    prospectId,
    locale: prospect.locale,
    bookingProviderKey: prospect.booking_provider_key ?? 'UNKNOWN',
    segmentKeys: prospect.segments ?? [],
    fadeUpFitScore: prospect.fadeup_fit_score,
    migrationPotentialScore: prospect.migration_potential_score,
    campaignId,
  }

  // --- 3. Template selection: rules -> experiment -> ML ----------------
  let selection
  try {
    selection = await selectTemplate(pool, ctx, log, {
      assignExperiment: async (candidates) => {
        const assignment = await assignToExperiment(pool, ctx, candidates, log)
        return assignment
          ? { templateId: assignment.templateId, experimentId: assignment.experimentId, armKey: assignment.armKey }
          : null
      },
      rankWithModel: async (candidates) => {
        const baseFeatures = await loadInferenceFeatures(pool, prospectId, ctx)
        if (!baseFeatures) return null
        return rankCandidatesWithModel(pool, modelCache, ctx, candidates, baseFeatures, 'positive_reply', log)
      },
    })
  } catch (error) {
    if (error instanceof NoEligibleTemplateError) {
      // The correct behaviour when no approved template exists in the
      // prospect's language: BLOCK. Never fall back to another language.
      await blockRecipient(pool, recipientId, error.reason)
      return { queued: false, reason: error.reason, method: 'none' }
    }
    throw error
  }

  // --- 4. Render (pure substitution, no generation) ---------------------
  const variables: TemplateVariables = {
    business_name: prospect.canonical_name,
    ...(prospect.city ? { city: prospect.city } : {}),
    ...(prospect.booking_provider_display && !['No online booking', 'Unknown'].includes(prospect.booking_provider_display)
      ? { competitor: prospect.booking_provider_display }
      : {}),
    shop_type: prospect.type === 'barbershop' ? 'barbershop' : 'barber',
    ...(prospect.estimated_barber_count !== null ? { barber_count: String(prospect.estimated_barber_count) } : {}),
  }

  let rendered
  try {
    rendered = renderTemplate({
      body: selection.template.body,
      allowedVariables: selection.template.allowedVariables,
      variables,
    })
  } catch (error) {
    if (error instanceof TemplateRenderError) {
      // A template needing {{city}} for a prospect with no city cannot be
      // sent. Blocking is right — shipping "Bonjour, à {{city}}" is not.
      await blockRecipient(pool, recipientId, `render_failed:${error.reason}`)
      return { queued: false, reason: `render_failed:${error.reason}`, method: 'none' }
    }
    throw error
  }

  // --- 5. Queue. The DB trigger re-asserts every gate here. ------------
  await pool.query(
    `update public.outreach_recipients
     set state = 'queued',
         template_id = $2,
         selection_method = $3,
         selection_reason = $4,
         sales_angle = $5,
         rendered_body = $6,
         rendered_variables = $7,
         destination = $8,
         experiment_id = $9,
         experiment_arm = $10,
         ml_prediction_id = $11,
         blocked_reason = null,
         queued_at = now()
     where id = $1`,
    [
      recipientId,
      selection.template.id,
      selection.method,
      JSON.stringify(selection.reason),
      selection.salesAngle,
      rendered.body,
      JSON.stringify(rendered.usedVariables),
      prospect.destination,
      selection.method === 'experiment' ? (selection.reason['experiment_id'] as string) : null,
      selection.method === 'experiment' ? (selection.reason['arm'] as string) : null,
      selection.mlPredictionId,
    ],
  )

  // Link the assignment to the recipient so experiment_results can join
  // outcomes back to arms.
  if (selection.method === 'experiment') {
    await pool.query(
      `update public.outreach_assignments set recipient_id = $2
       where experiment_id = $3 and prospect_id = $1`,
      [prospectId, recipientId, selection.reason['experiment_id']],
    )
  }

  await pool.query(
    `insert into public.outreach_events (recipient_id, prospect_id, event_type, metadata)
     values ($1, $2, 'queued', $3)`,
    [recipientId, prospectId, JSON.stringify({ template: selection.template.key, method: selection.method })],
  )

  return { queued: true, reason: 'ok', method: selection.method }
}

async function blockRecipient(pool: DbPool, recipientId: string, reason: string): Promise<void> {
  await pool.query(
    `update public.outreach_recipients set state = 'blocked', blocked_reason = $2 where id = $1`,
    [recipientId, reason.slice(0, 200)],
  )
}

/**
 * Assembles the model's input features from the persisted feature store.
 *
 * Only pre-decision signals: nothing here is observable after the message
 * is sent (spec §68). send_weekday/send_hour describe WHEN we are about to
 * send, which is known at decision time.
 */
async function loadInferenceFeatures(
  pool: DbPool,
  prospectId: string,
  ctx: SelectionContext,
): Promise<Omit<InferenceFeatures, 'templateKey' | 'salesAngle'> | null> {
  const result = await pool.query<{
    country: string
    type: string
    rating: string | null
    review_count: number | null
    estimated_barber_count: number | null
    fadeup_fit_score: number | null
    migration_potential_score: number | null
    features: Record<string, { bool: string | null; num: string | null }>
  }>(
    `select p.country, p.type::text, p.rating, p.review_count, p.estimated_barber_count,
            p.fadeup_fit_score, p.migration_potential_score,
            coalesce(
              (select jsonb_object_agg(f.feature_key, jsonb_build_object('bool', f.value_bool, 'num', f.value_numeric))
               from public.prospect_features f where f.prospect_id = p.id),
              '{}'::jsonb
            ) as features
     from public.prospects p where p.id = $1`,
    [prospectId],
  )

  const row = result.rows[0]
  if (!row) return null

  const features = row.features ?? {}
  const boolFeature = (key: string) => parseTribool(features[key]?.bool)
  const numFeature = (key: string): number | null => {
    const raw = features[key]?.num
    return raw === null || raw === undefined ? null : Number(raw)
  }

  const now = new Date()

  return {
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: row.review_count,
    estimatedBarberCount: row.estimated_barber_count,
    fadeUpFitScore: row.fadeup_fit_score,
    migrationPotentialScore: row.migration_potential_score,
    digitalGapScore: numFeature('digital_gap_score'),
    websiteQualityScore: numFeature('website_quality_score'),
    hasWebsite: boolFeature('has_website'),
    mobileReady: boolFeature('mobile_ready'),
    bookingDetected: boolFeature('booking_detected'),
    instagramPresence: boolFeature('instagram_presence'),
    multiBarber: boolFeature('multi_barber'),
    country: row.country,
    shopType: row.type,
    bookingProvider: ctx.bookingProviderKey,
    locale: ctx.locale,
    sendWeekday: now.getUTCDay(),
    sendHour: now.getUTCHours(),
  }
}
