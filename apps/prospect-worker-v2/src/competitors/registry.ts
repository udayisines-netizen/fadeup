import type { DbPool } from '../db.js'

/**
 * The competitor (booking-provider) signature registry.
 *
 * ONE place where provider signatures live. The spec is explicit about
 * this — "do not spread regexes randomly throughout code" — so nothing
 * outside this module may hardcode a competitor domain.
 *
 * Source of truth is public.booking_providers.signatures, editable by
 * platform staff from /platform without a deploy. The bundled defaults
 * below exist so the Worker still detects competitors when the DB read
 * fails at startup, and so the unit tests do not need a database.
 */

export type BookingProviderKey =
  | 'PLANITY'
  | 'BOOKSY'
  | 'FRESHA'
  | 'TREATWELL'
  | 'KIUTE'
  | 'RESERVIO'
  | 'SUMUP_BOOKINGS'
  | 'SQUIRE'
  | 'PHOREST'
  | 'SALONIZED'
  | 'TIMIFY'
  | 'TIMELY'
  | 'CUSTOM_BOOKING'
  | 'OTHER'
  | 'NO_BOOKING'
  | 'UNKNOWN'

export interface ProviderSignature {
  key: BookingProviderKey
  displayName: string
  /** Hostnames (or hostname suffixes) that identify this provider. Matched against a parsed URL's host, never against raw page text. */
  domains: string[]
  /** Optional path fragments that raise confidence when present on a matched domain. */
  pathPatterns: string[]
  isSentinel: boolean
  /**
   * Whether a compliant public discovery surface exists for enumerating
   * businesses ON this provider. `false` means website-based detection
   * only — the Worker must never attempt a bypass (spec §6/§12).
   */
  supportsCompliantDiscovery: boolean | null
}

/**
 * Bundled defaults, kept byte-for-byte consistent with the seed rows in
 * db/migrations/20260818100000_prospect_competitor_intelligence.sql. If you
 * change one, change both — tests/competitors.test.ts asserts the key set
 * matches.
 */
