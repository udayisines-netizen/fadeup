import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PlatformApplicationsPage } from '@/pages/platform-applications-page'
import { usePlatformApplications } from '@/lib/queries/professional-applications'

vi.mock('@/lib/queries/professional-applications', () => ({ usePlatformApplications: vi.fn() }))

const mockUseApplications = vi.mocked(usePlatformApplications)

const PENDING = {
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
  addressLine1: null,
  postalCode: null,
  country: 'FR',
  staffCount: 3,
  website: null,
  instagram: null,
  businessIdentifier: null,
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
      <PlatformApplicationsPage />
    </MemoryRouter>,
  )
}

describe('PlatformApplicationsPage — /platform/applications', () => {
  beforeEach(() => {
    mockUseApplications.mockReturnValue(resolved([]))
  })

  it('opens on the pending queue — the tab that is actual work', () => {
    renderPage()

    expect(screen.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true')
    expect(mockUseApplications).toHaveBeenCalledWith('pending_review')
  })

  it('lists a waiting application with the business, applicant and city', () => {
    mockUseApplications.mockReturnValue(resolved([PENDING]))

    renderPage()

    const row = screen.getAllByRole('link', { name: 'Fade City' })[0]!.closest('tr')
      ?? screen.getAllByRole('link', { name: 'Fade City' })[1]!.closest('tr')
    expect(row).not.toBeNull()
    expect(within(row!).getByText(/Karim Benali/)).toBeInTheDocument()
    expect(within(row!).getByText('karim@fadecity.fr')).toBeInTheDocument()
    expect(within(row!).getByText('Lyon')).toBeInTheDocument()
    expect(within(row!).getByText('Barbershop')).toBeInTheDocument()
  })

  it('makes the number callable straight from the queue, in both the phone and desktop layouts', () => {
    // A reviewer working the queue on a phone must be able to dial without
    // opening the row. Both layouts are in the DOM (CSS decides which is
    // visible), and tel: gets the stored E.164 value verbatim in each.
    mockUseApplications.mockReturnValue(resolved([PENDING]))

    renderPage()

    const callLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('tel:'))

    expect(callLinks.length).toBeGreaterThanOrEqual(2)
    for (const link of callLinks) {
      expect(link).toHaveAttribute('href', 'tel:+33612345678')
    }
  })

  it('links to the review page from every layout', () => {
    mockUseApplications.mockReturnValue(resolved([PENDING]))

    renderPage()

    for (const link of screen.getAllByRole('link', { name: 'Fade City' })) {
      expect(link).toHaveAttribute('href', '/platform/applications/app-1')
    }
    expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('href', '/platform/applications/app-1')
  })

  it('says the queue is clear rather than showing a bare empty table', () => {
    renderPage()

    expect(screen.getByText('No applications waiting')).toBeInTheDocument()
    expect(screen.getByText('New professional applications will appear here.')).toBeInTheDocument()
  })

  it('surfaces a load failure instead of implying there is nothing to review', () => {
    mockUseApplications.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      error: new Error('permission denied for table professional_applications'),
    } as never)

    renderPage()

    expect(screen.getByText("Couldn't load applications")).toBeInTheDocument()
    expect(screen.queryByText('No applications waiting')).not.toBeInTheDocument()
  })
})
