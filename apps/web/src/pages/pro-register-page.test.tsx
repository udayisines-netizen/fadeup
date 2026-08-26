import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProRegisterPage } from '@/pages/pro-register-page'
import { getSupabaseClient } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useSubmitProfessionalApplication } from '@/lib/queries/professional-applications'

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useNavigate: () => mockNavigate }
})

vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))

// The page now branches on whether a session already exists: a visitor who
// arrived via "Continue with Google/Apple" is already authenticated, so the
// form must apply as that identity instead of creating a second account.
vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))

vi.mock('@/lib/queries/professional-applications', async () => {
  // PROFESSIONAL_TYPES drives the type picker — keep the real constant so the
  // test breaks if a type is added without a label.
  const actual = await vi.importActual<typeof import('@/lib/queries/professional-applications')>(
    '@/lib/queries/professional-applications',
  )
  return { ...actual, useSubmitProfessionalApplication: vi.fn() }
})

const mockGetSupabaseClient = vi.mocked(getSupabaseClient)
const mockUseSubmit = vi.mocked(useSubmitProfessionalApplication)
const mockUseAuth = vi.mocked(useAuth)

/** Signed out — the classic path, where this form also creates the account. */
function signedOut() {
  mockUseAuth.mockReturnValue({ session: null, user: null, loading: false })
}

/** Signed in, e.g. having just come back from Google or Apple. */
function signedIn() {
  mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
}

const signUp = vi.fn()
const mutateAsync = vi.fn()

function renderPage(initialEntry = '/pro/register') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ProRegisterPage />
    </MemoryRouter>,
  )
}

/** Fills every required field. `phone` is overridable so validation can be exercised. */
function fillRequiredFields(overrides: { phone?: string } = {}) {
  fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Karim' } })
  fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Benali' } })
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'karim@fadecity.fr' } })
  fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: overrides.phone ?? '06 12 34 56 78' } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse-battery' } })
  fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Fade City' } })
}

