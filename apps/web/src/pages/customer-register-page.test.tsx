import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerRegisterPage } from '@/pages/customer-register-page'
import { CustomerLoginPage } from '@/pages/customer-login-page'
import { getSupabaseClient } from '@/lib/supabase'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))

const mockGetSupabaseClient = vi.mocked(getSupabaseClient)
const signUp = vi.fn()
const signInWithPassword = vi.fn()

/**
 * The customer half of the auth separation.
 *
 * The point of these is what they DON'T do: /register and /login must never
 * touch the professional approval workflow. A customer account is complete
 * the moment it exists — no application row, no review, no waiting.
 */
describe('Customer auth routes stay clear of the professional workflow', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
    signUp.mockReset()
    signInWithPassword.mockReset()
    signUp.mockResolvedValue({ data: { session: { access_token: 't' }, user: { id: 'u-1' } }, error: null })
    signInWithPassword.mockResolvedValue({ data: { session: { access_token: 't' } }, error: null })
    mockGetSupabaseClient.mockReturnValue({ auth: { signUp, signInWithPassword } } as never)
  })

  it('/register creates a customer account and goes straight into the customer app', async () => {
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Léa Moreau' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'lea@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }))

    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'lea@example.com',
        options: expect.objectContaining({ data: expect.objectContaining({ signup_intent: 'customer' }) }),
      }),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/app/customer', { replace: true })
  })

  it('/register never asks a customer for a phone number, a business or a professional type', () => {
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    )

    expect(screen.queryByLabelText('Phone number')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Business name')).not.toBeInTheDocument()
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByText(/reviewed within 24 hours/i)).not.toBeInTheDocument()
  })

  it('/register presents ONE identity — no professional cross-link', () => {
    // Someone signing up as a customer should not be asked to consider
    // whether they are really a business. That question belongs on the
    // professional journey, where it can actually be answered.
    render(
      <MemoryRouter>
        <CustomerRegisterPage />
      </MemoryRouter>,
    )

    expect(screen.queryByRole('link', { name: 'Pro area' })).not.toBeInTheDocument()
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/pro\//)
    }
  })

  it('/login is the customer entrance and offers only the customer sign-up', () => {
    render(
      <MemoryRouter>
        <CustomerLoginPage />
      </MemoryRouter>,
    )

    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign up' })).toHaveAttribute('href', '/register')

    expect(screen.queryByRole('link', { name: 'Pro area' })).not.toBeInTheDocument()
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^\/pro\//)
    }
  })
})
