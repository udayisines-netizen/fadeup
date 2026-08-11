import type { DbPool } from '../db.js'

export interface NormalizedCandidate {
  sourceKey: string
  externalId: string
  siret?: string | null
  phoneE164?: string | null
  websiteDomain?: string | null
  instagramHandle?: string | null
  canonicalName: string
  country: string
  latitude?: number | null
  longitude?: number | null
}

export interface DuplicateCandidate {
  duplicateOfProspectId: string
  confidence: number
  reason: string
}

/**
 * High-confidence identifier match, checked BEFORE anything fuzzy — per
 * spec's priority order: (1) exact source external ID, (2) SIRET/SIREN,
 * (3) normalized phone, (4) normalized domain, (5) exact social handle.
 * The first hit wins and is treated as definitively the same business —
 * safe to auto-link (attach a new source_record to the existing prospect)
 * without a human review step. Returns null if none of these match
 * anything, which does NOT mean "definitely new" — the caller still runs
 * findFuzzyCandidates() before deciding to insert a new prospect.
 */
export async function findHighConfidenceMatch(pool: DbPool, candidate: NormalizedCandidate): Promise<{ prospectId: string; reason: string } | null> {
  // 1. Exact source external ID — we've seen this exact record before.
  const bySource = await pool.query<{ prospect_id: string | null }>(
    `select prospect_id from public.prospect_source_records
     where source_id = (select id from public.prospect_sources where key = $1)
       and external_id = $2 and prospect_id is not null
     limit 1`,
    [candidate.sourceKey, candidate.externalId],
  )
  if (bySource.rows[0]?.prospect_id) {
    return { prospectId: bySource.rows[0].prospect_id, reason: 'exact_source_external_id' }
  }

  // 2. SIRET — stored as a prospect_source_records external_id under the
  // sirene source, regardless of which source originally discovered the
  // business.
  if (candidate.siret) {
    const bySiret = await pool.query<{ prospect_id: string | null }>(
      `select prospect_id from public.prospect_source_records
       where source_id = (select id from public.prospect_sources where key = 'sirene')
         and external_id = $1 and prospect_id is not null
       limit 1`,
      [candidate.siret],
    )
    if (bySiret.rows[0]?.prospect_id) {
      return { prospectId: bySiret.rows[0].prospect_id, reason: 'siret_match' }
    }
  }

  // 3. Normalized phone.
  if (candidate.phoneE164) {
    const byPhone = await pool.query<{ id: string }>('select id from public.prospects where phone_e164 = $1 limit 1', [candidate.phoneE164])
    if (byPhone.rows[0]) {
      return { prospectId: byPhone.rows[0].id, reason: 'normalized_phone_match' }
    }
  }

  // 4. Normalized website domain.
  if (candidate.websiteDomain) {
    const byDomain = await pool.query<{ id: string }>('select id from public.prospects where website_domain = $1 limit 1', [
      candidate.websiteDomain,
    ])
    if (byDomain.rows[0]) {
      return { prospectId: byDomain.rows[0].id, reason: 'normalized_domain_match' }
    }
  }

  // 5. Exact social handle.
  if (candidate.instagramHandle) {
    const byHandle = await pool.query<{ prospect_id: string }>(
      `select prospect_id from public.prospect_social_profiles where platform = 'instagram' and handle = $1 limit 1`,
      [candidate.instagramHandle],
    )
    if (byHandle.rows[0]) {
      return { prospectId: byHandle.rows[0].prospect_id, reason: 'exact_social_handle_match' }
    }
  }

  return null
}

const NAME_SIMILARITY_THRESHOLD = 0.45
const PROXIMITY_METERS = 150

/**
 * Fuzzy candidate matching: normalized name similarity (pg_trgm) combined
 * with geographic proximity. NEVER auto-merged — every hit becomes a
 * public.prospect_duplicates row for a human to review (spec: "do not
 * automatically merge uncertain candidates"). Only runs when the new
 * prospect has coordinates — name similarity alone, with no geographic
 * corroboration, is too weak a signal city-wide.
 */
export async function findFuzzyCandidates(pool: DbPool, prospectId: string, canonicalName: string, latitude: number | null, longitude: number | null): Promise<DuplicateCandidate[]> {
  if (latitude === null || longitude === null) return []

  // Deliberately NOT using earth_box()'s cube containment operator here —
  // it requires an explicit cast between the `cube` and `earth` types that
  // isn't worth the added complexity at FadeUp's current prospect-table
  // scale. extensions.earth_distance() alone (checked in the WHERE
  // clause, not just filtered client-side afterward) is a plain scalar
  // comparison and needs no such cast.
  const result = await pool.query<{ id: string; similarity: number; distance_m: number }>(
    `select p.id,
            extensions.similarity(extensions.unaccent(lower(p.canonical_name)), extensions.unaccent(lower($2))) as similarity,
            extensions.earth_distance(extensions.ll_to_earth(pl.latitude, pl.longitude), extensions.ll_to_earth($3, $4)) as distance_m
     from public.prospects p
     join public.prospect_locations pl on pl.prospect_id = p.id and pl.is_primary
     where p.id <> $1
       and pl.latitude is not null and pl.longitude is not null
       and extensions.earth_distance(extensions.ll_to_earth(pl.latitude, pl.longitude), extensions.ll_to_earth($3, $4)) <= $5
       and extensions.similarity(extensions.unaccent(lower(p.canonical_name)), extensions.unaccent(lower($2))) >= $6
     order by similarity desc
     limit 10`,
    [prospectId, canonicalName, latitude, longitude, PROXIMITY_METERS, NAME_SIMILARITY_THRESHOLD],
  )

  return result.rows
    .filter((row) => row.distance_m <= PROXIMITY_METERS)
    .map((row) => ({
      duplicateOfProspectId: row.id,
      confidence: Math.min(0.95, row.similarity),
      reason: `normalized_name_similarity(${row.similarity.toFixed(2)})+geo_proximity(${Math.round(row.distance_m)}m)`,
    }))
}

/** Records a fuzzy match as a pending prospect_duplicates row — idempotent (ON CONFLICT DO NOTHING) since the unordered-pair unique index means re-running dedup on the same pair is a no-op, not an error. */
export async function recordDuplicateCandidate(pool: DbPool, prospectId: string, candidate: DuplicateCandidate): Promise<void> {
  await pool.query(
    `insert into public.prospect_duplicates (prospect_id, duplicate_of_prospect_id, confidence, reason)
     values ($1, $2, $3, $4)
     on conflict do nothing`,
    [prospectId, candidate.duplicateOfProspectId, candidate.confidence, candidate.reason],
  )
}
