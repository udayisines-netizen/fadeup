import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { CustomerV2BarberProfilePage } from '@/customer-v2/profiles/barber-profile-page'

/**
 * The barber profile's product contract.
 *
 * The load-bearing rules: a claimed identity gets Follow and a follower count,
 * an UNCLAIMED one gets neither (there is no durable identity to follow, and
 * fabricating one is fabricating a social relationship); Book always carries
 * the barber and their location so the flow never asks again; and there is no
 * messaging control of any kind.
 */

const state: {
  barber: unknown
  identity: unknown
  user: { id: string } | null
} = {
  barber: null,
  identity: null,
  user: null,
}

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: null, user: state.user, loading: false }),
}))

vi.mock('@/lib/queries/public-booking', () => ({
  usePublicOrganization: () => ({
    data: { id: 'org-1', name: 'Side Agency', slug: 'side-agency', currency: 'EUR', countryCode: 'FR' },
  }),
}))

vi.mock('@/lib/queries/public-barber', () => ({
  usePublicBarber: () => ({ data: state.barber, isPending: false, isError: false, refetch: vi.fn() }),
  usePublicBarberServices: () => ({
    data: [{ id: 'svc-1', name: 'Classic cut', durationMinutes: 30, priceCents: 2500 }],
    isPending: false,
  }),
  usePublicProfessionalIdentity: () => ({ data: state.identity }),
}))

vi.mock('@/lib/queries/public-queue', () => ({
  usePublicQueueStatus: () => ({ data: [] }),
}))

vi.mock('@/lib/queries/follows', () => ({
  useMyFollowedProfessionals: () => ({ data: [] }),
  useFollowProfessional: () => ({ mutate: vi.fn(), isPending: false }),
  useUnfollowProfessional: () => ({ mutate: vi.fn(), isPending: false }),
}))

const CLAIMED = {
  barberId: 'barber-1',
  professionalId: 'pro-1',
  displayName: 'Barber Test',
  title: 'Senior barber',
  bio: null,
  avatarUrl: null,
  locationId: 'loc-1',
}

const IDENTITY = {
  id: 'pro-1',
  displayName: 'Barber Test',
  handle: 'barbertest',
  headline: 'Fades and tapers.',
  bio: null,
  avatarUrl: null,
  followerCount: 12,
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/_preview/r5r/s/side-agency/b/barber-1']}>
      <Routes>
        <Route path="/_preview/r5r/s/:slug/b/:barberId" element={<CustomerV2BarberProfilePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('a claimed identity is social', () => {
  it('shows handle, follower count, Follow — and Book carries barber and location', () => {
    state.barber = CLAIMED
    state.identity = IDENTITY
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: /Barber Test/ })).toBeInTheDocument()
    expect(screen.getByText('@barbertest')).toBeInTheDocument()
    expect(screen.getByText('12 followers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Book' })).toHaveAttribute(
      'href',
      '/_preview/r5r/s/side-agency/book?location=loc-1&barber=barber-1',
    )

    // Working at → the establishment, as a real link.
    expect(screen.getByRole('link', { name: 'Side Agency' })).toBeInTheDocument()
  })

  it('offers no messaging control of any kind', () => {
    state.barber = CLAIMED
    state.identity = IDENTITY
    renderPage()

    expect(screen.queryByText(/message/i)).not.toBeInTheDocument()
  })
})

describe('an unclaimed placement is not a social identity', () => {
  it('renders no Follow, no handle and no follower count', () => {
    state.barber = { ...CLAIMED, professionalId: null }
    state.identity = null
    renderPage()

    expect(screen.queryByRole('button', { name: 'Follow' })).not.toBeInTheDocument()
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    expect(screen.queryByText(/follower/)).not.toBeInTheDocument()
    // Booking the placement stays possible — bookability is operational,
    // not social.
    expect(screen.getByRole('link', { name: 'Book' })).toBeInTheDocument()
  })
})

describe('a hidden or unknown barber discloses nothing', () => {
  it('shows one indistinguishable not-found state', () => {
    state.barber = null
    state.identity = null
    renderPage()

    expect(screen.getByRole('heading', { name: 'No one is listed here' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Book' })).not.toBeInTheDocument()
  })
})
