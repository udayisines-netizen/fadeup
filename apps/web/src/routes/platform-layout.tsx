import { Link, Outlet, useNavigate } from 'react-router-dom'
import { RequirePlatformRole, usePlatformPermissions } from '@/routes/require-platform-role'
import { PlatformSupportViewProvider } from '@/routes/platform-support-view-context'
import { PlatformSupportViewBanner } from '@/components/platform-support-view-banner'
import { Navbar } from '@/components/ui/navbar'
import { AppNavLink } from '@/components/ui/nav-link'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { NotificationBell } from '@/components/platform/notification-bell'
import { getSupabaseClient } from '@/lib/supabase'
import { useTranslation } from 'react-i18next'

/**
 * Root shell for everything under /platform — this is FadeUp's OWN staff
 * area, completely separate from a barbershop's /app (see CLAUDE.md's
 * platform-vs-tenant terminology section). SaaS Plans/Subscriptions/Platform
 * Revenue/System Health are not implemented yet — CLAUDE.md section 8 is
 * explicit that unbuilt capabilities get an honest "not available" state,
 * not fake numbers, so they're simply not in this nav yet rather than
 * linking to something that would have to fabricate data.
 */
export function PlatformLayout() {
  return (
    <RequirePlatformRole>
      <PlatformSupportViewProvider>
        <PlatformShell />
      </PlatformSupportViewProvider>
    </RequirePlatformRole>
  )
}

function PlatformShell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { can } = usePlatformPermissions()

  /*
   * PLAT-1 — ce qu'un rôle ne peut pas faire N'EST PAS RENDU : jamais grisé,
   * jamais cadenassé. Un stagiaire ne voit ni les campagnes ni le journal ;
   * un support ne voit pas l'acquisition. La navigation se recompose sans
   * eux, elle ne se dégrade pas.
   *
   * Ceci CONDITIONNE, cela n'autorise pas : chaque table et chaque RPC
   * derrière ces liens repose la question côté serveur.
   */
  const canSeeCrm = can('crm.read') || can('crm.zone_read')
  // Le trombinoscope est servi par list_platform_team, gardée par
  // is_platform_admin() — c'est-à-dire exactement les porteurs de audit.read
  // (fondateur et admin). Le fondateur y accède aussi pour GÉRER.
  const canSeeTeam = can('internal_roles.manage') || can('audit.read')

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/platform/login', { replace: true })
  }

  return (
    <div className="min-h-svh bg-paper-50">
      <Navbar
        brand={
          <Link to="/platform" className="text-base font-semibold text-ink-950">
            {t('platform:nav.fadeupPlatform')}
          </Link>
        }
        links={
          <>
            <AppNavLink to="/platform" end>
              {t('platform:nav.overview')}
            </AppNavLink>
            {can('onboarding.review') ? (
              <AppNavLink to="/platform/applications">{t('platform:nav.applications')}</AppNavLink>
            ) : null}
            {can('tenant.read') ? (
              <AppNavLink to="/platform/organizations">{t('common:entity.organizations')}</AppNavLink>
            ) : null}
            {canSeeCrm ? <AppNavLink to="/platform/acquisition">{t('platform:nav.acquisition')}</AppNavLink> : null}
            {can('crm.read') ? <AppNavLink to="/platform/outreach">{t('platform:nav.outreach')}</AppNavLink> : null}
            {can('crm.read') ? (
              <AppNavLink to="/platform/data-science">{t('platform:nav.dataScience')}</AppNavLink>
            ) : null}
            {canSeeTeam ? <AppNavLink to="/platform/team">{t('common:entity.team')}</AppNavLink> : null}
            {can('audit.read') ? <AppNavLink to="/platform/audit">{t('platform:nav.auditLog')}</AppNavLink> : null}
          </>
        }
        actions={
          <>
            <NotificationBell />
            <ThemeToggle />
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              {t('common:nav.signOut')}
            </Button>
          </>
        }
      />
      <PlatformSupportViewBanner />
      <Outlet />
    </div>
  )
}
