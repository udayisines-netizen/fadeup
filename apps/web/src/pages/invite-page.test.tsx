import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { InvitePage } from '@/pages/invite-page'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  getSupabaseClient: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockGetSupabaseClient = vi.mocked(getSupabaseClient)

interface InvitationRow {
  organization_name: string
  role: string
  email: string
  expires_at: string
  is_expired: boolean
  is_accepted: boolean
  is_revoked: boolean
}

function mockInvitationRpc(rows: InvitationRow[]) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  mockGetSupabaseClient.mockReturnValue({ rpc } as unknown as SupabaseClient)
  return rpc
}

function renderInvitePage(token = 'a-token') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/invite/${token}`]}>
        <Routes>
          <Route path="/invite/:token" element={<InvitePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function baseInvitation(overrides: Partial<InvitationRow>): InvitationRow {
  return {
    organization_name: 'Fade Up Barbers',
    role: 'barber',
    email: 'invitee@example.com',
    expires_at: '2999-01-01T00:00:00.000Z',
    is_expired: false,
    is_accepted: false,
    is_revoked: false,
    ...overrides,
  }
}

describe('InvitePage', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })
  })

  it('renders a not-found state for an unknown token', async () => {
    mockInvitationRpc([])

    renderInvitePage()

    expect(await screen.findByText('Invitation not found')).toBeInTheDocument()
  })

  it('renders an expired state', async () => {
    mockInvitationRpc([baseInvitation({ is_expired: true })])

    renderInvitePage()

    expect(await screen.findByText('Invitation expired')).toBeInTheDocument()
  })

  it('renders an already-accepted state', async () => {
    mockInvitationRpc([baseInvitation({ is_accepted: true })])

    renderInvitePage()

    expect(await screen.findByText('Already accepted')).toBeInTheDocument()
  })

  it('renders a revoked state', async () => {
    mockInvitationRpc([baseInvitation({ is_revoked: true })])

    renderInvitePage()

    expect(await screen.findByText('Invitation revoked')).toBeInTheDocument()
  })

  it('renders a valid pending invite with a sign-in/create-account prompt for signed-out visitors', async () => {
    mockInvitationRpc([baseInvitation({})])

    renderInvitePage()

    expect(await screen.findByText("You've been invited")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Create account' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).not.toBeInTheDocument()
  })

  it('sends an invited barber to ORDINARY auth, never to the new-business application', async () => {
    // The regression this guards: /invite/:token used to offer /pro/login and
    // /pro/signup, so accepting a job at an existing shop walked the barber
    // into a professional application — platform review, and potentially a
    // second organization of their own.
    mockInvitationRpc([baseInvitation({})])

    renderInvitePage()

    const signIn = await screen.findByRole('link', { name: 'Sign in' })
    const createAccount = screen.getByRole('link', { name: 'Create account' })

    expect(signIn).toHaveAttribute('href', expect.stringContaining('/login?redirect='))
    expect(createAccount).toHaveAttribute('href', expect.stringContaining('/register?redirect='))

    for (const link of [signIn, createAccount]) {
      expect(link.getAttribute('href')).not.toMatch(/^\/pro\//)
    }

    // Both carry the invitation back so the person returns here to accept.
    expect(signIn.getAttribute('href')).toContain(encodeURIComponent('/invite/'))
    expect(createAccount.getAttribute('href')).toContain(encodeURIComponent('/invite/'))
  })

  it('tells the invitee plainly that no new business is being created', async () => {
    mockInvitationRpc([baseInvitation({})])

    renderInvitePage()

    expect(
      await screen.findByText(/does not create a new business and needs no approval/i),
    ).toBeInTheDocument()
  })
})
