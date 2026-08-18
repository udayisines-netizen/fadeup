import { assertUrlIsSafe, SsrfBlockedError } from './ssrf.js'
import { extractPageSignals, type PageSignals } from './extract.js'
import type { Logger } from '../logger.js'

/**
 * Bounded, SSRF-guarded website crawler.
 *
 * Every limit below is a hard stop, not a hint (spec §15). The crawler
 * only ever fetches pages an anonymous visitor could load: it sends no
 * credentials, follows no login, and stops at the first sign it has been
 * handed something that is not a public HTML page.
 */

export interface CrawlLimits {
  maxPagesPerDomain: number
  maxDepth: number
  maxRedirects: number
  maxResponseBytes: number
  perRequestTimeoutMs: number
  totalCrawlTimeoutMs: number
  minMsBetweenRequests: number
}

export const DEFAULT_CRAWL_LIMITS: CrawlLimits = {
  maxPagesPerDomain: 8,
  maxDepth: 2,
  maxRedirects: 3,
  maxResponseBytes: 2 * 1024 * 1024,
  perRequestTimeoutMs: 8_000,
  totalCrawlTimeoutMs: 45_000,
  // Politeness: never more than one request per domain per interval.
  minMsBetweenRequests: 1_500,
}

/**
 * Pages worth fetching, in priority order (spec §14). The crawler follows
 * same-domain links whose path or anchor text matches one of these hints,
 * highest priority first, and stops as soon as maxPagesPerDomain is hit.
 */
const PRIORITY_PATH_HINTS: readonly string[] = [
  'contact',
  'booking',
  'reservation',
  'rendez-vous',
  'prendre-rdv',
  'reserver',
  'about',
  'a-propos',
  'equipe',
  'team',
  'barbers',
  'coiffeurs',
  'services',
  'prestations',
  'tarifs',
  'pricing',
  'prix',
  'shop',
  'boutique',
  'mentions-legales',
  'legal',
]

const ACCEPTED_CONTENT_TYPES = ['text/html', 'application/xhtml+xml']

export interface CrawledPage extends PageSignals {
  url: string
  statusCode: number
  contentType: string | null
  byteSize: number
  responseTimeMs: number
  depth: number
}

export interface CrawlResult {
  /** True only when at least one page was successfully fetched and parsed. Everything downstream that could produce a FALSE feature must check this first. */
  succeeded: boolean
  startUrl: string
  finalUrl: string | null
  pages: CrawledPage[]
  /** Every distinct hop, for the redirect/HTTPS analysis in feature engineering. */
  redirectChain: string[]
  httpsSupported: boolean | null
  /** Populated when the crawl failed outright; null on success. */
  failureReason: string | null
  brokenLinks: string[]
  totalDurationMs: number
}

const lastRequestAtByHost = new Map<string, number>()

/**
 * Crawls a business website within the given limits.
 *
 * Never throws for an ordinary failure (DNS, 404, timeout, blocked host) —
 * it returns `succeeded: false` with a reason, because the caller must be
 * able to distinguish "we looked and found nothing" from "we could not
 * look", and an exception erases that distinction.
 */
export async function crawlWebsite(
  startUrl: string,
  log: Logger,
  limits: CrawlLimits = DEFAULT_CRAWL_LIMITS,
): Promise<CrawlResult> {
  const startedAt = Date.now()
  const result: CrawlResult = {
    succeeded: false,
    startUrl,
    finalUrl: null,
    pages: [],
    redirectChain: [],
    httpsSupported: null,
    failureReason: null,
    brokenLinks: [],
    totalDurationMs: 0,
  }

  let origin: string
  try {
    const parsed = new URL(startUrl)
    origin = parsed.hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    result.failureReason = 'invalid_start_url'
    result.totalDurationMs = Date.now() - startedAt
    return result
  }

  const visited = new Set<string>()
  const queue: { url: string; depth: number }[] = [{ url: startUrl, depth: 0 }]

  while (queue.length > 0 && result.pages.length < limits.maxPagesPerDomain) {
    if (Date.now() - startedAt > limits.totalCrawlTimeoutMs) {
      log.warn('crawl: total time budget exhausted', { startUrl, pages: result.pages.length })
      break
    }

    const next = queue.shift()
    if (!next) break

    const normalized = normalizeUrlForVisit(next.url)
    if (!normalized || visited.has(normalized)) continue
    visited.add(normalized)

    const fetched = await fetchPage(next.url, log, limits)

    if (fetched.kind === 'redirect_chain') {
      result.redirectChain.push(...fetched.chain)
    }

    if (fetched.kind !== 'ok') {
      if (result.pages.length === 0 && next.depth === 0) {
        // The entry point itself failed — the whole crawl failed.
        result.failureReason = fetched.reason
        result.totalDurationMs = Date.now() - startedAt
        return result
      }
      if (fetched.reason === 'http_error') {
        result.brokenLinks.push(next.url)
      }
      continue
    }

    result.redirectChain.push(...fetched.chain)
    const signals = extractPageSignals(fetched.body, fetched.finalUrl)
    const page: CrawledPage = {
      ...signals,
      url: fetched.finalUrl,
      statusCode: fetched.statusCode,
      contentType: fetched.contentType,
      byteSize: fetched.byteSize,
      responseTimeMs: fetched.responseTimeMs,
      depth: next.depth,
    }
    result.pages.push(page)

    if (result.finalUrl === null) {
      result.finalUrl = fetched.finalUrl
      result.httpsSupported = new URL(fetched.finalUrl).protocol === 'https:'
    }

    if (next.depth < limits.maxDepth) {
      for (const candidate of prioritizeLinks(signals.internalLinks, origin)) {
        if (queue.length + result.pages.length >= limits.maxPagesPerDomain * 2) break
        queue.push({ url: candidate, depth: next.depth + 1 })
      }
    }
  }

  result.succeeded = result.pages.length > 0
  if (!result.succeeded && result.failureReason === null) {
    result.failureReason = 'no_pages_fetched'
  }
  result.totalDurationMs = Date.now() - startedAt
  return result
}

