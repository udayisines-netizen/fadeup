import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  SERVICE_MODES,
  availableDurations,
  closingHoursToday,
  deriveCustomerCtas,
  durationLabelKey,
  modeLabelKey,
  modeSourceKey,
  resolveDurationToExpiry,
  type PublicServiceState,
  type ServiceMode,
  type ServiceModeSource,
} from '@/lib/queries/service-mode'
import { SUPPORTED_LOCALES } from '@/lib/locale'

/**
 * The DERIVATION, not the markup.
 *
 * A test that renders a button and asserts it says "Book" proves the locale
 * file has a key in it. What actually breaks a customer is the derivation
 * disagreeing with the server: a Book button offered when the trigger would
 * refuse the insert, or a queue CTA hidden while the shop is genuinely taking
 * walk-ins. So these exercise the functions that decide, and the timezone
 * arithmetic that turns a tapped duration into the instant the backend stores.
 */

function state(overrides: Partial<PublicServiceState> = {}): PublicServiceState {
  return {
    locationId: 'loc-1',
    barberId: null,
    effectiveServiceMode: 'hybrid',
    modeSource: 'location_default',
    modeExpiresAt: null,
    modeAllowsBooking: true,
    modeAllowsQueue: true,
    queueOpen: true,
    queueAcceptingNewEntries: true,
    bookingAcceptingNewEntries: true,
    ...overrides,
  }
}

describe('customer CTA derivation', () => {
  it('offers both actions when the shop accepts both', () => {
    expect(deriveCustomerCtas(state())).toEqual({ book: true, joinQueue: true, queueClosed: false })
  })

  it('offers nothing at all when there is no state — an unknown or private shop', () => {
    // The RPC returns zero rows indistinguishably for an unknown slug, a
    // foreign tenant and an inactive location. All of them must produce a page
    // with no actions rather than a page that guesses.
    expect(deriveCustomerCtas(null)).toEqual({ book: false, joinQueue: false, queueClosed: false })
    expect(deriveCustomerCtas(undefined)).toEqual({
      book: false,
      joinQueue: false,
      queueClosed: false,
    })
  })

  it('follows the SERVER, not the mode, when the two could disagree', () => {
    // The sharpest case in this file. The mode allows booking, but the
    // organization is not entitled to it, so the server says no. If the UI
    // derived from `modeAllowsBooking` it would offer a button that fails on
    // tap — which is exactly the drift this whole contract exists to prevent.
    const unentitled = state({ modeAllowsBooking: true, bookingAcceptingNewEntries: false })
    expect(deriveCustomerCtas(unentitled).book).toBe(false)
  })

  describe('reservation_only', () => {
    const reservationOnly = state({
      effectiveServiceMode: 'reservation_only',
      modeAllowsBooking: true,
      modeAllowsQueue: false,
      queueAcceptingNewEntries: false,
    })

    it('offers Book and never an actionable Join Queue', () => {
      const ctas = deriveCustomerCtas(reservationOnly)
      expect(ctas.book).toBe(true)
      expect(ctas.joinQueue).toBe(false)
    })

    it('does NOT say "queue temporarily closed" — the queue is not on offer at all', () => {
      // Saying "closed for now" would promise a return that is not coming. The
      // distinction between "shut for ten minutes" and "not something we do"
      // is the whole reason queueClosed keys off modeAllowsQueue.
      expect(deriveCustomerCtas({ ...reservationOnly, queueOpen: false }).queueClosed).toBe(false)
    })
  })

  describe('queue_only', () => {
    const queueOnly = state({
      effectiveServiceMode: 'queue_only',
      modeAllowsBooking: false,
      modeAllowsQueue: true,
      bookingAcceptingNewEntries: false,
    })

    it('offers Join Queue and never an actionable Book', () => {
      const ctas = deriveCustomerCtas(queueOnly)
      expect(ctas.joinQueue).toBe(true)
      expect(ctas.book).toBe(false)
    })

    it('shows a non-actionable "closed for now" when queue_open is false', () => {
      const closed = deriveCustomerCtas({
        ...queueOnly,
        queueOpen: false,
        queueAcceptingNewEntries: false,
      })
      expect(closed.joinQueue).toBe(false)
      expect(closed.queueClosed).toBe(true)
    })
  })

  describe('unavailable', () => {
    it('offers no operational action and no "come back later" either', () => {
      const ctas = deriveCustomerCtas(
        state({
          effectiveServiceMode: 'unavailable',
          modeAllowsBooking: false,
          modeAllowsQueue: false,
          bookingAcceptingNewEntries: false,
          queueAcceptingNewEntries: false,
        }),
      )
      expect(ctas).toEqual({ book: false, joinQueue: false, queueClosed: false })
    })
  })

  it('queue_open alone flips the queue CTA and leaves booking untouched', () => {
    // §22: the two facts are independent, and this is where a customer meets
    // that. A shop pausing the line must not lose its Book button.
    const open = state()
    const closed = state({ queueOpen: false, queueAcceptingNewEntries: false })

    expect(deriveCustomerCtas(open).joinQueue).toBe(true)
    expect(deriveCustomerCtas(closed).joinQueue).toBe(false)
    expect(deriveCustomerCtas(closed).queueClosed).toBe(true)
    expect(deriveCustomerCtas(closed).book).toBe(true)
  })
})

