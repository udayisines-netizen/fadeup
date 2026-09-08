import { describe, expect, it } from 'vitest'

import frBooking from '@/shared/i18n/locales/fr/booking.json'
import enBooking from '@/shared/i18n/locales/en/booking.json'
import frStates from '@/shared/i18n/locales/fr/states.json'
import enStates from '@/shared/i18n/locales/en/states.json'
import frMobile from '@/shared/i18n/locales/fr/mobile.json'
import enMobile from '@/shared/i18n/locales/en/mobile.json'
import { requestSentCopy, requestSentStrings, type Translate } from '@/features/booking/lib/requestCopy'

/**
 * LA garde de langue de F4 (§3, §9), en natif : jamais « Réservé » sur un
 * `is_request`.
 *
 * B2 la fait tenir aux gabarits d'e-mails (verify_b2.sql §4) avec le motif
 * \m(réservé|reserve|booked|confirmé|confirmed)\M ; le web l'applique au
 * TEXTE RENDU de l'écran « demande envoyée » (noBookedWording.test.tsx).
 * Ici la même rigueur s'applique au module qui ASSEMBLE ce texte — et le
 * composant `BookingOutcome` ne rend rien d'autre que sa sortie, donc le
 * test porte bien sur le texte réellement affiché.
 *
 * Trois niveaux, comme le web :
 *   1. la sortie complète du module, en fr ET en, dans les DEUX états
 *      (en attente, expirée) ;
 *   2. le motif lui-même, dans les deux sens ;
 *   3. les mêmes 15 sections de copie que le web, en fr ET en.
 */

const FORBIDDEN = /(^|[^\p{L}])(réservé|reserve|booked|confirmé|confirmed)(?![\p{L}])/iu

function forbiddenIn(text: string): string | null {
  const match = FORBIDDEN.exec(text)
  return match ? (match[2] ?? match[0]) : null
}

function collectStrings(node: unknown, path: string, out: { path: string; value: string }[]): void {
  if (typeof node === 'string') {
    out.push({ path, value: node })
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectStrings(value, `${path}.${key}`, out)
  }
}

/**
 * Un `t` minimal sur les catalogues RÉELS : `booking.request.title` se lit
 * dans booking.json, `states.booking.pendingRequest` dans states.json,
 * `mobile.bookingx.*` dans mobile.json — exactement le découpage que
 * `initI18n` monte sous l'espace de noms `v2`.
 */
function makeTranslate(bundle: Record<string, unknown>): Translate {
  return (key, params) => {
    const parts = key.split('.')
    let node: unknown = bundle
    for (const part of parts) {
      if (typeof node !== 'object' || node === null) {
        throw new Error(`clé i18n absente : ${key}`)
      }
      node = (node as Record<string, unknown>)[part]
    }
    if (typeof node !== 'string') throw new Error(`clé i18n absente ou non textuelle : ${key}`)
    return node.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = params?.[name]
      if (value === undefined) throw new Error(`interpolation manquante : ${key} → {{${name}}}`)
      return String(value)
    })
  }
}

const BUNDLES = {
  fr: { booking: frBooking, states: frStates, mobile: frMobile },
  en: { booking: enBooking, states: enStates, mobile: enMobile },
} as const

const LANGUAGES = ['fr', 'en'] as const

