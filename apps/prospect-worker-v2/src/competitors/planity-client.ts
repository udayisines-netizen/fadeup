import type { DbPool } from '../db.js'
import type { Logger } from '../logger.js'
import { fetchText } from '../http.js'
import { HttpError, SourcePausedError, withQuotaGuard } from '../quota.js'
import {
  canonicalizePlanityUrl,
  isPathAllowed,
  isPlanityEstablishmentUrl,
  parseRobots,
  type RobotsRules,
} from './planity.js'

/**
 * The only thing in FadeUp that sends a request to planity.com.
 *
 * Every constraint the brief imposes on crawling is enforced HERE rather than
 * being left to callers, because a rule that each call site has to remember is
 * a rule that will eventually be forgotten:
 *
 *   * robots.txt is fetched once and honoured. Unfetchable robots means we do
 *     NOT request — fail closed, not open.
 *   * The URL must be a Planity ESTABLISHMENT page. A category page, a
 *     marketing page, or any other host is refused before a socket opens.
 *   * One request in flight at a time, with a minimum gap between requests.
 *   * Hard timeout and a response size cap.
 *   * 403 / 429 / challenge => report and STOP. There is no retry-with-a-
 *     different-User-Agent path, no proxy rotation, no CAPTCHA handling. If
 *     Planity does not want automated requests, the correct behaviour is to
 *     stop making them.
 *
 * The quota guard wraps every request, so api_source_health gets latency,
 * success/failure and status codes for free, and an operator can pause the
 * source from /platform without a deploy.
 */

export type PlanityFetchOutcome =
  | { status: 'ok'; html: string; finalUrl: string }
  /** Refused before the network: wrong host, wrong page shape, or robots. */
  | { status: 'refused'; reason: 'not_planity' | 'not_establishment' | 'robots_denied' | 'robots_unavailable' }
  /** Planity answered, and the answer was "no". */
  | { status: 'blocked'; reason: 'forbidden' | 'rate_limited' | 'challenge'; statusCode: number | null }
  | { status: 'not_found' }
  | { status: 'error'; reason: string }

export interface PlanityClientOptions {
  timeoutMs: number
  /** Minimum wall-clock gap between two requests to planity.com. */
  minRequestIntervalMs: number
  maxResponseBytes: number
}

export const PLANITY_DEFAULTS: PlanityClientOptions = {
  timeoutMs: 20_000,
  // Deliberately slow. There is no volume target here: this reads one page per
  // prospect, and a business's Planity listing does not change minute to
  // minute. Politeness costs nothing that matters.
  minRequestIntervalMs: 2_000,
  // Observed establishment pages are ~1.5 MB. 4 MB leaves headroom for a
  // larger salon without letting a pathological response exhaust memory.
  maxResponseBytes: 4 * 1024 * 1024,
}

const ROBOTS_URL = 'https://www.planity.com/robots.txt'
const USER_AGENT = 'FadeUpProspectWorker/2.0 (+https://fadeup.app)'

/** Markers of an interstitial challenge served with a 200. */
const CHALLENGE_MARKERS = [
  'cf-browser-verification',
  'cf_chl_opt',
  '__cf_chl',
  'Checking your browser',
  'Just a moment...',
  'Attention Required! | Cloudflare',
  'px-captcha',
  'g-recaptcha',
  'hcaptcha.com',
]

