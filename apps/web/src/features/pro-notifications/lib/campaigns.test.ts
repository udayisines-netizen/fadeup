import { describe, expect, it } from 'vitest'
import {
  atCap,
  canSend,
  CAMPAIGN_KINDS,
  clampThreshold,
  HEADLINE_MAX,
  kindNeedsOffer,
  kindNeedsService,
  kindNeedsThreshold,
  OFFER_MAX,
  parseCampaignRefusal,
  promotionBounds,
  remainingSends,
  suppressionLines,
  THRESHOLD_MAX_DAYS,
  THRESHOLD_MIN_DAYS,
  validateCampaignText,
  type Preview,
} from '@/features/pro-notifications/lib/campaigns'

const preview = (overrides: Partial<Preview> = {}): Preview => ({
  eligible_count: 10,
  reachable_count: 7,
  no_email_count: 0,
  do_not_contact_count: 0,
  frequency_capped_count: 0,
  verified_count: 3,
  deferred: false,
  scheduled_at: '2026-09-12T10:00:00.000Z',
  slot_count: null,
  slot_date: null,
  ...overrides,
})

describe('les quatre modèles, et leurs champs', () => {
  it('il y en a exactement quatre', () => {
    expect(CAMPAIGN_KINDS).toEqual(['lapsed_customers', 'free_slots_tomorrow', 'promotion', 'loyalty_reminder'])
  })

  it('chaque modèle demande ce qu’il lui faut, et rien de plus', () => {
    expect(kindNeedsThreshold('lapsed_customers')).toBe(true)
    expect(kindNeedsThreshold('promotion')).toBe(false)
    expect(kindNeedsService('free_slots_tomorrow')).toBe(true)
    expect(kindNeedsService('lapsed_customers')).toBe(false)
    expect(kindNeedsOffer('promotion')).toBe(true)
    expect(kindNeedsOffer('loyalty_reminder')).toBe(false)
  })

  it('le rappel de fidélité ne demande RIEN d’autre que l’accroche', () => {
    expect(kindNeedsThreshold('loyalty_reminder')).toBe(false)
    expect(kindNeedsService('loyalty_reminder')).toBe(false)
    expect(kindNeedsOffer('loyalty_reminder')).toBe(false)
  })
})

describe('validateCampaignText — le miroir de private.assert_campaign_text', () => {
  it('refuse le vide et les blancs seuls', () => {
    expect(validateCampaignText('', HEADLINE_MAX)).toBe('missing')
    expect(validateCampaignText('   ', HEADLINE_MAX)).toBe('missing')
  })

  it('refuse au-delà de la borne, et accepte pile à la borne', () => {
    expect(validateCampaignText('a'.repeat(HEADLINE_MAX + 1), HEADLINE_MAX)).toBe('tooLong')
    expect(validateCampaignText('a'.repeat(HEADLINE_MAX), HEADLINE_MAX)).toBeNull()
    expect(validateCampaignText('a'.repeat(OFFER_MAX + 1), OFFER_MAX)).toBe('tooLong')
  })

  it('refuse le multiligne — c’est ce qui distingue une accroche d’un e-mail libre', () => {
    expect(validateCampaignText('deux\nlignes', HEADLINE_MAX)).toBe('multiline')
    expect(validateCampaignText('avec\ttab', HEADLINE_MAX)).toBe('multiline')
  })

  it('refuse toute forme de lien', () => {
    expect(validateCampaignText('venez sur https://ailleurs.example', HEADLINE_MAX)).toBe('link')
    expect(validateCampaignText('www.ailleurs.fr', HEADLINE_MAX)).toBe('link')
    expect(validateCampaignText('voir ailleurs.com', HEADLINE_MAX)).toBe('link')
  })

  it('refuse les jetons de gabarit', () => {
    expect(validateCampaignText('bonjour {{unsubscribe_url}}', HEADLINE_MAX)).toBe('templateToken')
    expect(validateCampaignText('fin }}', HEADLINE_MAX)).toBe('templateToken')
  })

  it('accepte une vraie accroche, accents et ponctuation compris', () => {
    expect(validateCampaignText('Ça fait un moment — on vous remet en forme ?', HEADLINE_MAX)).toBeNull()
    expect(validateCampaignText('−10 % sur la coupe', OFFER_MAX)).toBeNull()
  })
})

