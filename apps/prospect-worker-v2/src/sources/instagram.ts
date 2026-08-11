import type { Config } from '../config.js'
import { fetchJson } from '../http.js'
import type { DiscoveryQuery, RawCandidate, SourceAdapter, SourceAdapterContext } from './types.js'

interface BusinessDiscoveryResponse {
  business_discovery?: {
    id?: string
    username?: string
    followers_count?: number
    media_count?: number
    biography?: string
    website?: string
  }
}

/**
 * Instagram — OFFICIAL Meta Graph API only, "Business Discovery" endpoint.
 * This is the one legitimate documented way to read another public
 * business/creator account's basic public metrics (follower count,
 * bio, website) without scraping instagram.com HTML: it is queried
 * THROUGH your own connected Instagram professional account
 * (META_INSTAGRAM_BUSINESS_ACCOUNT_ID) via the Graph API, using a
 * long-lived access token (META_ACCESS_TOKEN) with the
 * instagram_manage_insights permission.
 *
 * Both env vars are required — isConfigured() is false with either
 * missing, and the job runner records this source as "skipped", never a
 * failure. Per spec: "remain gracefully disabled if credentials/
 * permissions are unavailable." As of this build neither is provisioned
 * (see infra/worker/.env.worker) — this adapter has not been exercised
 * against the real Graph API and should be re-verified once Meta app
 * review grants the permission (see docs/worker-v2/sources.md).
 */
export class InstagramAdapter implements SourceAdapter {
  readonly key = 'instagram'
  readonly displayName = 'Instagram (official Meta API)'

  constructor(private readonly config: Config) {}

  isConfigured(): boolean {
    return Boolean(this.config.META_ACCESS_TOKEN) && Boolean(this.config.META_INSTAGRAM_BUSINESS_ACCOUNT_ID)
  }

  async discover(query: DiscoveryQuery, ctx: SourceAdapterContext): Promise<RawCandidate[]> {
    if (!this.isConfigured()) {
      throw new Error('instagram: META_ACCESS_TOKEN / META_INSTAGRAM_BUSINESS_ACCOUNT_ID not configured — gracefully disabled')
    }
    if (!query.instagramHandle) {
      ctx.logger.debug('instagram: skipped — no instagramHandle in query')
      return []
    }

    const accountId = this.config.META_INSTAGRAM_BUSINESS_ACCOUNT_ID as string
    const url = new URL(`https://graph.facebook.com/v21.0/${accountId}`)
    url.searchParams.set('fields', `business_discovery.username(${query.instagramHandle}){followers_count,media_count,biography,website}`)
    url.searchParams.set('access_token', this.config.META_ACCESS_TOKEN as string)

    const response = await fetchJson<BusinessDiscoveryResponse>(url.toString(), { timeoutMs: 15_000 })
    const account = response.business_discovery
    if (!account?.username) return []

    return [
      {
        externalId: account.id ?? account.username,
        externalType: 'instagram_business_account_id',
        instagramHandle: account.username,
        websiteUrl: account.website,
        confidence: 0.65,
        rawPayload: {
          followers_count: account.followers_count,
          media_count: account.media_count,
          biography: account.biography,
        },
      },
    ]
  }
}
