import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProApplicationPage } from '@/pages/pro-application-page'
import { useAuth } from '@/lib/auth-context'
import {
  useMyProfessionalApplication,
  useUpdateMyApplicationContact,
} from '@/lib/queries/professional-applications'
import { ToastProvider } from '@/components/ui/toast'

vi.mock('@/lib/auth-context', () => ({ useAuth: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ getSupabaseClient: vi.fn() }))
vi.mock('@/lib/queries/professional-applications', () => ({
  useMyProfessionalApplication: vi.fn(),
  useUpdateMyApplicationContact: vi.fn(),
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseApplication = vi.mocked(useMyProfessionalApplication)
const mockUseUpdateContact = vi.mocked(useUpdateMyApplicationContact)

const BASE = {
  id: 'app-1',
  firstName: 'Karim',
  lastName: 'Benali',
  email: 'karim@fadecity.fr',
  phone: '+33612345678',
  businessName: 'Fade City',
  professionalType: 'barbershop' as const,
  city: 'Lyon',
  submittedAt: '2026-08-13T09:00:00.000Z',
  reviewedAt: null,
  rejectionReason: null,
  organizationId: null,
}

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProApplicationPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('ProApplicationPage — /pro/application', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'u-1' } as never, loading: false })
    mockUseUpdateContact.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
  })

  describe('pending', () => {
    beforeEach(() => {
      mockUseApplication.mockReturnValue(resolved({ ...BASE, status: 'pending_review' }))
    })

    it('confirms the application was sent, promises a 24h review, and promises an email', () => {
      renderPage()

      expect(screen.getByRole('heading', { name: 'Your application has been sent.' })).toBeInTheDocument()
      expect(screen.getByText('Your application will be reviewed within 24 hours.')).toBeInTheDocument()
      expect(screen.getByText("You'll receive an email as soon as a decision has been made.")).toBeInTheDocument()
    })

    it('shows a three-step tracker with review in progress and the decision still ahead', () => {
      renderPage()

      expect(screen.getByText('Application sent')).toBeInTheDocument()
      expect(screen.getByText('Reviewing your application')).toBeInTheDocument()
      expect(screen.getByText('Decision')).toBeInTheDocument()
      expect(screen.getByText('In progress')).toBeInTheDocument()
    })

    it('never fabricates a completion percentage or a countdown', () => {
      // A human reads these. No honest number exists for "how far through your
      // application a person currently is", so the UI must not invent one.
      const { container } = renderPage()

      expect(container.textContent).not.toMatch(/\d+\s*%/)
      expect(container.querySelector('progress')).toBeNull()
      expect(container.querySelector('[role="progressbar"]')).toBeNull()
    })

    it('shows the facts the applicant submitted and the pending status', () => {
      renderPage()

      expect(screen.getByText('Fade City')).toBeInTheDocument()
      expect(screen.getByText('Under review')).toBeInTheDocument()
    })

    it('lets the applicant correct the number the reviewer will call', async () => {
      renderPage()

      screen.getByRole('button', { name: 'Update my contact details' }).click()

      expect(await screen.findByLabelText('Phone number')).toHaveValue('+33612345678')
    })
  })

  describe('rejected', () => {
    it('shows the reason the reviewer wrote FOR the applicant', () => {
      mockUseApplication.mockReturnValue(
        resolved({
          ...BASE,
          status: 'rejected',
          reviewedAt: '2026-08-13T12:00:00.000Z',
          rejectionReason: 'We could not confirm the business address.',
        }),
      )

      renderPage()

      expect(screen.getByRole('heading', { name: 'Application reviewed' })).toBeInTheDocument()
      expect(screen.getByText('We could not confirm the business address.')).toBeInTheDocument()
      expect(screen.getByText('Not approved')).toBeInTheDocument()
    })

    it('cannot leak an internal note, because the applicant-facing shape has no field for one', () => {
      // Defence in depth: the RPC's return type omits internal_note entirely,
      // so even a mocked row carrying one has nothing to render it.
      mockUseApplication.mockReturnValue(
        resolved({
          ...BASE,
          status: 'rejected',
          rejectionReason: null,
          internalNote: 'Suspected duplicate of an existing shop — do not tell them.',
        }),
      )

      const { container } = renderPage()

      expect(container.textContent).not.toContain('Suspected duplicate')
      expect(container.textContent).not.toContain('do not tell them')
    })

    it('does not offer a route into the Pro workspace', () => {
      mockUseApplication.mockReturnValue(resolved({ ...BASE, status: 'rejected' }))

      renderPage()

      expect(screen.queryByRole('link', { name: 'Go to FadeUp Pro' })).not.toBeInTheDocument()
    })
  })

  describe('approved', () => {
    it('opens the door to the Pro workspace', () => {
      mockUseApplication.mockReturnValue(
        resolved({
          ...BASE,
          status: 'approved',
          reviewedAt: '2026-08-13T12:00:00.000Z',
          organizationId: 'org-1',
        }),
      )

      renderPage()

      expect(screen.getByRole('heading', { name: "You're in." })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Go to FadeUp Pro' })).toHaveAttribute('href', '/app')
      expect(screen.getByText('Approved')).toBeInTheDocument()
      expect(screen.queryByText('In progress')).not.toBeInTheDocument()
    })
  })

  it('treats "never applied" as a normal state, not an error', () => {
    mockUseApplication.mockReturnValue(resolved(null))

    renderPage()

    expect(screen.getByRole('heading', { name: 'No application found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Apply to join' })).toHaveAttribute('href', '/pro/register')
  })
})