describe('le plafond restant', () => {
  it('rend null pour un plan illimité — jamais un grand nombre', () => {
    expect(remainingSends({ used: 42, monthly_allowance: null })).toBeNull()
  })

  it('rend ce qui reste, et jamais un négatif', () => {
    expect(remainingSends({ used: 1, monthly_allowance: 3 })).toBe(2)
    expect(remainingSends({ used: 3, monthly_allowance: 3 })).toBe(0)
    expect(remainingSends({ used: 7, monthly_allowance: 3 })).toBe(0)
  })

  it('atCap suit la même règle, et un plan illimité n’est jamais au plafond', () => {
    expect(atCap({ used: 2, monthly_allowance: 3 })).toBe(false)
    expect(atCap({ used: 3, monthly_allowance: 3 })).toBe(true)
    expect(atCap({ used: 4, monthly_allowance: 3 })).toBe(true)
    expect(atCap({ used: 9999, monthly_allowance: null })).toBe(false)
    expect(atCap(null)).toBe(false)
  })
})

describe('clampThreshold', () => {
  it('borne entre 14 et 365, comme l’audience SQL', () => {
    expect(clampThreshold(1)).toBe(THRESHOLD_MIN_DAYS)
    expect(clampThreshold(900)).toBe(THRESHOLD_MAX_DAYS)
    expect(clampThreshold(60)).toBe(60)
    expect(clampThreshold(30.7)).toBe(31)
  })

  it('retombe sur le défaut pour une saisie vide ou absurde', () => {
    expect(clampThreshold(Number.NaN)).toBe(60)
    expect(clampThreshold(Number.POSITIVE_INFINITY)).toBe(60)
  })
})

describe('parseCampaignRefusal', () => {
  it('lit le motif nommé, pas le message', () => {
    expect(parseCampaignRefusal({ details: 'fadeup_campaign_refusal=allowance_reached' })).toBe('allowance_reached')
    expect(parseCampaignRefusal({ details: 'fadeup_campaign_refusal=no_free_slot' })).toBe('no_free_slot')
  })

  it('rend null quand il n’y a pas de motif', () => {
    expect(parseCampaignRefusal({ details: 'quelque chose' })).toBeNull()
    expect(parseCampaignRefusal({})).toBeNull()
    expect(parseCampaignRefusal(null)).toBeNull()
    expect(parseCampaignRefusal(new Error('boom'))).toBeNull()
  })
})

describe('suppressionLines — « 0 désabonné » est du bruit', () => {
  it('ne rend que les exclusions non nulles, dans l’ordre', () => {
    expect(suppressionLines(preview())).toEqual([])
    expect(
      suppressionLines(preview({ no_email_count: 3, do_not_contact_count: 0, frequency_capped_count: 1 })),
    ).toEqual([
      { reason: 'noEmail', count: 3 },
      { reason: 'frequency', count: 1 },
    ])
  })
})

describe('canSend', () => {
  it('refuse au plafond, même avec des destinataires', () => {
    expect(canSend(preview(), { used: 3, monthly_allowance: 3, remaining: 0 })).toBe(false)
  })

  it('refuse sans destinataire joignable, même sous le plafond', () => {
    expect(canSend(preview({ reachable_count: 0 }), { used: 0, monthly_allowance: 3, remaining: 3 })).toBe(false)
  })

  it('refuse sans aperçu', () => {
    expect(canSend(null, { used: 0, monthly_allowance: 3, remaining: 3 })).toBe(false)
  })

  it('accepte sous le plafond avec au moins un destinataire', () => {
    expect(canSend(preview(), { used: 0, monthly_allowance: 3, remaining: 3 })).toBe(true)
    expect(canSend(preview(), { used: 99, monthly_allowance: null, remaining: null })).toBe(true)
  })
})

describe('promotionBounds', () => {
  it('borne aujourd’hui et 180 jours, comme la base', () => {
    const bounds = promotionBounds(new Date('2026-09-12T10:00:00.000Z'))
    expect(bounds.min).toBe('2026-09-12')
    expect(bounds.max).toBe('2027-03-11')
  })
})
