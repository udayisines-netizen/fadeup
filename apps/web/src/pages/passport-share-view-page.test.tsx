import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PassportShareViewPage } from '@/pages/passport-share-view-page'
import { useSharedPassport, type SharedPassport } from '@/lib/queries/passport'

vi.mock('@/lib/queries/passport', () => ({
  useSharedPassport: vi.fn(),
}))

const mockUseSharedPassport = vi.mocked(useSharedPassport)

function shared(overrides: Partial<SharedPassport> = {}): SharedPassport {
  return {
    status: 'active',
    displayName: 'Customer A',
    usualHaircut: 'Mid fade',
    fadeType: 'mid',
    sideLength: '1',
    topLength: '4 on top',
    beardPreferences: 'Keep it short',
    preferencesNotes: 'Easy on the neckline',
    ...overrides,
  }
}

function renderAtToken(token = 'abc123') {
  return render(
    <MemoryRouter initialEntries={[`/passport/shared/${token}`]}>
      <Routes>
        <Route path="/passport/shared/:token" element={<PassportShareViewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

function successQuery(data: SharedPassport) {
  return { data, isPending: false, isError: false, error: null, refetch: vi.fn() } as never
}

describe('PassportShareViewPage', () => {
  it('renders the shared Passport read-only while the link is valid', () => {
    mockUseSharedPassport.mockReturnValue(successQuery(shared()))

    renderAtToken()

    expect(screen.getByText("Customer A's Fade Passport")).toBeInTheDocument()
    expect(screen.getByText('Mid fade')).toBeInTheDocument()
    expect(screen.getByText('Easy on the neckline')).toBeInTheDocument()
    // Read-only: no edit/save affordance of any kind on this page.
    expect(screen.queryByRole('button', { name: /save|edit/i })).not.toBeInTheDocument()
  })

  it('marks the page noindex so a live share never becomes indexable content', () => {
    mockUseSharedPassport.mockReturnValue(successQuery(shared()))

    renderAtToken()

    const robots = document.querySelector('meta[name="robots"]')
    expect(robots).not.toBeNull()
    expect(robots?.getAttribute('content')).toBe('noindex, nofollow')
  })

  it('shows a useful expired state, with no Passport data', () => {
    mockUseSharedPassport.mockReturnValue(
      successQuery(shared({ status: 'expired', displayName: null, usualHaircut: null, preferencesNotes: null })),
    )

    renderAtToken()

    expect(screen.getByText('This link has expired')).toBeInTheDocument()
    expect(screen.queryByText('Mid fade')).not.toBeInTheDocument()
  })

  it('shows a useful revoked state, with no Passport data', () => {
    mockUseSharedPassport.mockReturnValue(
      successQuery(shared({ status: 'revoked', displayName: null, usualHaircut: null, preferencesNotes: null })),
    )

    renderAtToken()

    expect(screen.getByText('This link was revoked')).toBeInTheDocument()
    expect(screen.queryByText('Mid fade')).not.toBeInTheDocument()
  })

  it('shows a not-found state for a bogus token', () => {
    mockUseSharedPassport.mockReturnValue(
      successQuery(shared({ status: 'not_found', displayName: null, usualHaircut: null, preferencesNotes: null })),
    )

    renderAtToken('made-up')

    expect(screen.getByText("This link isn't valid")).toBeInTheDocument()
  })
})
