import type { Config } from '../config.js'
import { OsmAdapter } from './osm.js'
import { GeoapifyAdapter } from './geoapify.js'
import { SireneAdapter } from './sirene.js'
import { GooglePlacesAdapter } from './google-places.js'
import { WebsiteAdapter } from './website.js'
import { InstagramAdapter } from './instagram.js'
import type { SourceAdapter } from './types.js'

/**
 * Builds every adapter, keyed by the same `key` values seeded into
 * public.prospect_sources (osm, geoapify, sirene, google_places, website,
 * instagram — see db/migrations/20260811150100_prospect_acquisition_schema.sql).
 * Each adapter is independently constructible regardless of whether its
 * credentials are configured — callers check `isConfigured()` (Worker
 * environment) AND the DB's `is_enabled`/quota-pause state
 * (src/quota.ts) before calling `discover()`.
 */
export function buildSourceRegistry(config: Config): Map<string, SourceAdapter> {
  const adapters: SourceAdapter[] = [
    new OsmAdapter(config),
    new GeoapifyAdapter(config),
    new SireneAdapter(config),
    new GooglePlacesAdapter(config),
    new WebsiteAdapter(config),
    new InstagramAdapter(config),
  ]
  return new Map(adapters.map((a) => [a.key, a]))
}

export type { SourceAdapter } from './types.js'