describe('ProRegisterPage — /pro/register submits an APPLICATION, not an account upgrade', () => {
  beforeEach(() => {
    signedOut()
    mockNavigate.mockClear()
    signUp.mockReset()
    mutateAsync.mockReset()
    signUp.mockResolvedValue({ data: { session: { access_token: 't' }, user: { id: 'u-1' } }, error: null })
    mutateAsync.mockResolvedValue({ id: 'app-1', status: 'pending_review' })
    mockGetSupabaseClient.mockReturnValue({ auth: { signUp } } as never)
    mockUseSubmit.mockReturnValue({ mutateAsync, isPending: false } as never)
  })

  it('creates the account and the pending application, then sends the applicant to their status page', async () => {
    renderPage()
    fillRequiredFields()
    fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Lyon' } })

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))

    expect(signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'karim@fadecity.fr',
        options: expect.objectContaining({ data: expect.objectContaining({ signup_intent: 'pro' }) }),
      }),
    )

    const submitted = mutateAsync.mock.calls[0][0]
    expect(submitted).toMatchObject({
      firstName: 'Karim',
      lastName: 'Benali',
      phone: '06 12 34 56 78',
      businessName: 'Fade City',
      professionalType: 'barbershop',
      city: 'Lyon',
    })

    expect(mockNavigate).toHaveBeenCalledWith('/pro/application', { replace: true })
  })

  it('never lets the browser assert its own status, role or organization', async () => {
    // The client sends business facts only. status is always pending_review
    // server-side, and nothing here can hand itself a tenant or a role — those
    // are decided by review_professional_application.
    renderPage()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))

    const submitted = mutateAsync.mock.calls[0][0] as Record<string, unknown>
    for (const forbidden of ['status', 'role', 'organizationId', 'organization_id', 'reviewedBy', 'approvalStatus']) {
      expect(submitted).not.toHaveProperty(forbidden)
    }
  })

  it('requires a phone number — the reviewer calls every applicant', async () => {
    renderPage()
    fillRequiredFields({ phone: '' })

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    expect(await screen.findByText('Phone number is required')).toBeInTheDocument()
    expect(signUp).not.toHaveBeenCalled()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('rejects a phone number the server would not be able to normalize', async () => {
    renderPage()
    fillRequiredFields({ phone: '12' })

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    expect(await screen.findByText('Enter a valid phone number, e.g. 06 12 34 56 78')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('accepts E.164 and 00-prefixed international numbers, spaces and all', async () => {
    renderPage()
    fillRequiredFields({ phone: '+33 6 12 34 56 78' })

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync.mock.calls[0][0].phone).toBe('+33 6 12 34 56 78')
  })

  it('lets the applicant pick a professional type other than the barbershop default', async () => {
    renderPage()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('radio', { name: /Mobile barber/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync.mock.calls[0][0].professionalType).toBe('mobile_barber')
  })

  it('does not pretend the application landed when email confirmation is still outstanding', async () => {
    // No session means submit_professional_application (which needs auth.uid())
    // cannot have run. Saying "application sent" here would be a lie.
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'u-1' } }, error: null })

    renderPage()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    expect(await screen.findByText(/confirmation link/i)).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('surfaces a signup failure instead of silently continuing to the application', async () => {
    // An error we cannot classify keeps the provider's own message — a wrong
    // guess that swallowed a real error would be worse than showing it.
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'Database is unavailable' } })

    renderPage()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    expect(await screen.findByText('Database is unavailable')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('routes an existing account to sign in rather than showing "User already registered"', async () => {
    // The production symptom. Becoming a professional must never require a
    // second account, so this is a signpost, not an error — and signing in
    // returns them HERE to finish the application they had started.
    signUp.mockResolvedValue({ data: { session: null, user: null }, error: { message: 'User already registered' } })

    renderPage()
    fillRequiredFields()

    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    expect(await screen.findByText(/this account already exists/i)).toBeInTheDocument()
    expect(screen.queryByText('User already registered')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute(
      'href',
      `/pro/login?redirect=${encodeURIComponent('/pro/register')}`,
    )
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it('offers a way across to the client sign-in for someone at the wrong door', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Client sign-in' })).toHaveAttribute('href', '/login')
  })
})

describe('plan intent arriving from /for-business', () => {
  beforeEach(() => {
    signedOut()
    mockUseSubmit.mockReturnValue({ mutateAsync } as never)
    mockGetSupabaseClient.mockReturnValue({ auth: { signUp } } as never)
  })

  it('shows the plan the applicant chose on the pricing page', () => {
    renderPage('/pro/register?plan=salon_pro')

    const banner = screen.getByText('Plan selected').parentElement!
    expect(banner.textContent).toContain('Pro')
  })

  it('shows nothing at all when no plan was chosen', () => {
    renderPage('/pro/register')

    expect(screen.queryByText('Plan selected')).not.toBeInTheDocument()
  })

  it('ignores a plan identifier someone typed into the address bar', () => {
    // The query string is onboarding INTENT, never entitlement. An id that is
    // not in the catalog produces no banner rather than an invented plan name,
    // and either way it grants nothing — approval is a platform decision and
    // billing does not exist yet.
    renderPage('/pro/register?plan=enterprise_unlimited')

    expect(screen.queryByText('Plan selected')).not.toBeInTheDocument()
  })

  it('still requires the same application, whatever plan was named', async () => {
    signUp.mockResolvedValue({ data: { session: { access_token: 'token' } }, error: null })
    mutateAsync.mockResolvedValue({ id: 'application-id' })

    renderPage('/pro/register?plan=multi_scale')
    fillRequiredFields()
    fireEvent.click(screen.getByRole('button', { name: 'Submit my application' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())

    // The plan is not in the payload: nothing about a subscription reaches the
    // server from a query parameter.
    const payload = mutateAsync.mock.calls.at(-1)![0]
    expect(JSON.stringify(payload)).not.toContain('multi_scale')
    expect(mockNavigate).toHaveBeenCalledWith('/pro/application', { replace: true })
  })
})

describe('ProRegisterPage — applying as an identity that already exists', () => {
  beforeEach(() => {
    signedIn()
    mockNavigate.mockClear()
    signUp.mockReset()
    mutateAsync.mockReset()
    mutateAsync.mockResolvedValue({ id: 'app-1', status: 'pending_review' })
    mockGetSupabaseClient.mockReturnValue({ auth: { signUp } } as never)
    mockUseSubmit.mockReturnValue({ mutateAsync } as never)
  })

  it('does not ask a signed-in visitor to create a second account', () => {
    // FadeUp has ONE auth.users namespace. A customer who has used the app
    // for a year and now opens a shop applies as themselves — same account,
    // same Passport, same booking history.
    renderPage()

    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('submits the application without calling signUp', async () => {
    renderPage()

    fireEvent.change(screen.getByLabelText('First name'), { target: { value: 'Karim' } })
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Benali' } })
    fireEvent.change(screen.getByLabelText('Phone number'), { target: { value: '06 12 34 56 78' } })
    fireEvent.change(screen.getByLabelText('Business name'), { target: { value: 'Fade City' } })
    fireEvent.submit(screen.getByRole('button', { name: /send|submit|application/i }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled())
    expect(signUp).not.toHaveBeenCalled()
  })

  it('offers Google and Apple only when there is no session to apply as', () => {
    const signedInRender = renderPage()
    expect(screen.queryByRole('button', { name: /continue with google/i })).not.toBeInTheDocument()
    signedInRender.unmount()

    signedOut()
    renderPage()
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with apple/i })).toBeInTheDocument()
  })
})
