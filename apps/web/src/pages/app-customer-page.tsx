import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { Container } from '@/components/ui/container'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import { LanguageSwitcher } from '@/components/ui/language-switcher'

/**
 * /app/customer — the landing page for a signed-up-but-not-yet-connected
 * customer account. Deliberately honest, not a fabricated dashboard:
 * FadeUp does not yet link a customer's account to their bookings/queue
 * position/membership across shops (CLAUDE.md section 54 — never invent
 * data or a false sense of feature completeness). A customer today books
 * through their barbershop's own link (/s/:slug); this page says that
 * plainly instead of showing empty widgets pretending to be "no data yet".
 */
export function AppCustomerPage() {
  const navigate = useNavigate()
  const { user } = useAuth()

  async function handleSignOut() {
    const supabase = getSupabaseClient()
    await supabase.auth.signOut()
    navigate('/customer/login', { replace: true })
  }

  return (
    <div className="min-h-svh bg-paper-50">
      <header className="border-b border-border bg-paper-0">
        <Container size="md" className="flex h-16 items-center justify-between">
          <span className="text-base font-semibold text-ink-950">FadeUp</span>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <Button variant="secondary" onClick={() => void handleSignOut()}>
              Sign out
            </Button>
          </div>
        </Container>
      </header>

      <Container size="md" className="py-12">
        <EmptyState
          title={`Welcome${user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name as string}` : ''}`}
          description="Your account is ready. Book with a barbershop using their booking link, or join a walk-in queue — once you do, it'll show up here."
        />
      </Container>
    </div>
  )
}
