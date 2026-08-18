import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignupForm } from '@/components/auth/signup-form'
import { getSupabaseClient } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))

const mockGetSupabaseClient = vi.mocked(getSupabaseClient)
const mockUseAuth = vi.mocked(useAuth)
const signUp = vi.fn()

function signedOut() {
  mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })
}
function signedIn() {
  mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
}

function renderForm(entry = '/register') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/register"
          element={<SignupForm signupIntent="customer" defaultRedirect="/app/customer" loginPath="/login" />}
        />
        <Route path="/app/customer" element={<div>Customer home</div>} />
        <Route path="/s/le-fade" element={<div>Shop page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Karim Benali' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'karim@fadecity.fr' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } })
  fireEvent.submit(screen.getByRole('button', { name: /sign up/i }))
}

/**
 * FadeUp has ONE identity. Nothing in the professional journey may ask an
 * existing account to create a second one, and an existing email must produce
 * a route to sign in rather than a raw provider error.
 */
describe('SignupForm — already-registered handling', () => {
  beforeEach(() => {
    signedOut()
    signUp.mockReset()
    mockGetSupabaseClient.mockReturnValue({ auth: { signUp } } as never)
  })

  it('offers a sign-in path instead of the raw "User already registered"', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'User already registered' } })

    renderForm()
    fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/this account already exists/i)).toBeInTheDocument())
    expect(screen.queryByText('User already registered')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument()
  })

  it('preserves the intended destination through the sign-in link', async () => {
    // The whole point: they were part-way somewhere. Signing in must continue
    // that journey, not drop them at a default.
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'User already registered' } })

    renderForm('/register?redirect=%2Fs%2Fle-fade')
    fillAndSubmit()

    await waitFor(() => expect(screen.getByRole('link', { name: /sign in/i })).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      `/login?redirect=${encodeURIComponent('/s/le-fade')}`,
    )
  })

  it('lets them go back and use a different email', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'User already registered' } })

    renderForm()
    fillAndSubmit()

    await waitFor(() => expect(screen.getByText(/this account already exists/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /use a different email/i }))

    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('still creates a brand-new account normally', async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: 't' }, user: { id: 'u-1' } }, error: null })

    renderForm()
    fillAndSubmit()

    await waitFor(() => expect(screen.getByText('Customer home')).toBeInTheDocument())
    expect(signUp).toHaveBeenCalledTimes(1)
  })

  it('keeps an unrecognised provider message rather than inventing one', async () => {
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'Database is on fire' } })

    renderForm()
    fillAndSubmit()

    await waitFor(() => expect(screen.getByText('Database is on fire')).toBeInTheDocument())
  })
})

describe('SignupForm — an existing session never sees a create-account form', () => {
  beforeEach(() => {
    signUp.mockReset()
    mockGetSupabaseClient.mockReturnValue({ auth: { signUp } } as never)
  })

  it('redirects a signed-in visitor instead of offering to register again', () => {
    signedIn()

    renderForm()

    expect(screen.getByText('Customer home')).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
  })

  it('honours where a signed-in visitor was heading', () => {
    signedIn()

    renderForm('/register?redirect=%2Fs%2Fle-fade')

    expect(screen.getByText('Shop page')).toBeInTheDocument()
  })

  it('ignores an external redirect even for a signed-in visitor', () => {
    signedIn()

    renderForm('/register?redirect=https%3A%2F%2Fevil.example')

    expect(screen.getByText('Customer home')).toBeInTheDocument()
  })
})
