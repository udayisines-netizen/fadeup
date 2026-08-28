import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerPassportPage } from '@/pages/customer-passport-page'
import { ToastProvider } from '@/components/ui/toast'
import { useAuth } from '@/lib/auth-context'
import {
  useMyPassport,
  useUpsertMyPassport,
  useMyPassportPhotos,
  useUploadPassportPhoto,
  useDeletePassportPhoto,
  useMyPassportShares,
  useCreatePassportShare,
  useRevokePassportShare,
} from '@/lib/queries/passport'

vi.mock('@/lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

// The card at the top of the page carries the customer's OWN name, from
// their own profile — never one a shop typed for them on a booking.
vi.mock('@/lib/queries/customer-profile', () => ({
  useMyCustomerProfile: vi.fn(() => ({ data: { displayName: 'Alex Customer' }, isPending: false })),
}))

vi.mock('@/lib/queries/passport', () => ({
  useMyPassport: vi.fn(),
  useUpsertMyPassport: vi.fn(),
  useMyPassportPhotos: vi.fn(),
  useUploadPassportPhoto: vi.fn(),
  useDeletePassportPhoto: vi.fn(),
  useMyPassportShares: vi.fn(),
  useCreatePassportShare: vi.fn(),
  useRevokePassportShare: vi.fn(),
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,fake') },
}))

const mockUseAuth = vi.mocked(useAuth)
const mockUseMyPassport = vi.mocked(useMyPassport)
const mockUseUpsert = vi.mocked(useUpsertMyPassport)
const mockUseMyPassportPhotos = vi.mocked(useMyPassportPhotos)
const mockUseUploadPhoto = vi.mocked(useUploadPassportPhoto)
const mockUseDeletePhoto = vi.mocked(useDeletePassportPhoto)
const mockUseMyPassportShares = vi.mocked(useMyPassportShares)
const mockUseCreateShare = vi.mocked(useCreatePassportShare)
const mockUseRevokeShare = vi.mocked(useRevokePassportShare)

function passport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p-1',
    userId: 'user-1',
    usualHaircut: 'Mid fade',
    fadeType: 'mid',
    sideLength: '1',
    topLength: '4 on top',
    beardPreferences: 'Short',
    preferencesNotes: 'Easy on the neckline',
    ...overrides,
  }
}

function successQuery(data: unknown) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <CustomerPassportPage />
      </ToastProvider>
    </MemoryRouter>,
  )
}

describe('CustomerPassportPage', () => {
  const upsertMutateAsync = vi.fn().mockResolvedValue(passport())
  const createShareMutateAsync = vi.fn().mockResolvedValue({ shareId: 's-1', token: 'tok-abc', expiresAt: '2099-01-01T00:00:00Z' })
  const revokeMutate = vi.fn()

  beforeEach(() => {
    upsertMutateAsync.mockClear()
    createShareMutateAsync.mockClear()
    revokeMutate.mockClear()
    mockUseAuth.mockReturnValue({ session: {} as never, user: { id: 'user-1' } as never, loading: false })
    mockUseUpsert.mockReturnValue({ mutateAsync: upsertMutateAsync, isPending: false } as never)
    mockUseMyPassportPhotos.mockReturnValue(successQuery([]))
    mockUseUploadPhoto.mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never)
    mockUseDeletePhoto.mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
    mockUseMyPassportShares.mockReturnValue(successQuery([]))
    mockUseCreateShare.mockReturnValue({ mutateAsync: createShareMutateAsync, isPending: false } as never)
    mockUseRevokeShare.mockReturnValue({ mutate: revokeMutate, isPending: false } as never)
  })

  it('never offers to CREATE the passport — every customer already has one', () => {
    mockUseMyPassport.mockReturnValue(successQuery(null))

    renderPage()

    // §18. This screen used to open with an empty state and a "Create your
    // Fade Passport" button, which manufactures an action out of a state.
    expect(screen.queryByRole('button', { name: /create/i })).not.toBeInTheDocument()

    // The card is there regardless, carrying the customer's own identity, and
    // an unfilled passport reads as a card with nothing on it yet.
    expect(screen.getByRole('region', { name: 'Fade Passport' })).toBeInTheDocument()
    expect(screen.getByText('Alex Customer')).toBeInTheDocument()

    // Photos/shares sections only appear once a Passport actually exists.
    expect(screen.queryByText('Share my fade')).not.toBeInTheDocument()
  })

  it('puts real saved values on the card and simply omits the unfilled ones', () => {
    mockUseMyPassport.mockReturnValue(successQuery(passport({ beardPreferences: null, preferencesNotes: null })))

    renderPage()

    expect(screen.getByText('Mid fade')).toBeInTheDocument()
    // "Not set" rows turn an identity card back into a half-finished form.
    // What is missing is absent, not labelled as missing — the form is where
    // the blanks live, because the form is where you fill them.
    expect(screen.queryByText('Not set')).not.toBeInTheDocument()
    expect(screen.queryByText('Beard preferences')).not.toBeInTheDocument()
  })

  it('saves edits through the upsert mutation', async () => {
    mockUseMyPassport.mockReturnValue(successQuery(passport()))

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Usual haircut'), { target: { value: 'High fade' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(upsertMutateAsync).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1', usualHaircut: 'High fade' })))
  })

  it('creating a share shows the QR, the link, and the shown-only-once warning', async () => {
    mockUseMyPassport.mockReturnValue(successQuery(passport()))

    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Create share link' }))

    await waitFor(() => expect(screen.getByText('Share link created')).toBeInTheDocument())
    expect(screen.getByText(/passport\/shared\/tok-abc/)).toBeInTheDocument()
    expect(screen.getByText(/only shown once/i)).toBeInTheDocument()
  })

  it('an active share can be revoked; an already-revoked one shows its state instead', () => {
    mockUseMyPassport.mockReturnValue(successQuery(passport()))
    mockUseMyPassportShares.mockReturnValue(
      successQuery([
        { id: 's-active', label: 'Barber', expiresAt: '2099-01-01T00:00:00Z', revokedAt: null, createdAt: '2026-08-01T00:00:00Z', lastAccessedAt: null },
        { id: 's-revoked', label: 'Old', expiresAt: '2099-01-01T00:00:00Z', revokedAt: '2026-08-02T00:00:00Z', createdAt: '2026-08-01T00:00:00Z', lastAccessedAt: null },
      ]),
    )

    renderPage()

    expect(screen.getByText('Revoked')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(revokeMutate).toHaveBeenCalledWith('s-active')
  })
})
