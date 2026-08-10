import { Link, Outlet, useNavigate } from 'react-router-dom'
import { RequirePlatformRole } from '@/routes/require-platform-role'
import { Navbar } from '@/components/ui/navbar'
import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * Root shell for everything under /platform — this is FadeUp's OWN staff
 * area, completely separate from a barbershop's /app (see CLAUDE.md's
 * platform-vs-tenant terminology section). Full navigation (Organizations,
 * Users, Team, Audit, ...) is Phase D; this lot only needs enough shell to
 * prove the bootstrap → authenticated → authorized chain works end to end.
 */
export function PlatformLayout() {
  return (
    <RequirePlatformRole>
      <PlatformShell />
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
        actions={
          <>
            <ThemeToggle />
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </>
        }
      />
      <Outlet />
    </div>
  )
}