describe('duration resolution', () => {
  // A Tuesday in winter, so the "today" case is not sitting on a DST boundary
  // by accident. 14:00 UTC is 15:00 in Paris.
  const now = new Date('2026-01-13T14:00:00.000Z')
  const paris = 'Europe/Paris'

  it('resolves relative durations from the current instant', () => {
    expect(resolveDurationToExpiry('30m', paris, now)).toBe('2026-01-13T14:30:00.000Z')
    expect(resolveDurationToExpiry('1h', paris, now)).toBe('2026-01-13T15:00:00.000Z')
  })

  it('"until manually changed" is null, which is a real state and not a failure', () => {
    expect(resolveDurationToExpiry('manual', paris, now)).toBeNull()
  })

  it("resolves 'today' to the ESTABLISHMENT's midnight, not the browser's", () => {
    // Paris is UTC+1 in January, so the shop's midnight is 23:00 UTC. A naive
    // implementation using the browser's clock would produce 00:00 UTC and
    // expire the override an hour early for every French shop, every day.
    expect(resolveDurationToExpiry('today', paris, now)).toBe('2026-01-13T23:00:00.000Z')
  })

  it("resolves 'today' differently for a different establishment timezone", () => {
    // Same instant, same call, different shop: the answer must move. This is
    // the assertion that would fail if the timezone argument were ignored.
    expect(resolveDurationToExpiry('today', 'UTC', now)).toBe('2026-01-14T00:00:00.000Z')
    expect(resolveDurationToExpiry('today', 'America/New_York', now)).toBe(
      '2026-01-14T05:00:00.000Z',
    )
  })

  it("resolves 'until closing' against the shop's own clock", () => {
    const closing = { closeTime: '19:00', isClosed: false }
    // 19:00 in Paris in January is 18:00 UTC.
    expect(resolveDurationToExpiry('until_closing', paris, now, closing)).toBe(
      '2026-01-13T18:00:00.000Z',
    )
  })

  it('accepts a seconds-precision closing time, which is how Postgres returns one', () => {
    expect(
      resolveDurationToExpiry('until_closing', paris, now, {
        closeTime: '19:00:00',
        isClosed: false,
      }),
    ).toBe('2026-01-13T18:00:00.000Z')
  })

  it('REFUSES to invent a closing time when the shop has not recorded one', () => {
    // §11 is explicit: if reliable hours do not exist, the option is deferred
    // rather than guessed. Returning null is how that reaches the UI.
    expect(resolveDurationToExpiry('until_closing', paris, now, null)).toBeNull()
    expect(resolveDurationToExpiry('until_closing', paris, now, undefined)).toBeNull()
    expect(
      resolveDurationToExpiry('until_closing', paris, now, { closeTime: null, isClosed: false }),
    ).toBeNull()
  })

  it('refuses "until closing" on a day the shop is closed', () => {
    expect(
      resolveDurationToExpiry('until_closing', paris, now, { closeTime: '19:00', isClosed: true }),
    ).toBeNull()
  })

  it('refuses a closing time that has ALREADY passed', () => {
    // An override ending in the past would be inert the moment it was written,
    // and the backend refuses it with 22023. Better never to offer it.
    const evening = new Date('2026-01-13T20:00:00.000Z') // 21:00 in Paris
    expect(
      resolveDurationToExpiry('until_closing', paris, evening, {
        closeTime: '19:00',
        isClosed: false,
      }),
    ).toBeNull()
  })

  it('rejects a malformed closing time rather than producing a wrong instant', () => {
    expect(
      resolveDurationToExpiry('until_closing', paris, now, {
        closeTime: 'nonsense',
        isClosed: false,
      }),
    ).toBeNull()
    expect(
      resolveDurationToExpiry('until_closing', paris, now, { closeTime: '99:99', isClosed: false }),
    ).toBeNull()
  })
})

