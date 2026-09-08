import { describe, expect, it } from 'vitest'

import {
  FEED_PAGE_SIZE,
  bookTargetForPost,
  dedupeFeedPages,
  feedAttribution,
  feedAuthorName,
  feedAuthorRoute,
  nextFeedCursor,
  parseFeedMedia,
  parseFeedServices,
  type FeedRow,
} from './feedPage'

const row = (overrides: Partial<FeedRow>): FeedRow =>
  ({
    post_id: 'p1',
    author_kind: 'professional',
    professional_id: 'pro-1',
    professional_display_name: 'Sofiane B.',
    professional_handle: 'sofiane',
    professional_avatar_url: null,
    organization_id: null,
    organization_name: null,
    organization_slug: null,
    posted_at_organization_id: null,
    posted_at_organization_name: null,
    posted_at_organization_slug: null,
    caption: null,
    created_at: '2026-09-01T10:00:00+00:00',
    like_count: 0,
    liked_by_me: false,
    media: [],
    services: [],
    feed_source: 'discovery',
    score: 1,
    ...overrides,
  }) as FeedRow

describe('nextFeedCursor — le curseur est min(created_at), pas la dernière ligne', () => {
  it('prend le plus petit created_at même si la page est re-triée par score', () => {
    const page = [
      row({ post_id: 'a', created_at: '2026-09-03T10:00:00+00:00' }),
      row({ post_id: 'b', created_at: '2026-09-01T10:00:00+00:00' }),
      row({ post_id: 'c', created_at: '2026-09-02T10:00:00+00:00' }),
    ]
    expect(nextFeedCursor(page, 3)).toBe('2026-09-01T10:00:00+00:00')
  })

  it('page incomplète → null (plus rien à charger)', () => {
    expect(nextFeedCursor([row({})], FEED_PAGE_SIZE)).toBeNull()
    expect(nextFeedCursor([], FEED_PAGE_SIZE)).toBeNull()
  })
})

describe('dedupeFeedPages — défense de frontière par post_id', () => {
  it('un post présent sur deux pages ne sort qu’une fois', () => {
    const pages = [
      [row({ post_id: 'a' }), row({ post_id: 'b' })],
      [row({ post_id: 'b' }), row({ post_id: 'c' })],
    ]
    expect(dedupeFeedPages(pages).map((r) => r.post_id)).toEqual(['a', 'b', 'c'])
  })
})

describe('parseFeedMedia / parseFeedServices — jamais une fausse donnée', () => {
  it('ignore les entrées malformées, garde les champs typés', () => {
    const media = parseFeedMedia([
      { id: 'm1', storage_path: 'u/x.jpg', media_type: 'image', width: 100, height: 80, duration_ms: null, position: 0 },
      'junk',
      { id: 42 },
    ] as never)
    expect(media).toHaveLength(1)
    expect(media[0].storage_path).toBe('u/x.jpg')
  })

  it('services : is_active strictement booléen', () => {
    const services = parseFeedServices([
      { id: 's1', name: 'Fade', price_cents: 2500, duration_minutes: 30, is_active: true },
      { id: 's2', name: 'Off', price_cents: null, duration_minutes: null, is_active: 'yes' },
    ] as never)
    expect(services).toHaveLength(2)
    expect(services[0].is_active).toBe(true)
    expect(services[1].is_active).toBe(false)
    expect(services[1].price_cents).toBeNull()
  })
})

describe('bookTargetForPost — la seule justification du module', () => {
  it('post org + service actif → tunnel avec service prérempli', () => {
    const r = row({
      author_kind: 'organization',
      organization_slug: 'kings-barber',
      professional_display_name: null,
      professional_handle: null,
    })
    const target = bookTargetForPost(r, [
      { id: 's-off', name: 'x', price_cents: null, duration_minutes: null, is_active: false },
      { id: 's-on', name: 'Fade', price_cents: 2500, duration_minutes: 30, is_active: true },
    ])
    expect(target).toEqual({ slug: 'kings-barber', serviceId: 's-on' })
  })

  it('post pro : le salon est le posted_at FIGÉ', () => {
    const r = row({ posted_at_organization_slug: 'chez-marco' })
    const target = bookTargetForPost(r, [
      { id: 's1', name: 'Fade', price_cents: null, duration_minutes: null, is_active: true },
    ])
    expect(target?.slug).toBe('chez-marco')
  })

  it('sans salon attribuable ou sans service actif → AUCUN CTA (pas de bouton mort)', () => {
    expect(bookTargetForPost(row({}), [{ id: 's1', name: 'x', price_cents: null, duration_minutes: null, is_active: true }])).toBeNull()
    expect(bookTargetForPost(row({ posted_at_organization_slug: 'a' }), [])).toBeNull()
    expect(
      bookTargetForPost(row({ posted_at_organization_slug: 'a' }), [
        { id: 's1', name: 'x', price_cents: null, duration_minutes: null, is_active: false },
      ]),
    ).toBeNull()
  })
})

describe('auteur et attribution selon author_kind (contrat B4)', () => {
  it('professionnel : nom pro, route /pro, attribution posted_at', () => {
    const r = row({ posted_at_organization_name: 'Chez Marco', posted_at_organization_slug: 'chez-marco' })
    expect(feedAuthorName(r)).toBe('Sofiane B.')
    expect(feedAuthorRoute(r)).toBe('/pro/sofiane')
    expect(feedAttribution(r)).toEqual({ name: 'Chez Marco', slug: 'chez-marco' })
  })

  it('organisation : nom org, route /shop, pas d’attribution séparée', () => {
    const r = row({
      author_kind: 'organization',
      organization_name: 'Kings',
      organization_slug: 'kings',
      professional_display_name: null,
      professional_handle: null,
    })
    expect(feedAuthorName(r)).toBe('Kings')
    expect(feedAuthorRoute(r)).toBe('/shop/kings')
    expect(feedAttribution(r).name).toBeNull()
  })
})
