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

  it('shows a first-use empty state when no Passport exists — never fabricated content', () => {
    mockUseMyPassport.mockReturnValue(successQuery(null))

    renderPage()

    expect(screen.getByText('Create your Fade Passport')).toBeInTheDocument()
    // Photos/shares sections only appear once a Passport actually exists.
    expect(screen.queryByText('Share my fade')).not.toBeInTheDocument()
  })

  it('renders real saved Passport values, and partial data stays useful', () => {
    mockUseMyPassport.mockReturnValue(successQuery(passport({ beardPreferences: null, preferencesNotes: null })))

    renderPage()

    expect(screen.getByText('Mid fade')).toBeInTheDocument()
    expect(screen.getAllByText('Not set').length).toBe(2)
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
