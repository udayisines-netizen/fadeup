import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProV2Shell, useProScope } from '@/pro-v2/shell/pro-v2-shell'

/**
 * The pro shell's scope contract: one cockpit for an independent, a shop and
 * a multi-location organization — the selector exists exactly when a real
 * choice does, and the scope reaches pages through the outlet context.
 */

const state: {
  membership: {
    id: string
    role: string
    organizationId: string
    organizationName: string
    organizationSlug: string
  } | null
  locations: Array<{ id: string; name: string }>
  pending: boolean
} = { membership: null, locations: [], pending: false }

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ session: null, user: { id: 'user-1' }, loading: false }),
}))

vi.mock('@/lib/queries/memberships', () => ({
  useResolvedOrganization: () => ({
    membershipsQuery: { isPending: state.pending },
    memberships: state.membership ? [state.membership] : [],
    organizationId: state.membership?.organizationId ?? null,
    membership: state.membership,
  }),
}))

vi.mock('@/lib/queries/locations', () => ({
  useOrgLocations: () => ({ data: state.locations }),
}))

function ScopeProbe() {
  const scope = useProScope()
  return (
    <p>
      scope:{scope.organizationName}:{scope.locationId ?? 'all'}
    </p>
  )
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/_preview/r5r/pro']}>
      <Routes>
        <Route path="/_preview/r5r/pro" element={<ProV2Shell />}>
          <Route index element={<ScopeProbe />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

const ORG = {
  id: 'm-1',
  role: 'owner',
  organizationId: 'org-1',
  organizationName: 'Fade Factory Group',
  organizationSlug: 'fade-factory',
}

describe('scope control', () => {
  it('shows no location selector for a single-location business', () => {
    state.membership = ORG
    state.locations = [{ id: 'loc-1', name: 'Side Agency' }]
    renderShell()

    expect(screen.queryByText('All locations')).not.toBeInTheDocument()
    expect(screen.getByText('scope:Fade Factory Group:all')).toBeInTheDocument()
  })

  it('offers All locations plus each site for a multi-location organization', () => {
    state.membership = ORG
    state.locations = [
      { id: 'loc-1', name: 'Paris République' },
      { id: 'loc-2', name: 'Créteil' },
    ]
    renderShell()

    // The trigger shows the org-wide default scope.
    expect(screen.getByText('All locations')).toBeInTheDocument()
  })

  it('tells an account with no membership the truth', () => {
    state.membership = null
    state.locations = []
    renderShell()

    expect(screen.getByRole('heading', { name: 'No workspace' })).toBeInTheDocument()
  })
})

describe('navigation', () => {
  it('offers the six pro destinations', () => {
    state.membership = ORG
    state.locations = [{ id: 'loc-1', name: 'Side Agency' }]
    renderShell()

    const nav = screen.getByRole('navigation')
    const labels = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent?.trim())
    expect(labels).toEqual([
      'Dashboard',
      'Calendar',
      'Customers',
      'Analytics',
      'Retention',
      'Profile',
    ])
  })
})
