import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformApplicationDetailPage } from '@/pages/platform-application-detail-page'
import { usePlatformApplication, useReviewApplication } from '@/lib/queries/professional-applications'
import { ToastProvider } from '@/components/ui/toast'

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom')
  return { ...actual, useParams: () => ({ applicationId: 'app-1' }) }
})

vi.mock('@/lib/queries/professional-applications', () => ({
  usePlatformApplication: vi.fn(),
  useReviewApplication: vi.fn(),
}))

const mockUseApplication = vi.mocked(usePlatformApplication)
const mockUseReview = vi.mocked(useReviewApplication)

const mutateAsync = vi.fn()

const APPLICATION = {
  id: 'app-1',
  userId: 'u-1',
  status: 'pending_review' as const,
  firstName: 'Karim',
  lastName: 'Benali',
  email: 'karim@fadecity.fr',
  phone: '+33612345678',
  businessName: 'Fade City',
  professionalType: 'barbershop' as const,
  city: 'Lyon',
  addressLine1: '12 rue de la Ré',
  postalCode: '69001',
  country: 'FR',
  staffCount: 3,
  website: 'fadecity.fr',
  instagram: '@fadecity',
  businessIdentifier: '90210123400017',
  internalNote: null,
  submittedAt: '2026-08-13T09:00:00.000Z',
  reviewedAt: null,
  reviewedBy: null,
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
        <PlatformApplicationDetailPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('PlatformApplicationDetailPage — review surface', () => {
  beforeEach(() => {
    mutateAsync.mockReset()
    mutateAsync.mockResolvedValue(undefined)
    mockUseApplication.mockReturnValue(resolved(APPLICATION))
    mockUseReview.mockReturnValue({ mutateAsync, isPending: false } as never)
  })

  it('shows the reviewer everything needed to qualify the applicant', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: 'Fade City' })).toBeInTheDocument()
    expect(screen.getByText(/Karim Benali/)).toBeInTheDocument()
    expect(screen.getByText('+33612345678')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'karim@fadecity.fr' })).toHaveAttribute(
      'href',
      'mailto:karim@fadecity.fr',
    )
    expect(screen.getByText(/12 rue de la Ré, 69001, Lyon, FR/)).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('@fadecity')).toBeInTheDocument()
    expect(screen.getByText('90210123400017')).toBeInTheDocument()
  })

  it('dials the exact stored number — the call action carries no display formatting', () => {
    renderPage()

    expect(screen.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:+33612345678')
  })

  it('confirms before approving, then approves through the reviewed RPC', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Approve Fade City?')).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      applicationId: 'app-1',
      decision: 'approve',
      rejectionReason: null,
      internalNote: null,
    })
  })

  it('confirms before refusing, and passes the applicant-facing reason', async () => {
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }))
    expect(await screen.findByText('Refuse Fade City?')).toBeInTheDocument()

    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Reason shown to the applicant'), {
      target: { value: 'We could not confirm the business address.' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Refuse' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      applicationId: 'app-1',
      decision: 'reject',
      rejectionReason: 'We could not confirm the business address.',
      internalNote: null,
    })
  })

  it('keeps the internal note out of the applicant-facing reason', async () => {
    // Two separate fields, two separate columns. The note travels with the
    // decision but never reaches the applicant or the email payload.
    renderPage()

    fireEvent.change(screen.getByLabelText('Internal note'), {
      target: { value: 'Suspected duplicate of an existing shop.' },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Refuse' }))
    await screen.findByText('Refuse Fade City?')
    const dialog = within(screen.getByRole('dialog'))
    fireEvent.change(dialog.getByLabelText('Reason shown to the applicant'), {
      target: { value: 'We could not confirm the business address.' },
    })
    fireEvent.click(dialog.getByRole('button', { name: 'Refuse' }))

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    const call = mutateAsync.mock.calls[0][0]
    expect(call.internalNote).toBe('Suspected duplicate of an existing shop.')
    expect(call.rejectionReason).toBe('We could not confirm the business address.')
    expect(call.rejectionReason).not.toContain('Suspected duplicate')
  })

  it('labels the internal note as platform-only so a reviewer is never misled about who reads it', () => {
    renderPage()

    expect(screen.getByText('Platform only. Never shown to the applicant or sent by email.')).toBeInTheDocument()
  })

  it('offers no decision buttons once the application has already been decided', () => {
    mockUseApplication.mockReturnValue(
      resolved({
        ...APPLICATION,
        status: 'approved',
        reviewedAt: '2026-08-13T12:00:00.000Z',
        reviewedBy: 'platform-user-1',
        organizationId: 'org-1',
      }),
    )

    renderPage()

    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Refuse' })).not.toBeInTheDocument()
  })

  it('shows a failed decision rather than leaving the reviewer thinking it went through', async () => {
    mutateAsync.mockRejectedValue(new Error('Only platform administrators can review applications'))

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await screen.findByText('Approve Fade City?')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('Only platform administrators can review applications')).toBeInTheDocument()
  })
})
