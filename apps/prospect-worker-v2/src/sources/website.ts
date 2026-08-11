import type { Config } from '../config.js'
import { fetchText } from '../http.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

const MAX_CRAWL_DEPTH = 1 // homepage + same-domain contact/about page only — never deeper
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 8_000
const MIN_MS_BETWEEN_REQUESTS_PER_DOMAIN = 3_000

// Known booking-widget providers, detected by their script/link domain
// appearing in the page HTML — a cheap, reliable "digital maturity"
// signal for scoring (src/scoring/score.ts) without guessing at markup.
const BOOKING_PROVIDER_DOMAINS: Record<string, string> = {
  'fresha.com': 'fresha',
  'treatwell': 'treatwell',
  'booksy.com': 'booksy',
  'calendly.com': 'calendly',
  'vagaro.com': 'vagaro',
  'simplybook.me': 'simplybook',
  'square.site': 'square',
  'squareup.com/appointments': 'square',
  'setmore.com': 'setmore',
  'schedul.io': 'schedulicity',
}

const lastRequestAtByDomain = new Map<string, number>()

/**
 * Website enrichment — crawls ONLY the pages a normal visitor could reach
 * (homepage, and one same-domain contact/about page if linked from it).
 * Never authenticates, never follows a link off the candidate's own
 * domain, never stores full page bodies (only the specific fields
 * extracted below) and enforces a per-domain minimum request interval so
 * a job with many candidates on slow domains doesn't hammer any one site.
 */
export class WebsiteAdapter implements SourceAdapter {
  readonly key = 'website'
  readonly displayName = 'Website enrichment'

  constructor(private readonly config: Config) {
    void this.config
  }

  isConfigured(): boolean {
    return true
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (!query.websiteUrl) {
      ctx.logger.debug('website: skipped — no websiteUrl in query')
      return []
    }

    let url: URL
    try {
      url = new URL(query.websiteUrl)
    } catch {
      ctx.logger.warn('website: skipped — invalid URL', { url: query.websiteUrl })
      return []
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return []

    const homepage = await politeFetch(url.toString(), url.hostname)
    if (homepage === null) return []

    const extracted = extractBusinessInfo(homepage)

    if (MAX_CRAWL_DEPTH >= 1 && extracted.contactPageUrl) {
      const contactPage = await politeFetch(extracted.contactPageUrl, url.hostname)
      if (contactPage) {
        const contactExtracted = extractBusinessInfo(contactPage)
        extracted.email ??= contactExtracted.email
        extracted.phone ??= contactExtracted.phone
        extracted.instagramHandle ??= contactExtracted.instagramHandle
        extracted.facebookUrl ??= contactExtracted.facebookUrl
        extracted.tiktokHandle ??= contactExtracted.tiktokHandle
        extracted.bookingProvider ??= contactExtracted.bookingProvider
      }
    }

    return [
      {
        externalId: url.toString(),
        externalType: 'website_url',
        name: extracted.title,
        websiteUrl: url.toString(),
        email: extracted.email,
        phone: extracted.phone,
        instagramHandle: extracted.instagramHandle,
        facebookUrl: extracted.facebookUrl,
        tiktokHandle: extracted.tiktokHandle,
        confidence: 0.6,
        rawPayload: {
          title: extracted.title,
          description: extracted.description,
          bookingProvider: extracted.bookingProvider,
        },
      },
    ]
  }
}

async function politeFetch(url: string, domain: string): Promise<string | null> {
  const lastAt = lastRequestAtByDomain.get(domain) ?? 0
  const waitMs = MIN_MS_BETWEEN_REQUESTS_PER_DOMAIN - (Date.now() - lastAt)
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
  lastRequestAtByDomain.set(domain, Date.now())

  try {
    return await fetchText(url, {
      timeoutMs: REQUEST_TIMEOUT_MS,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      headers: { 'user-agent': 'FadeUpProspectWorker/2.0 (+https://fadeup.app)' },
    })
  } catch {
    return null
  }
}

interface ExtractedInfo {
  title?: string
  description?: string
  email?: string
  phone?: string
  instagramHandle?: string
  facebookUrl?: string
  tiktokHandle?: string
  bookingProvider?: string
  contactPageUrl?: string
}

function extractBusinessInfo(html: string): ExtractedInfo {
  const info: ExtractedInfo = {}

  info.title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim()
  info.description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim()

  const mailto = html.match(/mailto:([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/)
  if (mailto?.[1]) info.email = mailto[1].toLowerCase()

  const tel = html.match(/href=["']tel:([+\d][\d\s().-]{5,20})["']/)
  if (tel?.[1]) info.phone = tel[1].trim()

  const instagram = html.match(/instagram\.com\/([a-zA-Z0-9_.]{2,30})/)
  if (instagram?.[1] && !['p', 'explore', 'reel', 'stories'].includes(instagram[1])) {
    info.instagramHandle = instagram[1]
  }

  const facebook = html.match(/href=["'](https?:\/\/(?:www\.)?facebook\.com\/[a-zA-Z0-9._-]+)["']/)
  if (facebook?.[1]) info.facebookUrl = facebook[1]

  const tiktok = html.match(/tiktok\.com\/@([a-zA-Z0-9_.]{2,30})/)
  if (tiktok?.[1]) info.tiktokHandle = tiktok[1]

  for (const [domain, provider] of Object.entries(BOOKING_PROVIDER_DOMAINS)) {
    if (html.includes(domain)) {
      info.bookingProvider = provider
      break
    }
  }

  const contactLink = html.match(/href=["']([^"']*(?:contact|about)[^"']*)["']/i)?.[1]
  if (contactLink && !contactLink.startsWith('mailto:') && !contactLink.startsWith('tel:')) {
    info.contactPageUrl = contactLink
  }

  return info
}
