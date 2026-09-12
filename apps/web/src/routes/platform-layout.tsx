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

  /*
   * PLAT-2 — les quatre écrans par rôle. Même règle : un lien absent plutôt
   * qu'un lien grisé.
   *
   * Le SUPPORT est le seul à porter `support.tickets` ; la MODÉRATION est
   * partagée, parce que ses deux derniers onglets (onboardings,
   * revendications) appartiennent aussi au commercial — c'est une décision du
   * fondateur, pas une commodité. Le CRM du commercial est bâti sur
   * `crm.read`, que le stagiaire n'a pas ; le TERRAIN est bâti sur
   * `crm.zone_read` ou `crm.field_capture`, si bien que le commercial y a
   * accès aussi (il saisit aussi sur le terrain) mais y voit tout, pas une
   * zone. Les AFFICHES restent au fondateur et à l'admin.
   */
  const canSeeSupport = can('support.tickets')
  const canSeeModeration = can('moderation.content') || can('onboarding.review')
  const canSeeSales = can('crm.read')
  const canSeeField = can('crm.zone_read') || can('crm.field_capture')
  const canSeePosters = can('poster.manage')

  /*
   * PLAT-3 — quatre écrans de plus, même règle : absent plutôt que grisé.
   *
   * Les DÉFAUTS et le WORKER restent au fondateur et à l'admin — ce sont les
   * deux seuls rôles porteurs de `platform.settings` et de `worker.operate`.
   * Les PROMOTIONS s'ouvrent au commercial : il porte `promotions.apply`
   * (pose une offre dans les bornes de son rôle) sans porter
   * `promotions.manage` (créer, arrêter, révoquer), et l'écran lui-même
   * retire ce qu'il ne peut pas faire. Le TUNNEL d'acquisition se lit avec
   * `crm.read`, comme l'atelier du commercial.
   */
  const canSeeSettings = can('platform.settings')
  const canSeePromotions = can('promotions.apply')
  const canSeeFunnel = can('crm.read')
  const canSeeWorker = can('worker.operate')

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
            {canSeeSupport ? <AppNavLink to="/platform/support">{t('platform:nav.support')}</AppNavLink> : null}
            {canSeeModeration ? (
              <AppNavLink to="/platform/moderation">{t('platform:nav.moderation')}</AppNavLink>
            ) : null}
            {canSeeSales ? <AppNavLink to="/platform/sales">{t('platform:nav.sales')}</AppNavLink> : null}
            {canSeeField ? <AppNavLink to="/platform/field">{t('platform:nav.field')}</AppNavLink> : null}
            {canSeePosters ? <AppNavLink to="/platform/posters">{t('platform:nav.posters')}</AppNavLink> : null}
            {canSeePromotions ? (
              <AppNavLink to="/platform/promotions">{t('platform:nav.promotions')}</AppNavLink>
            ) : null}
            {canSeeFunnel ? <AppNavLink to="/platform/funnel">{t('platform:nav.funnel')}</AppNavLink> : null}
            {canSeeWorker ? <AppNavLink to="/platform/worker">{t('platform:nav.worker')}</AppNavLink> : null}
            {canSeeSettings ? (
              <AppNavLink to="/platform/settings">{t('platform:nav.settings')}</AppNavLink>
            ) : null}
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