type FetchOutcome =
  | {
      kind: 'ok'
      body: string
      finalUrl: string
      statusCode: number
      contentType: string | null
      byteSize: number
      responseTimeMs: number
      chain: string[]
    }
  | { kind: 'failed'; reason: string; chain: string[] }
  | { kind: 'redirect_chain'; reason: string; chain: string[] }

/**
 * Fetches one page. Redirects are followed MANUALLY so every hop can be
 * re-validated against the SSRF guard — `redirect: 'follow'` would let hop
 * 2 land on 127.0.0.1 after hop 1 passed validation.
 */
async function fetchPage(rawUrl: string, log: Logger, limits: CrawlLimits): Promise<FetchOutcome> {
  const chain: string[] = []
  let currentUrl = rawUrl

  for (let hop = 0; hop <= limits.maxRedirects; hop++) {
    let safe
    try {
      safe = await assertUrlIsSafe(currentUrl)
    } catch (error) {
      const reason = error instanceof SsrfBlockedError ? `ssrf_blocked:${error.reason}` : 'url_validation_failed'
      log.warn('crawl: url rejected by SSRF guard', { url: currentUrl, reason })
      return { kind: 'failed', reason, chain }
    }

    await respectPoliteness(safe.url.hostname, limits.minMsBetweenRequests)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), limits.perRequestTimeoutMs)
    const requestStartedAt = Date.now()

    let response: Response
    try {
      response = await fetch(safe.url, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
          'user-agent': 'FadeUpProspectWorker/2.0 (+https://fadeup.app)',
          'accept-language': 'fr;q=0.9,en;q=0.8',
        },
      })
    } catch (error) {
      clearTimeout(timeout)
      const aborted = error instanceof Error && error.name === 'AbortError'
      return { kind: 'failed', reason: aborted ? 'timeout' : 'network_error', chain }
    } finally {
      clearTimeout(timeout)
    }

    const responseTimeMs = Date.now() - requestStartedAt

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) return { kind: 'failed', reason: 'redirect_without_location', chain }
      let nextUrl: string
      try {
        nextUrl = new URL(location, safe.url).toString()
      } catch {
        return { kind: 'failed', reason: 'invalid_redirect_target', chain }
      }
      chain.push(nextUrl)
      currentUrl = nextUrl
      continue
    }

    if (!response.ok) {
      // Drain nothing — we do not want the body of an error page.
      await response.body?.cancel()
      return { kind: 'failed', reason: 'http_error', chain }
    }

    const contentType = response.headers.get('content-type')
    const mime = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''
    if (!ACCEPTED_CONTENT_TYPES.includes(mime)) {
      await response.body?.cancel()
      return { kind: 'failed', reason: `unsupported_content_type:${mime || 'unknown'}`, chain }
    }

    const declaredLength = response.headers.get('content-length')
    if (declaredLength && Number(declaredLength) > limits.maxResponseBytes) {
      await response.body?.cancel()
      return { kind: 'failed', reason: 'response_too_large', chain }
    }

    const read = await readBounded(response, limits.maxResponseBytes)
    if (read === null) {
      return { kind: 'failed', reason: 'response_too_large', chain }
    }

    return {
      kind: 'ok',
      body: read.text,
      finalUrl: safe.url.toString(),
      statusCode: response.status,
      contentType,
      byteSize: read.bytes,
      responseTimeMs,
      chain,
    }
  }

  return { kind: 'failed', reason: 'too_many_redirects', chain }
}

/** Streams the body, aborting the moment it exceeds the cap — a Content-Length header is not trustworthy on its own. */
async function readBounded(response: Response, maxBytes: number): Promise<{ text: string; bytes: number } | null> {
  if (!response.body) {
    const text = await response.text()
    return { text, bytes: Buffer.byteLength(text) }
  }

  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(Buffer.from(value))
  }

  return { text: Buffer.concat(chunks).toString('utf-8'), bytes: total }
}

async function respectPoliteness(host: string, minIntervalMs: number): Promise<void> {
  const lastAt = lastRequestAtByHost.get(host) ?? 0
  const waitMs = minIntervalMs - (Date.now() - lastAt)
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  lastRequestAtByHost.set(host, Date.now())
}

/** Sorts same-domain links so the highest-value pages are crawled first within the page budget. */
function prioritizeLinks(links: string[], origin: string): string[] {
  const scored: { url: string; rank: number }[] = []

  for (const link of links) {
    let parsed: URL
    try {
      parsed = new URL(link)
    } catch {
      continue
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== origin) continue

    const path = parsed.pathname.toLowerCase()
    const rank = PRIORITY_PATH_HINTS.findIndex((hint) => path.includes(hint))
    if (rank === -1) continue
    scored.push({ url: parsed.toString(), rank })
  }

  scored.sort((a, b) => a.rank - b.rank)
  return [...new Set(scored.map((s) => s.url))]
}

/** Strips the fragment and trailing slash so /contact and /contact#form are one page. */
function normalizeUrlForVisit(raw: string): string | null {
  try {
    const parsed = new URL(raw)
    parsed.hash = ''
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.origin}${path || '/'}${parsed.search}`
  } catch {
    return null
  }
}
