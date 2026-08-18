/**
 * Structured signal extraction from a crawled HTML page.
 *
 * Deliberately regex/string based rather than a DOM parser: the crawler
 * runs against arbitrary hostile-ish HTML from the open web, and adding a
 * full parser would add both a dependency and a new attack surface for
 * very little gain — everything the acquisition pipeline needs is a
 * URL, an attribute, or a meta tag.
 *
 * Nothing here stores full page bodies. Only the specific fields below are
 * kept (spec §14), which is also why the crawler's response cap can be
 * generous without the database growing without bound.
 */

export interface PageSignals {
  title: string | null
  metaDescription: string | null
  lang: string | null
  /** Every same-origin link, for the crawler's own frontier. */
  internalLinks: string[]
  /** Links pointing off the business's own domain. */
  outboundLinks: string[]
  scriptSrcs: string[]
  iframeSrcs: string[]
  formActions: string[]
  /** Links whose path or anchor text indicates a booking action. */
  bookingLinks: string[]
  /** A subset of bookingLinks: those on an element that looks like a call-to-action button. */
  bookingButtonTargets: string[]
  /** URLs found inside JSON-LD / schema.org blocks (potentialAction, sameAs, ...). */
  structuredDataUrls: string[]
  emails: string[]
  phones: string[]
  instagramHandles: string[]
  facebookUrls: string[]
  tiktokHandles: string[]
  hasContactForm: boolean
  hasMobileViewport: boolean
  hasStructuredData: boolean
  hasEcommerceSignal: boolean
  hasGiftCardSignal: boolean
  /** Detected CMS/site builder, e.g. 'wordpress'. Null when nothing matched. */
  cms: string | null
  /** Detected analytics/pixel platforms. */
  analytics: string[]
  /** Team/barber name-ish blocks found on a team page — a weak headcount signal. */
  teamMemberCount: number | null
  /** Prices found on the page, for a "publishes pricing" signal. */
  priceCount: number
}

const BOOKING_PATH_HINTS = [
  'book',
  'booking',
  'reserve',
  'reservation',
  'rendez-vous',
  'rendezvous',
  'prendre-rdv',
  'rdv',
  'appointment',
  'buchen',
  'prenota',
]

const BOOKING_TEXT_HINTS = [
  'book now',
  'book online',
  'book an appointment',
  'prendre rendez-vous',
  'prendre rdv',
  'réserver',
  'reserver',
  'réservation',
  'reservation',
  'jetzt buchen',
  'prenota ora',
]

const CMS_SIGNATURES: { cms: string; markers: string[] }[] = [
  { cms: 'wordpress', markers: ['/wp-content/', '/wp-includes/', 'wp-json'] },
  { cms: 'wix', markers: ['static.parastorage.com', 'wixstatic.com', '_wixCssStates'] },
  { cms: 'squarespace', markers: ['static1.squarespace.com', 'squarespace-cdn.com', 'Static.SQUARESPACE_CONTEXT'] },
  { cms: 'webflow', markers: ['assets.website-files.com', 'webflow.js', 'data-wf-page'] },
  { cms: 'shopify', markers: ['cdn.shopify.com', 'Shopify.theme', 'shopify-section'] },
  { cms: 'joomla', markers: ['/media/jui/', 'joomla-script-options'] },
  { cms: 'drupal', markers: ['/sites/default/files/', 'drupal-settings-json'] },
  { cms: 'jimdo', markers: ['jimdo.com', 'jimstatic.com'] },
  { cms: 'godaddy_website_builder', markers: ['img1.wsimg.com', 'websitebuilder'] },
]

const ANALYTICS_SIGNATURES: { key: string; markers: string[] }[] = [
  { key: 'google_analytics', markers: ['googletagmanager.com/gtag/js', 'google-analytics.com/analytics.js', 'gtag('] },
  { key: 'google_tag_manager', markers: ['googletagmanager.com/gtm.js', 'GTM-'] },
  { key: 'meta_pixel', markers: ['connect.facebook.net', 'fbq('] },
  { key: 'tiktok_pixel', markers: ['analytics.tiktok.com'] },
  { key: 'hotjar', markers: ['static.hotjar.com'] },
  { key: 'matomo', markers: ['matomo.js', 'piwik.js'] },
  { key: 'plausible', markers: ['plausible.io/js'] },
]