describe('available durations', () => {
  const now = new Date('2026-01-13T14:00:00.000Z')

  it('hides "until closing" when it cannot be resolved honestly', () => {
    const options = availableDurations('Europe/Paris', now, null)
    expect(options).not.toContain('until_closing')
    // Everything else stays: losing one option must not lose the others.
    expect(options).toEqual(['30m', '1h', 'today', 'manual'])
  })

  it("offers 'until closing' when today's hours genuinely provide one", () => {
    const options = availableDurations('Europe/Paris', now, { closeTime: '19:00', isClosed: false })
    expect(options).toContain('until_closing')
    expect(options).toHaveLength(5)
  })
})

describe('closing hours for today', () => {
  const paris = 'Europe/Paris'
  // 2026-01-13 is a Tuesday; Postgres dow for Tuesday is 2. The instant is
  // passed in rather than stubbed onto Date.now, because every function under
  // test takes `now` as an argument — a helper that reads the global clock
  // instead of its parameter is exactly the bug these tests caught.
  const now = new Date('2026-01-13T14:00:00.000Z')

  it("picks today's row for the establishment", () => {
    const result = closingHoursToday(
      [
        { locationId: 'loc-1', dayOfWeek: 1, isClosed: false, closeTime: '17:00' },
        { locationId: 'loc-1', dayOfWeek: 2, isClosed: false, closeTime: '19:00' },
      ],
      'loc-1',
      paris,
      now,
    )
    expect(result).toEqual({ closeTime: '19:00', isClosed: false })
  })

  it('prefers the SECOND closing time, for a shop that shuts over lunch', () => {
    // "Until closing" means the end of the working day, not the start of the
    // break — otherwise a lunchtime override would expire at noon.
    const result = closingHoursToday(
      [
        {
          locationId: 'loc-1',
          dayOfWeek: 2,
          isClosed: false,
          closeTime: '12:00',
          secondCloseTime: '19:00',
        },
      ],
      'loc-1',
      paris,
      now,
    )
    expect(result?.closeTime).toBe('19:00')
  })

  it('reads the day in the ESTABLISHMENT\'s timezone, not the runner\'s', () => {
    // 23:30 UTC on the Tuesday is already Wednesday in Tokyo. A shop open
    // Wednesday and closed Tuesday must get its Wednesday row.
    const lateEvening = new Date('2026-01-13T23:30:00.000Z')
    const hours = [
      { locationId: 'loc-1', dayOfWeek: 2, isClosed: true, closeTime: null },
      { locationId: 'loc-1', dayOfWeek: 3, isClosed: false, closeTime: '19:00' },
    ]
    expect(closingHoursToday(hours, 'loc-1', 'Asia/Tokyo', lateEvening)).toEqual({
      closeTime: '19:00',
      isClosed: false,
    })
    expect(closingHoursToday(hours, 'loc-1', 'UTC', lateEvening)).toEqual({
      closeTime: null,
      isClosed: true,
    })
  })

  it('treats a day with no row as closed, matching the database convention', () => {
    expect(closingHoursToday([], 'loc-1', paris, now)).toEqual({ closeTime: null, isClosed: true })
  })

  it("ignores another establishment's hours", () => {
    const result = closingHoursToday(
      [{ locationId: 'loc-2', dayOfWeek: 2, isClosed: false, closeTime: '19:00' }],
      'loc-1',
      paris,
      now,
    )
    expect(result).toEqual({ closeTime: null, isClosed: true })
  })
})

