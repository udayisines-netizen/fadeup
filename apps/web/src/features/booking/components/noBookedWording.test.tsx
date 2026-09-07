import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { getI18n } from 'react-i18next'
import frBooking from '@/shared/i18n/locales/fr/booking.json'
import enBooking from '@/shared/i18n/locales/en/booking.json'
import frStates from '@/shared/i18n/locales/fr/states.json'
import enStates from '@/shared/i18n/locales/en/states.json'
import { BookingOutcome } from '@/features/booking/components/BookingOutcome'
import type { BookAppointmentResult } from '@/features/booking/api/booking'

/**
 * LA garde de langue de F4 (§3, §9) : jamais « Réservé » sur un `is_request`.
 *
 * B2 la fait tenir aux gabarits d'e-mails (verify_b2.sql §4) avec le motif
 * \m(réservé|reserve|booked|confirmé|confirmed)\M ; ce test applique la MÊME
 * rigueur à l'interface, à deux niveaux :
 *   1. le TEXTE RENDU de l'écran « demande envoyée » (fr ET en) ;
 *   2. les sections de copie qui alimentent toute surface de demande.
 *
 * Le motif borne les mots comme PostgreSQL (\m…\M) : « réserver »
 * (l'infinitif du geste) et « la demande n'a pas été confirmée » (la phrase
 * exigée par la spec) passent ; « Réservé », « Booked », « Confirmed »
 * échouent.
 */

const FORBIDDEN = /(^|[^\p{L}])(réservé|reserve|booked|confirmé|confirmed)(?![\p{L}])/iu

function forbiddenIn(text: string): string | null {
  const match = FORBIDDEN.exec(text)
  return match ? (match[2] ?? match[0]) : null
}

function collectStrings(node: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof node === 'string') {
    out.push({ path, value: node })
    return
  }
  if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) collectStrings(value, `${path}.${key}`, out)
  }
}

const REQUEST_RESULT: BookAppointmentResult = {
  id: '00000000-0000-4000-8000-000000000001',
  starts_at: new Date(Date.now() + 6 * 3_600_000).toISOString(),
  ends_at: new Date(Date.now() + 6.5 * 3_600_000).toISOString(),
  status: 'pending',
  is_request: true,
  expires_at: new Date(Date.now() + 4 * 3_600_000).toISOString(),
  claim_token: null,
}

const CONTEXT = {
  organizationId: '00000000-0000-4000-8000-000000000002',
  organizationName: 'Salon Test',
  organizationSlug: 'salon-test',
  serviceName: 'Coupe',
  barberName: 'Amine',
  priceCents: 2500,
  currency: 'EUR',
  timezone: 'Europe/Paris',
}

describe('garde de langue — jamais « Réservé » sur une demande', () => {
  const initialLanguage = getI18n().language

  afterEach(async () => {
    await getI18n().changeLanguage(initialLanguage)
  })

  it.each(['fr', 'en'])('l’écran « demande envoyée » rendu en %s ne contient aucun mot interdit', async (lng) => {
    await getI18n().changeLanguage(lng)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <BookingOutcome result={REQUEST_RESULT} context={CONTEXT} />
        </QueryClientProvider>
      </MemoryRouter>,
    )
    const text = container.textContent ?? ''
    expect(text.length).toBeGreaterThan(50)
    expect(forbiddenIn(text), `texte rendu (${lng}) : « ${forbiddenIn(text) ?? ''} »`).toBeNull()
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
    const sections: Array<[string, unknown]> = []
    for (const [lng, booking, states] of [
      ['fr', frBooking, frStates],
      ['en', enBooking, enStates],
    ] as const) {
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
        [`${lng}.states.booking.pendingRequest`, (states as { booking: { pendingRequest: string } }).booking.pendingRequest],
      )
    }
    const offenders: string[] = []
    for (const [path, node] of sections) {
      const strings: Array<{ path: string; value: string }> = []
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
