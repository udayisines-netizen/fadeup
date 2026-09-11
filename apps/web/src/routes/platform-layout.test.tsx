import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { PlatformSupportViewBanner } from '@/components/platform-support-view-banner'
import { ToastProvider } from '@/components/ui/toast'
import { useSupportView } from '@/routes/platform-support-view-context'
import { useOrganization } from '@/lib/queries/platform'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'

vi.mock('@/routes/platform-support-view-context', () => ({ useSupportView: vi.fn() }))
vi.mock('@/lib/queries/platform', () => ({ useOrganization: vi.fn() }))
vi.mock('@/lib/queries/staff-profiles', () => ({ useOrgStaffProfiles: vi.fn() }))

const mockSupportView = vi.mocked(useSupportView)
const mockOrganization = vi.mocked(useOrganization)
const mockStaffProfiles = vi.mocked(useOrgStaffProfiles)

function resolved(data: unknown) {
  return { data, isPending: false, isError: false, error: null } as never
}

function renderBanner() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <PlatformSupportViewBanner />
      </ToastProvider>
    </MemoryRouter>,
  )
}

/**
 * Le bandeau de vue empruntée est le seul garde-fou VISIBLE d'une
 * fonctionnalité d'élévation de privilèges. Ce qu'on vérifie ici n'est pas
 * une décoration : qu'il apparaisse, qu'il nomme la cible, qu'il dise le
 * temps qui reste, et surtout qu'il n'offre AUCUN moyen de le faire taire
 * autrement qu'en sortant de la vue.
 */
describe('bandeau de vue empruntée', () => {
  it('ne rend rien sans session active', () => {
    mockSupportView.mockReturnValue({
      activeSession: null,
      isLoading: false,
      enterSupportView: vi.fn(),
      exitSupportView: vi.fn(),
      isEntering: false,
      isExiting: false,
    })
    mockOrganization.mockReturnValue(resolved(null))
    mockStaffProfiles.mockReturnValue(resolved([]))

    const { container } = renderBanner()
    expect(container.querySelector('[data-plat1-support-banner]')).toBeNull()
  })

  it("nomme l'organisation, annonce le temps restant, et n'offre aucune fermeture", () => {
    mockSupportView.mockReturnValue({
      activeSession: {
        id: 's-1',
        organizationId: 'org-1',
        targetType: 'organization',
        targetUserId: null,
        reason: 'dépannage',
        startedAt: new Date().toISOString(),
        endedAt: null,
        expiresAt: new Date(Date.now() + 12 * 60_000).toISOString(),
      },
      isLoading: false,
      enterSupportView: vi.fn(),
      exitSupportView: vi.fn(),
      isEntering: false,
      isExiting: false,
    })
    mockOrganization.mockReturnValue(resolved({ id: 'org-1', name: 'Maison Kaïs', slug: 'kais', createdAt: '' }))
    mockStaffProfiles.mockReturnValue(resolved([]))

    const { container } = renderBanner()

    const banner = container.querySelector('[data-plat1-support-banner]')
    expect(banner).not.toBeNull()
    expect(screen.getByText(/Maison Kaïs/)).toBeInTheDocument()
    expect(screen.getByText(/12/)).toBeInTheDocument()

    // Un seul bouton : sortir. Pas de croix, pas de « masquer », pas de
    // « plus tard » — un modérateur qui oublie où il est fait des dégâts.
    const buttons = [...(banner?.querySelectorAll('button') ?? [])]
    expect(buttons).toHaveLength(1)
    expect(buttons[0].textContent ?? '').not.toMatch(/close|dismiss|fermer|masquer/i)
  })

  it('affiche « session échue » quand l’échéance est passée', () => {
    mockSupportView.mockReturnValue({
      activeSession: {
        id: 's-1',
        organizationId: 'org-1',
        targetType: 'organization',
        targetUserId: null,
        reason: null,
        startedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        endedAt: null,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
      isLoading: false,
      enterSupportView: vi.fn(),
      exitSupportView: vi.fn(),
      isEntering: false,
      isExiting: false,
    })
    mockOrganization.mockReturnValue(resolved({ id: 'org-1', name: 'Maison Kaïs', slug: 'kais', createdAt: '' }))
    mockStaffProfiles.mockReturnValue(resolved([]))

    renderBanner()
    expect(screen.getByText(/expired|échue/i)).toBeInTheDocument()
  })
})
