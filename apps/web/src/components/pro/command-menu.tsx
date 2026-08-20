import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { proNavGroups } from '@/components/pro/pro-nav'
import { useOrgCustomers } from '@/lib/queries/customers'
import type { MembershipRole } from '@/lib/types'

/**
 * ⌘K — go somewhere, or find someone.
 *
 * Deliberately only two kinds of result. A command palette that tries to be a
 * universal action surface ends up as a list nobody reads; the two things a
 * shop actually needs at speed are "open that page" and "who is this on the
 * phone", so those are what it does.
 *
 * Customers are searched CLIENT-SIDE over the org customer list. That is not
 * laziness: the list is bounded per organization, TanStack already caches it
 * for the Customers page, and a per-keystroke round trip would be slower and
 * would add a query the backend freeze does not want. It degrades honestly —
 * with nothing cached the palette still navigates.
 *
 * The list is only fetched once the palette has been OPENED, so the shell does
 * not pay for a customer query on every page load.
 */
export function CommandMenu({
  open,
  onOpenChange,
  organizationId,
  role,
  pendingRequests,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  organizationId: string | undefined
  role: MembershipRole
  pendingRequests: number
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const customersQuery = useOrgCustomers(open ? organizationId : undefined)

  const destinations = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return proNavGroups(role, pendingRequests)
      .flatMap((group) => group.items)
      .filter((item) => !needle || t(item.labelKey).toLowerCase().includes(needle))
  }, [query, role, pendingRequests, t])

  const customers = useMemo(() => {
    const needle = query.trim().toLowerCase()
    // Two characters: below that every customer matches and the list is noise.
    if (needle.length < 2) return []
    return (customersQuery.data ?? [])
      .filter((customer) =>
        [customer.name, customer.phone, customer.email]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)),
      )
      .slice(0, 6)
  }, [query, customersQuery.data])

  function go(to: string) {
    onOpenChange(false)
    setQuery('')
    navigate(to)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogTitle className="sr-only">{t('app:nav.searchTitle')}</DialogTitle>

        <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('app:nav.searchPlaceholder')}
            aria-label={t('app:nav.searchTitle')}
            className="min-w-0 flex-1 bg-transparent text-sm text-ink-950 outline-none placeholder:text-ink-500"
          />
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {destinations.length > 0 ? (
            <CommandGroup label={t('app:nav.goTo')}>
              {destinations.map((item) => {
                const Icon = item.icon
                return (
                  <CommandRow key={item.to} onSelect={() => go(item.to)}>
                    <Icon className="h-4 w-4 shrink-0 text-ink-500" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-300" aria-hidden="true" />
                  </CommandRow>
                )
              })}
            </CommandGroup>
          ) : null}

          {customers.length > 0 ? (
            <CommandGroup label={t('common:entity.customers')}>
              {customers.map((customer) => (
                <CommandRow key={customer.id} onSelect={() => go('/app/customers')}>
                  <Avatar name={customer.name} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{customer.name}</span>
                  {customer.phone ? (
                    <span className="shrink-0 text-xs text-ink-500">{customer.phone}</span>
                  ) : null}
                </CommandRow>
              ))}
            </CommandGroup>
          ) : null}

          {destinations.length === 0 && customers.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-ink-500">
              {query.trim().length < 2 ? t('app:nav.searchHint') : t('common:state.noMatches')}
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CommandGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-widest text-ink-300">{label}</p>
      <ul className="flex flex-col">{children}</ul>
    </div>
  )
}

function CommandRow({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          'flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-start text-sm text-ink-950',
          'hover:bg-paper-100 focus-visible:bg-paper-100 focus-visible:outline-none',
        )}
      >
        {children}
      </button>
    </li>
  )
}
