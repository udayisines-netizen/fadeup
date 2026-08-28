import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { changeLocale } from '@/i18n'
import {
  AvailabilityLabel,
  availabilityFrom,
  earliestSlot,
} from '@/components/ui/availability-label'

describe('earliestSlot', () => {
  it('returns the earliest instant, not the first element', () => {
    const slots = [
      { slotStart: '2026-09-01T16:00:00Z' },
      { slotStart: '2026-09-01T09:30:00Z' },
      { slotStart: '2026-09-01T11:00:00Z' },
    ]
    expect(earliestSlot(slots)?.slotStart).toBe('2026-09-01T09:30:00Z')
  })

  it('is null for an empty list', () => {
    expect(earliestSlot([])).toBeNull()
  })
})

describe('availabilityFrom', () => {
  it('is unknown — not "none" — before a service context exists', () => {
    // The distinction is the whole point: a shop card with no service chosen
    // has NOTHING to say about availability, and saying "nothing free today"
    // would be a claim the query was never asked to make.
    expect(
      availabilityFrom(undefined, 'Europe/Paris', { isPending: false, hasServiceContext: false }),
    ).toEqual({ status: 'unknown' })
  })

  it('stays unknown while pending only once a service context exists', () => {
    expect(
      availabilityFrom(undefined, 'Europe/Paris', { isPending: true, hasServiceContext: true }),
    ).toEqual({ status: 'pending' })
  })

  it('reports none for a resolved, fully-booked day', () => {
    expect(
      availabilityFrom([], 'Europe/Paris', { isPending: false, hasServiceContext: true }),
    ).toEqual({ status: 'none' })
  })

  it('refuses to print a time when the shop timezone did not resolve', () => {
    // Printing 17:30 in the reader's zone for a Tokyo salon is worse than
    // printing nothing, so a missing timezone degrades to "none".
    expect(
      availabilityFrom([{ slotStart: '2026-09-01T15:30:00Z' }], null, {
        isPending: false,
        hasServiceContext: true,
      }),
    ).toEqual({ status: 'none' })
  })

  it('resolves to the earliest slot with the business timezone attached', () => {
    expect(
      availabilityFrom(
        [{ slotStart: '2026-09-01T15:30:00Z' }, { slotStart: '2026-09-01T09:00:00Z' }],
        'Europe/Paris',
        { isPending: false, hasServiceContext: true },
      ),
    ).toEqual({ status: 'from', from: '2026-09-01T09:00:00Z', timeZone: 'Europe/Paris' })
  })
})

describe('AvailabilityLabel', () => {
  it('renders nothing when there is nothing honest to say', () => {
    const { container } = render(<AvailabilityLabel state={{ status: 'unknown' }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('says "From <time>" rather than a bare time, in the shop timezone', async () => {
    await changeLocale('en')
    render(
      <AvailabilityLabel state={{ status: 'from', from: '2026-09-01T15:30:00Z', timeZone: 'Europe/Paris' }} />,
    )
    // 15:30Z is 17:30 in Paris in September — written the way an English
    // reader writes a time. Both halves matter: the SHOP's zone decides the
    // instant, the READER's locale decides the notation.
    expect(screen.getByText(/From/)).toHaveTextContent('5:30 PM')
  })

  it('uses the canonical French phrasing', async () => {
    await changeLocale('fr')
    render(
      <AvailabilityLabel state={{ status: 'from', from: '2026-09-01T15:30:00Z', timeZone: 'Europe/Paris' }} />,
    )
    expect(screen.getByText(/À partir de/)).toHaveTextContent('17:30')
    await changeLocale('en')
  })

  it('states a fully-booked day plainly instead of rendering nothing', async () => {
    await changeLocale('en')
    render(<AvailabilityLabel state={{ status: 'none' }} />)
    expect(screen.getByText('Nothing free today')).toBeInTheDocument()
  })
})
