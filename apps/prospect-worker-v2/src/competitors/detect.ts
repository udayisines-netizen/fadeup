import type { CompetitorRegistry, BookingProviderKey } from './registry.js'
import type { CrawledPage } from '../crawler/crawl.js'

/**
 * Competitor detection from a crawled page's structured signals.
 *
 * Only compliant, publicly-observable evidence is used: link/script/iframe
 * targets, JSON-LD, and form actions on pages a normal anonymous visitor
 * can load. Nothing here logs in, solves a challenge, or reads a
 * protected surface (spec §6/§11).
 */

export type DetectionMethod =
  | 'booking_url'
  | 'outbound_link'
  | 'embedded_widget'
  | 'iframe_domain'
  | 'script_domain'
  | 'booking_button_target'
  | 'structured_data'
  | 'domain_pattern'
  | 'provider_directory'
  | 'manual_override'

export interface CompetitorDetection {
  providerKey: BookingProviderKey
  detectionMethod: DetectionMethod
  evidence: string
  evidenceUrl: string | null
  confidence: number
}

/**
 * Confidence by signal strength. A booking BUTTON pointing at a provider
 * is near-certain; a bare outbound link in a footer is weaker (it could be
 * a "find us on" listing). These are deliberately conservative — a wrong
 * competitor attribution sends a barber the wrong sales angle.
 */
const METHOD_CONFIDENCE: Record<DetectionMethod, number> = {
  booking_url: 0.97,
  booking_button_target: 0.95,
  embedded_widget: 0.93,
  iframe_domain: 0.92,
  script_domain: 0.9,
  structured_data: 0.88,
  outbound_link: 0.7,
  domain_pattern: 0.65,
  provider_directory: 0.99,
  manual_override: 1,
}

/** Bonus when the matched URL's path also matches the provider's booking path pattern. */
const PATH_MATCH_BONUS = 0.02

/**
 * Runs detection across every signal the crawler extracted. Returns ALL
 * detections found (each becomes an observation row), plus the single
 * strongest one as the current provider.
 *
 * When the crawl succeeded and NOTHING matched, the answer is NO_BOOKING
 * — a real, evidence-backed negative. When the crawl did not succeed, the
 * caller must not call this at all: the answer is UNKNOWN, and conflating
 * the two is precisely what spec §10 forbids.
 */
export function detectCompetitors(pages: CrawledPage[], registry: CompetitorRegistry): CompetitorDetection[] {
  const detections = new Map<string, CompetitorDetection>()

  const record = (detection: CompetitorDetection): void => {
    const dedupeKey = `${detection.providerKey}:${detection.detectionMethod}`
    const existing = detections.get(dedupeKey)
    if (!existing || detection.confidence > existing.confidence) {
      detections.set(dedupeKey, detection)
    }
  }

  for (const page of pages) {
    const signalGroups: { urls: string[]; method: DetectionMethod }[] = [
      { urls: page.scriptSrcs, method: 'script_domain' },
      { urls: page.iframeSrcs, method: 'iframe_domain' },
      { urls: page.bookingLinks, method: 'booking_url' },
      { urls: page.bookingButtonTargets, method: 'booking_button_target' },
      { urls: page.formActions, method: 'embedded_widget' },
      { urls: page.structuredDataUrls, method: 'structured_data' },
      { urls: page.outboundLinks, method: 'outbound_link' },
    ]

    for (const { urls, method } of signalGroups) {
      for (const url of urls) {
        const match = registry.matchHost(url)
        if (!match) continue

        record({
          providerKey: match.signature.key,
          detectionMethod: method,
          evidence: truncate(url, 2000),
          evidenceUrl: truncate(page.url, 2000),
          confidence: Math.min(1, METHOD_CONFIDENCE[method] + (match.pathMatched ? PATH_MATCH_BONUS : 0)),
        })
      }
    }
  }

  // If no third-party provider matched, check for a booking affordance on
  // the business's OWN domain — an in-house/custom booking system, which
  // is a materially different sales conversation from "no booking at all".
  if (detections.size === 0) {
    for (const page of pages) {
      const ownDomainBooking = [...page.bookingLinks, ...page.bookingButtonTargets].find((url) => {
        try {
          const parsed = new URL(url, page.url)
          return parsed.hostname === new URL(page.url).hostname && registry.matchOwnDomainBookingPath(parsed.pathname)
        } catch {
          return false
        }
      })

      if (ownDomainBooking) {
        record({
          providerKey: 'CUSTOM_BOOKING',
          detectionMethod: 'domain_pattern',
          evidence: truncate(ownDomainBooking, 2000),
          evidenceUrl: truncate(page.url, 2000),
          confidence: METHOD_CONFIDENCE.domain_pattern,
        })
        break
      }
    }
  }

  return [...detections.values()].sort((a, b) => b.confidence - a.confidence)
}

/**
 * The provider to record as CURRENT. Highest confidence wins; ties break
 * toward the stronger detection method. Returns null when there is nothing
 * to record — the caller decides between NO_BOOKING (crawl succeeded) and
 * UNKNOWN (crawl did not).
 */
export function strongestDetection(detections: CompetitorDetection[]): CompetitorDetection | null {
  return detections[0] ?? null
}

/**
 * The evidence-backed negative. Only ever produced by a caller that
 * actually completed a crawl.
 */
export function noBookingDetection(evidenceUrl: string, pagesCrawled: number): CompetitorDetection {
  return {
    providerKey: 'NO_BOOKING',
    detectionMethod: 'domain_pattern',
    evidence: `crawled ${pagesCrawled} page(s), no booking affordance or known provider signature found`,
    evidenceUrl: truncate(evidenceUrl, 2000),
    // Deliberately not 1.0: absence of evidence on a small crawl is a
    // weaker claim than a positive match.
    confidence: 0.7,
  }
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