describe('localization', () => {
  const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'locales')

  function namespaceFor(locale: string, file: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), 'utf8'))
  }

  function lookup(source: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce<unknown>((value, part) => {
      if (value && typeof value === 'object') return (value as Record<string, unknown>)[part]
      return undefined
    }, source)
  }

  it('has a label for every service mode, in EVERY locale', () => {
    // A missing key here is a mode rendering as the raw string
    // "serviceMode.mode.queueOnly" on a professional's phone.
    for (const locale of SUPPORTED_LOCALES) {
      const ns = namespaceFor(locale, 'app.json')
      for (const mode of SERVICE_MODES) {
        expect(lookup(ns, modeLabelKey(mode)), `${locale} is missing ${modeLabelKey(mode)}`).toBeTypeOf(
          'string',
        )
      }
    }
  })

  it('has a provenance sentence for every mode source, in EVERY locale', () => {
    const sources: ServiceModeSource[] = [
      'barber_temporary_override',
      'location_temporary_override',
      'barber_override',
      'location_default',
    ]
    for (const locale of SUPPORTED_LOCALES) {
      const ns = namespaceFor(locale, 'app.json')
      for (const source of sources) {
        expect(lookup(ns, modeSourceKey(source)), `${locale} is missing ${source}`).toBeTypeOf(
          'string',
        )
      }
    }
  })

  it('has a label for every duration option, in EVERY locale', () => {
    for (const locale of SUPPORTED_LOCALES) {
      const ns = namespaceFor(locale, 'app.json')
      for (const duration of ['30m', '1h', 'today', 'until_closing', 'manual'] as const) {
        expect(lookup(ns, durationLabelKey(duration)), `${locale} is missing ${duration}`).toBeTypeOf(
          'string',
        )
      }
    }
  })

  it('has per-mode help text keyed by the ENUM value the component interpolates', () => {
    // The component builds `serviceMode.help.${mode}` from the raw enum, so
    // these keys must match SERVICE_MODES exactly.
    for (const locale of SUPPORTED_LOCALES) {
      const ns = namespaceFor(locale, 'app.json')
      for (const mode of SERVICE_MODES) {
        expect(lookup(ns, `serviceMode.help.${mode}`), `${locale} help.${mode}`).toBeTypeOf('string')
      }
    }
  })

  it('never renders an internal enum value to a professional', () => {
    // §26: "Avoid exposing internal enum values to users." A translation that
    // said "queue_only" would satisfy every check above and still be wrong.
    for (const locale of SUPPORTED_LOCALES) {
      const ns = namespaceFor(locale, 'app.json')
      for (const mode of SERVICE_MODES) {
        expect(lookup(ns, modeLabelKey(mode))).not.toBe(mode)
      }
    }
  })

  it('gives the CUSTOMER surface its own copy, in every locale', () => {
    // Deliberately in the `booking` namespace, not `app`: a signed-out visitor
    // must never have to load the professional workspace bundle to find out
    // whether they can join a queue.
    const keys = [
      'serviceMode.book',
      'serviceMode.joinQueue',
      'serviceMode.queueClosedTitle',
      'serviceMode.queueClosedBody',
      'serviceMode.notAcceptingTitle',
      'serviceMode.notAcceptingBody',
      'serviceMode.bookingClosedTitle',
      'serviceMode.bookingClosedBody',
    ]
    for (const locale of SUPPORTED_LOCALES) {
      const ns = namespaceFor(locale, 'booking.json')
      for (const key of keys) {
        expect(lookup(ns, key), `${locale}/booking.json is missing ${key}`).toBeTypeOf('string')
      }
    }
  })

  it('keeps the English label map exhaustive against the type', () => {
    // Compile-time exhaustiveness is enforced by the Record<> in modeLabelKey;
    // this is the runtime half — that the keys it names actually exist.
    const ns = namespaceFor('en', 'app.json')
    const modes = lookup(ns, 'serviceMode.mode') as Record<string, string>
    expect(Object.keys(modes)).toHaveLength(SERVICE_MODES.length)
  })

  it('never says "barbier" in French, per the FadeUp vocabulary', () => {
    // terminology.test.ts already sweeps every file; this states the rule at
    // the point where a translator would most plausibly reach for it.
    const app = JSON.stringify(namespaceFor('fr', 'app.json').serviceMode)
    const booking = JSON.stringify(namespaceFor('fr', 'booking.json').serviceMode)
    expect(app).not.toMatch(/barbier/i)
    expect(booking).not.toMatch(/barbier/i)
  })
})

describe('the mode type itself', () => {
  it('has exactly the four canonical modes, in the database order', () => {
    // If a fifth mode is ever added, this fails first and points at every
    // Record<ServiceMode, …> that needs a new entry.
    const expected: ServiceMode[] = ['hybrid', 'reservation_only', 'queue_only', 'unavailable']
    expect([...SERVICE_MODES]).toEqual(expected)
  })
})