export const DEFAULT_PROVIDER_SIGNATURES: readonly ProviderSignature[] = [
  { key: 'PLANITY', displayName: 'Planity', domains: ['planity.com', 'planity.fr'], pathPatterns: ['/booking', '/rendez-vous'], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'BOOKSY', displayName: 'Booksy', domains: ['booksy.com', 'booksy.net'], pathPatterns: ['/b/', '/instant-experiences'], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'FRESHA', displayName: 'Fresha', domains: ['fresha.com', 'shedul.com'], pathPatterns: ['/a/', '/book'], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'TREATWELL', displayName: 'Treatwell', domains: ['treatwell.co.uk', 'treatwell.fr', 'treatwell.com', 'treatwell.it', 'treatwell.es', 'treatwell.nl'], pathPatterns: ['/place/'], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'KIUTE', displayName: 'Kiute', domains: ['kiute.com', 'kiutepro.com', 'flexy.fr'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'RESERVIO', displayName: 'Reservio', domains: ['reservio.com'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'SUMUP_BOOKINGS', displayName: 'SumUp Bookings', domains: ['bookings.sumup.com', 'sumup.link'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'SQUIRE', displayName: 'SQUIRE', domains: ['getsquire.com', 'squire.com'], pathPatterns: ['/booking'], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'PHOREST', displayName: 'Phorest', domains: ['phorest.com', 'phorest.me'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'SALONIZED', displayName: 'Salonized', domains: ['salonized.com'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'TIMIFY', displayName: 'TIMIFY', domains: ['timify.com'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'TIMELY', displayName: 'Timely', domains: ['gettimely.com', 'timelyapp.com'], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  // Matched only when a booking affordance exists on the business's OWN
  // domain and no third-party signature matched — see detect.ts.
  { key: 'CUSTOM_BOOKING', displayName: 'Custom / in-house booking', domains: [], pathPatterns: ['/booking', '/reservation', '/rendez-vous', '/prendre-rdv', '/book-now'], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'OTHER', displayName: 'Other provider', domains: [], pathPatterns: [], isSentinel: false, supportsCompliantDiscovery: null },
  { key: 'NO_BOOKING', displayName: 'No online booking', domains: [], pathPatterns: [], isSentinel: true, supportsCompliantDiscovery: null },
  { key: 'UNKNOWN', displayName: 'Unknown', domains: [], pathPatterns: [], isSentinel: true, supportsCompliantDiscovery: null },
]

export class CompetitorRegistry {
  private constructor(private readonly signatures: ProviderSignature[]) {}

  /** Registry built from the bundled defaults only — used by tests and as the DB-unavailable fallback. */
  static fromDefaults(): CompetitorRegistry {
    return new CompetitorRegistry([...DEFAULT_PROVIDER_SIGNATURES])
  }

  /**
   * Loads signatures from public.booking_providers. Any row with malformed
   * `signatures` JSON falls back to the bundled entry for that key rather
   * than being dropped, so a bad edit in /platform degrades detection for
   * one provider instead of disabling competitor intelligence entirely.
   */
  static async load(pool: DbPool): Promise<CompetitorRegistry> {
    const result = await pool.query<{
      key: string
      display_name: string
      signatures: unknown
      is_sentinel: boolean
      supports_compliant_discovery: boolean | null
    }>(
      `select key, display_name, signatures, is_sentinel, supports_compliant_discovery
       from public.booking_providers
       where is_active
       order by key`,
    )

    if (result.rows.length === 0) return CompetitorRegistry.fromDefaults()

    const signatures = result.rows.map((row): ProviderSignature => {
      const fallback = DEFAULT_PROVIDER_SIGNATURES.find((s) => s.key === row.key)
      const raw = (row.signatures ?? {}) as Record<string, unknown>
      const domains = Array.isArray(raw['domains']) ? (raw['domains'] as unknown[]).filter((d): d is string => typeof d === 'string') : undefined
      const pathPatterns = Array.isArray(raw['path_patterns'])
        ? (raw['path_patterns'] as unknown[]).filter((p): p is string => typeof p === 'string')
        : undefined

      return {
        key: row.key as BookingProviderKey,
        displayName: row.display_name,
        domains: domains ?? fallback?.domains ?? [],
        pathPatterns: pathPatterns ?? fallback?.pathPatterns ?? [],
        isSentinel: row.is_sentinel,
        supportsCompliantDiscovery: row.supports_compliant_discovery,
      }
    })

    return new CompetitorRegistry(signatures)
  }

  all(): readonly ProviderSignature[] {
    return this.signatures
  }

  get(key: BookingProviderKey): ProviderSignature | undefined {
    return this.signatures.find((s) => s.key === key)
  }

  /** Non-sentinel providers with actual domain signatures — the set detection scans. */
  detectable(): readonly ProviderSignature[] {
    return this.signatures.filter((s) => !s.isSentinel && s.domains.length > 0)
  }

  /**
   * Providers we are permitted to use as a DISCOVERY source. Only ones
   * explicitly assessed as having a compliant public surface qualify —
   * `null` (unassessed) is not permission (spec §12).
   */
  discoverable(): readonly ProviderSignature[] {
    return this.signatures.filter((s) => s.supportsCompliantDiscovery === true)
  }

  /**
   * Matches a URL's HOST against the registry. Host-based, never a
   * substring search of page text: "we use Planity at our old shop" in a
   * blog post must not brand a business as a Planity customer.
   */
  matchHost(rawUrl: string): { signature: ProviderSignature; pathMatched: boolean } | null {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch {
      return null
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')

    for (const signature of this.detectable()) {
      for (const domain of signature.domains) {
        const normalized = domain.toLowerCase()
        // Exact host, or a subdomain of it. `booksy.com.evil.test` must
        // NOT match booksy.com, which a naive endsWith would allow.
        if (host === normalized || host.endsWith(`.${normalized}`)) {
          const pathMatched = signature.pathPatterns.some((p) => parsed.pathname.startsWith(p))
          return { signature, pathMatched }
        }
      }
    }

    return null
  }

  /** True when a path looks like a booking affordance on the business's own site. */
  matchOwnDomainBookingPath(pathname: string): boolean {
    const custom = this.get('CUSTOM_BOOKING')
    if (!custom) return false
    const lower = pathname.toLowerCase()
    return custom.pathPatterns.some((p) => lower.startsWith(p) || lower.includes(p))
  }
}
