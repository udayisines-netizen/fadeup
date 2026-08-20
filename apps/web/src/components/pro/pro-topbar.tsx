import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Avatar } from '@/components/ui/avatar'
import { NotificationBell } from '@/components/notifications/notification-bell'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeToggle } from '@/components/ui/theme-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { getSupabaseClient } from '@/lib/supabase'
import type { MembershipWithOrganization } from '@/lib/queries/memberships'

/**
 * The Professional command bar.
 *
 * Search is the widest thing on the row and sits first, because the most
 * common non-navigational act in a shop is "find this person" — a customer
 * calls, and the fastest path to their record should not be Customers → scroll
 * → filter.
 *
 * The ⌘K hint is shown ONLY when the shortcut is actually bound, and the
 * binding lives here rather than in a global listener so there is exactly one
 * place that owns it.
 *
 * The account cluster carries the organization, because FadeUp genuinely
 * supports belonging to several and acting in the wrong one is a real and
 * expensive mistake. When there is only one membership it renders as plain
 * text rather than a menu that opens onto a single choice.
 */
export function ProTopbar({
  memberships,
  currentMembership,
  onSelectOrganization,
  onOpenSearch,
  userName,
  className,
}: {
  memberships: MembershipWithOrganization[]
  currentMembership: MembershipWithOrganization
  onSelectOrganization: (organizationId: string) => void
  onOpenSearch: () => void
  userName: string
  className?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        onOpenSearch()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onOpenSearch])

  async function signOut() {
    await getSupabaseClient().auth.signOut()
    navigate('/login', { replace: true })
  }

  const canSwitch = memberships.length > 1

  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-paper-0/95 px-4 backdrop-blur lg:px-6',
        className,
      )}
    >
      {/* A button, not an input: it opens a command surface rather than
          filtering in place, and a real input here would promise inline
          results that do not exist. */}
      <button
        ref={searchRef}
        type="button"
        onClick={onOpenSearch}
        className={cn(
          'group flex h-10 min-w-0 flex-1 items-center gap-2.5 rounded-lg border border-border bg-paper-50 px-3 text-start',
          'transition-colors duration-[--fu-duration-quick] hover:border-border-strong motion-reduce:transition-none',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
          'max-w-xl',
        )}
      >
        <Search className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-ink-500">{t('app:nav.searchPlaceholder')}</span>
        <kbd className="hidden shrink-0 rounded border border-border bg-paper-0 px-1.5 py-0.5 text-[10px] font-medium text-ink-500 sm:inline-block">
          ⌘K
        </kbd>
      </button>

      <div className="ms-auto flex shrink-0 items-center gap-1">
        <NotificationBell />
        <LanguageSwitcher />
        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              'ms-1 flex min-h-11 items-center gap-2 rounded-lg px-2 text-start',
              'hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
            )}
          >
            <Avatar name={userName} size="sm" />
            <span className="hidden min-w-0 flex-col leading-tight sm:flex">
              <span className="truncate text-sm font-medium text-ink-950">
                {currentMembership.organizationName}
              </span>
              <span className="truncate text-xs text-ink-500">
                {t(`app:roles.${currentMembership.role}`)}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-64">
            {canSwitch ? (
              <>
                <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-ink-300">
                  {t('app:nav.switchOrganization')}
                </p>
                {memberships.map((membership) => (
                  <DropdownMenuItem
                    key={membership.organizationId}
                    onSelect={() => onSelectOrganization(membership.organizationId)}
                    aria-checked={membership.organizationId === currentMembership.organizationId}
                    role="menuitemradio"
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="truncate text-sm font-medium">{membership.organizationName}</span>
                    <span className="text-xs text-ink-500">{t(`app:roles.${membership.role}`)}</span>
                  </DropdownMenuItem>
                ))}
                <div className="my-1 h-px bg-border" role="separator" />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => navigate('/app/settings')}>
              {t('app:nav.settings')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void signOut()}>{t('common:nav.signOut')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
