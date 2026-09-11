import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ReactNode } from 'react'
import { PlatformLayout } from '@/routes/platform-layout'
import { ToastProvider } from '@/components/ui/toast'
import { usePlatformPermissions } from '@/routes/require-platform-role'
import type { PlatformPermission } from '@/lib/types'

vi.mock('@/routes/require-platform-role', () => ({
  RequirePlatformRole: ({ children }: { children: ReactNode }) => children,
  usePlatformPermissions: vi.fn(),
}))
vi.mock('@/routes/platform-support-view-context', () => ({
  PlatformSupportViewProvider: ({ children }: { children: ReactNode }) => children,
  useSupportView: () => ({ activeSession: null, isLoading: false, isEntering: false, isExiting: false }),
}))
vi.mock('@/components/platform-support-view-banner', () => ({ PlatformSupportViewBanner: () => null }))
vi.mock('@/components/platform/notification-bell', () => ({ NotificationBell: () => null }))
// Le sélecteur de thème lit un contexte monté par le shell applicatif ; il
// n'a rien à voir avec ce qu'on mesure ici.
vi.mock('@/components/ui/theme-toggle', () => ({ ThemeToggle: () => null }))

const mockPermissions = vi.mocked(usePlatformPermissions)

function withPermissions(permissions: PlatformPermission[]) {
  mockPermissions.mockReturnValue({
    permissions,
    can: (permission: PlatformPermission) => permissions.includes(permission),
  })
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={['/platform']}>
      <ToastProvider>
        <PlatformLayout />
      </ToastProvider>
    </MemoryRouter>,
  )
}

function navHrefs(): string[] {
  return [...document.querySelectorAll('header a[href^="/platform"]')].map((a) => a.getAttribute('href') ?? '')
}

/**
 * « Ce qu'un rôle ne peut pas faire n'est pas rendu, jamais grisé avec un
 * cadenas » — la règle posée depuis P1b. Un lien absent n'est PAS une garde :
 * les policies et les RPC refusent de toute façon. Ce test vérifie seulement
 * qu'on ne montre pas une porte fermée.
 */
describe('navigation /platform selon le rôle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('le fondateur voit toute la console', () => {
    withPermissions([
      'crm.read', 'crm.write', 'onboarding.review', 'tenant.read',
      'audit.read', 'internal_roles.manage', 'support_view.enter',
    ])
    renderShell()
    const hrefs = navHrefs()
    expect(hrefs).toContain('/platform/applications')
    expect(hrefs).toContain('/platform/organizations')
    expect(hrefs).toContain('/platform/acquisition')
    expect(hrefs).toContain('/platform/outreach')
    expect(hrefs).toContain('/platform/data-science')
    expect(hrefs).toContain('/platform/team')
    expect(hrefs).toContain('/platform/audit')
  })

  it("le support n'a ni CRM, ni équipe, ni journal", () => {
    withPermissions(['tenant.read', 'appointment.cancel', 'marketplace.withdraw'])
    renderShell()
    const hrefs = navHrefs()
    expect(hrefs).toContain('/platform/organizations')
    expect(hrefs).not.toContain('/platform/acquisition')
    expect(hrefs).not.toContain('/platform/outreach')
    expect(hrefs).not.toContain('/platform/data-science')
    expect(hrefs).not.toContain('/platform/team')
    expect(hrefs).not.toContain('/platform/audit')
    expect(hrefs).not.toContain('/platform/applications')
  })

  it("le stagiaire n'a que l'acquisition, et rien de public", () => {
    withPermissions(['crm.zone_read', 'crm.field_capture'])
    renderShell()
    const hrefs = navHrefs()
    expect(hrefs).toContain('/platform/acquisition')
    expect(hrefs).not.toContain('/platform/outreach')
    expect(hrefs).not.toContain('/platform/data-science')
    expect(hrefs).not.toContain('/platform/organizations')
    expect(hrefs).not.toContain('/platform/audit')
    expect(hrefs).not.toContain('/platform/team')
  })

  it("aucun cadenas ni bouton grisé ne remplace un lien absent", () => {
    withPermissions(['crm.zone_read', 'crm.field_capture'])
    renderShell()
    const header = document.querySelector('header')
    expect(header?.querySelectorAll('[aria-disabled="true"], [disabled]')).toHaveLength(0)
    expect(screen.queryByText(/🔒/)).toBeNull()
  })
})
