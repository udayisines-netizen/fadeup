import { Link, Outlet, useNavigate } from 'react-router-dom'
import { RequirePlatformRole } from '@/routes/require-platform-role'
import { PlatformSupportViewProvider } from '@/routes/platform-support-view-context'
import { PlatformSupportViewBanner } from '@/components/platform-support-view-banner'
import { Navbar } from '@/components/ui/navbar'
import { AppNavLink } from '@/components/ui/nav-link'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { getSupabaseClient } from '@/lib/supabase'

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
  const navigate = useNavigate()

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
            FadeUp Platform
          </Link>
        }
        links={
          <>
            <AppNavLink to="/platform" end>
              Overview
            </AppNavLink>
            <AppNavLink to="/platform/organizations">Organizations</AppNavLink>
            <AppNavLink to="/platform/team">Team</AppNavLink>
            <AppNavLink to="/platform/audit">Audit log</AppNavLink>
          </>
        }
        actions={
          <>
            <ThemeToggle />
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </>
        }
      />
      <PlatformSupportViewBanner />
      <Outlet />
    </div>
  )
}