export class PlanityClient {
  private robots: RobotsRules | null = null
  private robotsFetched = false
  private robotsAvailable = false
  private lastRequestAt = 0
  /** Serialises requests: one in flight, ever. */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly pool: DbPool,
    private readonly jobId: string | null,
    private readonly log: Logger,
    private readonly options: PlanityClientOptions = PLANITY_DEFAULTS,
  ) {}

  /**
   * Fetches one establishment page.
   *
   * Returns an outcome rather than throwing for expected refusals, because
   * "Planity is blocking us" is a fact the job must record and act on, not an
   * exception to propagate. Genuinely unexpected failures still surface as
   * `{ status: 'error' }` with the reason, and SourcePausedError is rethrown
   * so the job can skip cleanly.
   */
  async fetchEstablishment(rawUrl: string): Promise<PlanityFetchOutcome> {
    const canonical = canonicalizePlanityUrl(rawUrl)
    if (!canonical) return { status: 'refused', reason: 'not_planity' }
    if (!isPlanityEstablishmentUrl(canonical)) return { status: 'refused', reason: 'not_establishment' }

    await this.loadRobots()
    if (!this.robotsAvailable || !this.robots) {
      // Fail CLOSED. A site whose robots.txt we cannot read has not given us
      // permission; assuming permission because the file was unreachable is
      // the wrong direction to be wrong.
      return { status: 'refused', reason: 'robots_unavailable' }
    }

    const { pathname } = new URL(canonical)
    if (!isPathAllowed(pathname, this.robots)) {
      this.log.info('planity: path disallowed by robots.txt', { path: pathname })
      return { status: 'refused', reason: 'robots_denied' }
    }

    return this.serialize(async () => {
      await this.respectInterval()

      try {
        const html = await withQuotaGuard(
          this.pool,
          { sourceKey: 'planity', jobId: this.jobId, endpoint: 'establishment' },
          async () => ({
            value: await fetchText(canonical, {
              headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' },
              timeoutMs: this.options.timeoutMs,
              maxResponseBytes: this.options.maxResponseBytes,
            }),
          }),
        )

        // A 200 that is actually a challenge page. Treated as blocked, never
        // parsed: extracting nulls from an interstitial and recording them as
        // "no evidence found" would be a fabricated observation.
        if (looksLikeChallenge(html)) {
          this.log.warn('planity: challenge interstitial served — backing off', { url: canonical })
          return { status: 'blocked', reason: 'challenge', statusCode: 200 }
        }

        return { status: 'ok', html, finalUrl: canonical }
      } catch (error) {
        if (error instanceof SourcePausedError) throw error

        if (error instanceof HttpError) {
          if (error.statusCode === 404 || error.statusCode === 410) return { status: 'not_found' }
          if (error.statusCode === 403) {
            this.log.warn('planity: 403 — stopping, not evading', { url: canonical })
            return { status: 'blocked', reason: 'forbidden', statusCode: 403 }
          }
          if (error.statusCode === 429) {
            this.log.warn('planity: 429 rate limited — backing off', { url: canonical })
            return { status: 'blocked', reason: 'rate_limited', statusCode: 429 }
          }
        }

        return { status: 'error', reason: error instanceof Error ? error.message : String(error) }
      }
    })
  }

  /** Fetched at most once per client instance. */
  private async loadRobots(): Promise<void> {
    if (this.robotsFetched) return
    this.robotsFetched = true

    try {
      const text = await fetchText(ROBOTS_URL, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/plain,*/*' },
        timeoutMs: this.options.timeoutMs,
        maxResponseBytes: 256 * 1024,
      })
      this.robots = parseRobots(text)
      this.robotsAvailable = true
      this.log.info('planity: robots.txt loaded', { disallow_rules: this.robots.disallow.length })
    } catch (error) {
      this.robotsAvailable = false
      this.log.warn('planity: robots.txt unavailable — refusing to fetch', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async respectInterval(): Promise<void> {
    const since = Date.now() - this.lastRequestAt
    const wait = this.options.minRequestIntervalMs - since
    if (wait > 0) await sleep(wait)
    this.lastRequestAt = Date.now()
  }

  /** One request at a time, regardless of how many callers overlap. */
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

export function looksLikeChallenge(html: string): boolean {
  // Only the head of the document: a salon whose description happens to
  // mention "just a moment" must not be mistaken for an interstitial, and a
  // real challenge page is short and front-loaded.
  const head = html.slice(0, 4096)
  return CHALLENGE_MARKERS.some((marker) => head.includes(marker))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