describe('garde de langue — jamais « Réservé » sur une demande', () => {
  it.each(LANGUAGES)('la copie « demande envoyée » (%s) ne contient aucun mot interdit', (lng) => {
    const t = makeTranslate(BUNDLES[lng])

    // Les DEUX états de l'écran : l'attente, puis l'expiration.
    const pending = requestSentCopy({
      t,
      expired: false,
      deadlineAbsolute: '12 sept. 2026, 18:30',
      remaining: { hours: 3, minutes: 42 },
      hasBarber: true,
      hasPrice: true,
    })
    const expired = requestSentCopy({
      t,
      expired: true,
      deadlineAbsolute: '12 sept. 2026, 18:30',
      remaining: null,
      hasBarber: true,
      hasPrice: true,
    })

    const strings = [...requestSentStrings(pending), ...requestSentStrings(expired)]
    // Le module doit avoir VRAIMENT produit un écran, pas trois mots.
    expect(strings.length).toBeGreaterThanOrEqual(20)
    expect(strings.join(' ').length).toBeGreaterThan(50)

    const offenders: string[] = []
    for (const value of strings) {
      // Aucune clé non résolue ne doit passer pour du texte.
      expect(value).not.toMatch(/\{\{/)
      const hit = forbiddenIn(value)
      if (hit) offenders.push(`« ${hit} » dans « ${value} »`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('l’écran en attente porte le badge d’attente, l’écran expiré ne le porte plus', () => {
    const t = makeTranslate(BUNDLES.fr)
    const pending = requestSentCopy({
      t,
      expired: false,
      deadlineAbsolute: 'X',
      remaining: { hours: 0, minutes: 12 },
      hasBarber: false,
      hasPrice: false,
    })
    expect(pending.badgeLabel).toBe(frStates.booking.pendingRequest)
    expect(pending.countdown).toBe('Expire dans 12 min')
    expect(pending.expiredCallFirstTitle).toBeNull()
    expect(pending.recapProfessionalLabel).toBeNull()
    expect(pending.recapPriceLabel).toBeNull()

    const expired = requestSentCopy({
      t,
      expired: true,
      deadlineAbsolute: 'X',
      remaining: null,
      hasBarber: true,
      hasPrice: true,
    })
    expect(expired.badgeLabel).toBeNull()
    expect(expired.countdown).toBeNull()
    expect(expired.deadlineValue).toBeNull()
    // Appeler d'abord — et le texte reconnaît qu'aucun numéro n'est publié.
    expect(expired.expiredCallFirstTitle).toBe(frMobile.bookingx.expiredCallFirst)
    expect(expired.expiredCallFirstBody).toBe(frMobile.bookingx.expiredCallFirstBody)
  })

  it('le motif borne les mots comme verify_b2 : « réserver » passe, « Réservé » échoue', () => {
    expect(forbiddenIn('Réserver à nouveau')).toBeNull()
    expect(forbiddenIn("La demande n'a pas été confirmée à temps")).toBeNull()
    expect(forbiddenIn('Confirmer la réservation')).toBeNull()
    expect(forbiddenIn('Réservé')).toBe('Réservé')
    expect(forbiddenIn('Your slot is booked!')).toBe('booked')
    expect(forbiddenIn('Request confirmed')).toBe('confirmed')
  })

  it('AUCUNE copie des surfaces de demande ne contient un mot interdit (fr et en)', () => {
    const sections: [string, unknown][] = []
    for (const lng of LANGUAGES) {
      const booking = BUNDLES[lng].booking
      const states = BUNDLES[lng].states
      sections.push(
        [`${lng}.booking.request`, booking.request],
        [`${lng}.booking.interest`, booking.interest],
        [`${lng}.booking.interestRefusal`, booking.interestRefusal],
        [`${lng}.booking.summary.sendRequest`, booking.summary.sendRequest],
        [`${lng}.booking.summary.requestNotice`, booking.summary.requestNotice],
        [`${lng}.booking.bookings.sectionRequests`, booking.bookings.sectionRequests],
        [`${lng}.booking.bookings.requestRow`, booking.bookings.requestRow],
        [`${lng}.booking.bookings.requestDetailsTitle`, booking.bookings.requestDetailsTitle],
        [`${lng}.booking.bookings.cancelRequest`, booking.bookings.cancelRequest],
        [`${lng}.booking.bookings.cancelRequestTitle`, booking.bookings.cancelRequestTitle],
        [`${lng}.booking.bookings.cancelRequestBody`, booking.bookings.cancelRequestBody],
        [`${lng}.booking.bookings.interestPending`, booking.bookings.interestPending],
        [`${lng}.booking.bookings.interestExpired`, booking.bookings.interestExpired],
        [`${lng}.booking.bookings.resolutionExpired`, booking.bookings.resolutionExpired],
        // Le badge que TOUTE surface de demande porte (P1 §14).
        [`${lng}.states.booking.pendingRequest`, states.booking.pendingRequest],
      )
    }

    const offenders: string[] = []
    for (const [path, node] of sections) {
      const strings: { path: string; value: string }[] = []
      collectStrings(node, path, strings)
      expect(strings.length, `${path} doit exister`).toBeGreaterThan(0)
      for (const { path: keyPath, value } of strings) {
        const hit = forbiddenIn(value)
        if (hit) offenders.push(`${keyPath} → « ${hit} » dans « ${value} »`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