const ECOMMERCE_MARKERS = ['add to cart', 'ajouter au panier', 'woocommerce', 'shopify', 'panier', '/cart', '/checkout']
const GIFT_CARD_MARKERS = ['gift card', 'carte cadeau', 'bon cadeau', 'chèque cadeau', 'giftcard']

export function extractPageSignals(html: string, pageUrl: string): PageSignals {
  const lower = html.toLowerCase()
  let origin = ''
  try {
    origin = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    origin = ''
  }

  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]{0,300}?)<\/a>/gi)]
  const internalLinks: string[] = []
  const outboundLinks: string[] = []
  const bookingLinks: string[] = []
  const bookingButtonTargets: string[] = []

  for (const match of anchors) {
    const attrs = match[1] ?? ''
    const inner = match[2] ?? ''
    const href = attrValue(attrs, 'href')
    if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue

    const absolute = toAbsolute(href, pageUrl)
    if (!absolute) continue

    const host = safeHost(absolute)
    if (host && origin && (host === origin || host.endsWith(`.${origin}`))) {
      internalLinks.push(absolute)
    } else {
      outboundLinks.push(absolute)
    }

    const anchorText = stripTags(inner).toLowerCase().trim()
    const path = safePath(absolute).toLowerCase()
    const looksLikeBooking =
      BOOKING_PATH_HINTS.some((hint) => path.includes(hint)) || BOOKING_TEXT_HINTS.some((hint) => anchorText.includes(hint))

    if (looksLikeBooking) {
      bookingLinks.push(absolute)
      // A CTA-styled anchor (button role/class) is much stronger evidence
      // than a footer link.
      const classAttr = (attrValue(attrs, 'class') ?? '').toLowerCase()
      const roleAttr = (attrValue(attrs, 'role') ?? '').toLowerCase()
      if (roleAttr === 'button' || /\b(btn|button|cta|book)\b/.test(classAttr)) {
        bookingButtonTargets.push(absolute)
      }
    }
  }

  const scriptSrcs = [...html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => toAbsolute(m[1] ?? '', pageUrl))
    .filter((u): u is string => u !== null)

  const iframeSrcs = [...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => toAbsolute(m[1] ?? '', pageUrl))
    .filter((u): u is string => u !== null)

  const formActions = [...html.matchAll(/<form\b[^>]*\baction\s*=\s*["']([^"']+)["']/gi)]
    .map((m) => toAbsolute(m[1] ?? '', pageUrl))
    .filter((u): u is string => u !== null)

  const structuredDataBlocks = [...html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1] ?? '')

  const structuredDataUrls = extractStructuredDataUrls(structuredDataBlocks, pageUrl)

  const emails = unique(
    [...html.matchAll(/mailto:([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)]
      .map((m) => (m[1] ?? '').toLowerCase())
      // Exclude the placeholder addresses site builders ship with.
      .filter((email) => !/^(example|test|your|email|name)@/.test(email)),
  )

  const phones = unique(
    [...html.matchAll(/href=["']tel:([+\d][\d\s().\-/]{5,24})["']/gi)].map((m) => (m[1] ?? '').trim()),
  )

  const instagramHandles = unique(
    [...html.matchAll(/instagram\.com\/([A-Za-z0-9_.]{2,30})/gi)]
      .map((m) => (m[1] ?? '').toLowerCase())
      .filter((handle) => !['p', 'explore', 'reel', 'reels', 'stories', 'tv', 'accounts', 'direct'].includes(handle)),
  )

  const facebookUrls = unique(
    [...html.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/[A-Za-z0-9._%-]{2,60}/gi)].map((m) => m[0]),
  )

  const tiktokHandles = unique([...html.matchAll(/tiktok\.com\/@([A-Za-z0-9_.]{2,30})/gi)].map((m) => (m[1] ?? '').toLowerCase()))

  const cms = CMS_SIGNATURES.find((sig) => sig.markers.some((marker) => lower.includes(marker.toLowerCase())))?.cms ?? null

  const analytics = ANALYTICS_SIGNATURES.filter((sig) => sig.markers.some((marker) => lower.includes(marker.toLowerCase()))).map(
    (sig) => sig.key,
  )

  return {
    title: decodeEntities(html.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)?.[1]?.trim() ?? '') || null,
    metaDescription:
      decodeEntities(
        html.match(/<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i)?.[1]?.trim() ?? '',
      ) || null,
    lang: html.match(/<html\b[^>]*\blang\s*=\s*["']([A-Za-z-]{2,10})["']/i)?.[1]?.toLowerCase() ?? null,
    internalLinks: unique(internalLinks),
    outboundLinks: unique(outboundLinks),
    scriptSrcs: unique(scriptSrcs),
    iframeSrcs: unique(iframeSrcs),
    formActions: unique(formActions),
    bookingLinks: unique(bookingLinks),
    bookingButtonTargets: unique(bookingButtonTargets),
    structuredDataUrls: unique(structuredDataUrls),
    emails,
    phones,
    instagramHandles,
    facebookUrls,
    tiktokHandles,
    // A <form> containing an email/message field, not merely any form (a
    // search box or newsletter signup is not a contact form).
    hasContactForm: /<form[\s\S]{0,3000}?(type=["']email["']|name=["'][^"']*(message|mail|contact)[^"']*["']|<textarea)/i.test(html),
    hasMobileViewport: /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*content\s*=\s*["'][^"']*width\s*=\s*device-width/i.test(html),
    hasStructuredData: structuredDataBlocks.length > 0,
    hasEcommerceSignal: ECOMMERCE_MARKERS.some((marker) => lower.includes(marker)),
    hasGiftCardSignal: GIFT_CARD_MARKERS.some((marker) => lower.includes(marker)),
    cms,
    analytics,
    teamMemberCount: countTeamMembers(html),
    priceCount: countPrices(html),
  }
}

/**
 * Pulls URLs out of JSON-LD. Only `url`, `sameAs` and `potentialAction.target`
 * are read — a booking `potentialAction` pointing at a provider domain is
 * one of the strongest competitor signals available, because it is the
 * business explicitly declaring where booking happens.
 */
function extractStructuredDataUrls(blocks: string[], pageUrl: string): string[] {
  const urls: string[] = []

  for (const block of blocks) {
    let parsed: unknown
    try {
      parsed = JSON.parse(block)
    } catch {
      continue
    }

    const walk = (node: unknown, depth: number): void => {
      if (depth > 6 || node === null || typeof node !== 'object') return

      if (Array.isArray(node)) {
        for (const item of node.slice(0, 50)) walk(item, depth + 1)
        return
      }

      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (typeof value === 'string' && /^https?:\/\//i.test(value) && ['url', 'sameas', 'target', 'urltemplate'].includes(key.toLowerCase())) {
          const absolute = toAbsolute(value, pageUrl)
          if (absolute) urls.push(absolute)
        } else if (typeof value === 'object') {
          walk(value, depth + 1)
        }
      }
    }

    walk(parsed, 0)
  }

  return urls
}

/**
 * Counts likely team-member entries on a page. Intentionally crude and
 * intentionally conservative: it returns null unless a page looks like a
 * genuine team listing, because an over-eager headcount would inflate the
 * multi-barber signal that both scores rely on.
 */
function countTeamMembers(html: string): number | null {
  const teamSectionMatch = html.match(
    /<(section|div|ul)\b[^>]*(class|id)\s*=\s*["'][^"']*(team|equipe|barbers|coiffeurs|staff|our-team)[^"']*["'][\s\S]{0,20000}?<\/\1>/i,
  )
  if (!teamSectionMatch) return null

  const section = teamSectionMatch[0]
  // Count repeated card-ish structures with a heading inside.
  const headings = section.match(/<(h[2-5])\b[^>]*>[\s\S]{2,60}?<\/\1>/gi)?.length ?? 0
  const figcaptions = section.match(/<figcaption\b[^>]*>[\s\S]{2,60}?<\/figcaption>/gi)?.length ?? 0
  const count = Math.max(headings, figcaptions)

  // 1 heading is a section title, not a person. Cap at a sane maximum so
  // a marquee of repeated markup cannot produce "47 barbers".
  if (count < 2) return null
  return Math.min(count, 30)
}

/** Counts currency-formatted prices, a "publishes pricing publicly" signal. */
function countPrices(html: string): number {
  const text = stripTags(html)
  const matches = text.match(/(?:[€£$]\s?\d{1,3}(?:[.,]\d{2})?)|(?:\d{1,3}(?:[.,]\d{2})?\s?(?:€|EUR|£|GBP))/g)
  return matches ? Math.min(matches.length, 200) : 0
}

function attrValue(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))
  return match?.[1] ?? null
}

function toAbsolute(href: string, base: string): string | null {
  try {
    const url = new URL(href, base)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return ''
  }
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))]
}
