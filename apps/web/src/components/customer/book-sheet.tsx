import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Repeat2, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useMyAppointments, useMyFavorites } from '@/lib/queries/customer-app'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetDescription,
  BottomSheetFooter,
  BottomSheetHeader,
  BottomSheetTitle,
} from '@/components/ui/bottom-sheet'
import { Avatar } from '@/components/ui/avatar'
import { buttonVariants } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

/**
 * ============================================================================
 * WHAT BOOK DOES WHEN THERE IS NOTHING TO BOOK YET
 * ============================================================================
 *
 * §34: "BOOK must always operate against a valid context. If no barber/service
 * context is selected: open the appropriate lightweight selector."
 *
 * A central BOOK button that navigated straight to search would be a fifth tab
 * wearing a costume — the customer taps the most prominent control in the
 * product and lands on the same list they could already reach. And a BOOK that
 * GUESSED a shop for them would sometimes guess wrong, in the one flow where
 * being wrong costs a wasted journey across a city.
 *
 * So it opens the shortest bridge to a real context, built entirely from facts
 * the customer's own account already holds:
 *
 *   REBOOK      the shop, professional and service of their last COMPLETED
 *               cut, deep-linked so the wizard skips all three questions
 *   FAVOURITES  shops they saved themselves
 *   SEARCH      always present, and the only option on a new account — which
 *               is the correct experience for a new account, not a failure
 *
 * Nothing here is ranked, scored or recommended. Rebook is "the most recent
 * completed appointment"; favourites are in the order the RPC returns them. A
 * ranking model belongs to a backend lot, and inventing one inside a bottom
 * sheet would quietly make this sheet the thing that decides where people get
 * their hair cut.
 *
 * WHY IT IS A SHEET AND NOT A PAGE
 *
 * Booking begins in the context the customer was already in. A page would push
 * a history entry, lose their scroll position on Discover, and make Back mean
 * "leave booking" instead of "never mind".
 */
export function BookSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation('customer-app')
  const { user } = useAuth()

  // Fetched only while the sheet is open. A permanently-mounted sheet eagerly
  // running two queries would put a cost on every customer screen for an
  // interaction most of them are not currently having.
  const appointmentsQuery = useMyAppointments(Boolean(user) && open)
  const favoritesQuery = useMyFavorites(Boolean(user) && open)

  /**
   * The most recent COMPLETED appointment — not the most recent appointment.
   *
   * A cancelled or no-show booking is not evidence that someone wants to go
   * back, and a pending one is a booking they already have. Completed is the
   * only status that means "this happened, and it went ahead".
   */
  const rebook = useMemo(() => {
    const appointments = appointmentsQuery.data ?? []
    return (
      appointments
        .filter((appointment) => appointment.status === 'completed')
        .sort((a, b) => b.startsAt.localeCompare(a.startsAt))[0] ?? null
    )
  }, [appointmentsQuery.data])

  // Shop favourites only. A favourited BARBER deep-links differently, and the
  // list would silently mix two link shapes under one heading.
  const favorites = useMemo(
    () => (favoritesQuery.data ?? []).filter((favorite) => favorite.barberId === null).slice(0, 5),
    [favoritesQuery.data],
  )

  const isPending = open && (appointmentsQuery.isPending || favoritesQuery.isPending)

  const rebookHref = (() => {
    if (!rebook) return null
    const params = new URLSearchParams()
    if (rebook.barberId) params.set('barber', rebook.barberId)
    if (rebook.serviceId) params.set('service', rebook.serviceId)
    const query = params.toString()
    return `/s/${rebook.organizationSlug}${query ? `?${query}` : ''}`
  })()

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent className="sm:mx-auto sm:max-w-lg">
        <BottomSheetHeader>
          <BottomSheetTitle>{t('book.sheetTitle')}</BottomSheetTitle>
          <BottomSheetDescription>{t('book.sheetDescription')}</BottomSheetDescription>
        </BottomSheetHeader>

        <BottomSheetBody className="flex flex-col gap-2 pb-2">
          {isPending ? (
            <>
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </>
          ) : (
            <>
              {rebook && rebookHref ? (
                <BookOption
                  to={rebookHref}
                  onNavigate={() => onOpenChange(false)}
                  icon={<Repeat2 className="h-5 w-5" aria-hidden="true" />}
                  title={
                    rebook.barberDisplayName
                      ? t('book.rebookWith', { barber: rebook.barberDisplayName })
                      : t('book.rebookAt', { organization: rebook.organizationName })
                  }
                  detail={rebook.serviceName ?? rebook.organizationName}
                  emphasis
                />
              ) : null}

              {favorites.map((favorite) => (
                <BookOption
                  key={favorite.favoriteId}
                  to={`/s/${favorite.organizationSlug}`}
                  onNavigate={() => onOpenChange(false)}
                  icon={<Avatar name={favorite.organizationName} size="sm" />}
                  title={favorite.organizationName}
                  detail={t('book.favouriteDetail')}
                />
              ))}

              {/* A first-run state, not an empty state. A new account has no
                  history and no favourites, which is normal — so it gets one
                  line of explanation and the ordinary Search action below,
                  rather than an illustration and an apology. */}
              {!rebook && favorites.length === 0 ? (
                <p className="px-1 py-2 text-sm text-ink-500">{t('book.nothingYet')}</p>
              ) : null}
            </>
          )}
        </BottomSheetBody>

        <BottomSheetFooter>
          <Link
            to="/app/customer/search"
            onClick={() => onOpenChange(false)}
            className={buttonVariants({ variant: rebook ? 'secondary' : 'book', size: 'lg' }, 'w-full')}
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('book.findAShop')}
          </Link>
        </BottomSheetFooter>
      </BottomSheetContent>
    </BottomSheet>
  )
}

function BookOption({
  to,
  onNavigate,
  icon,
  title,
  detail,
  emphasis,
}: {
  to: string
  onNavigate: () => void
  icon: ReactNode
  title: string
  detail: string
  emphasis?: boolean
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        'flex min-h-[--fu-control-lg] items-center gap-3 rounded-xl border px-4 py-3',
        'transition-colors duration-[--fu-duration-quick] motion-reduce:transition-none',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
        emphasis
          ? 'border-accent-200 bg-accent-100/60 hover:bg-accent-100'
          : 'border-border bg-paper-0 hover:bg-paper-100',
      )}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
          emphasis ? 'bg-accent-200 text-accent-800' : 'text-ink-700',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-950">{title}</span>
        <span className="block truncate text-xs text-ink-500">{detail}</span>
      </span>
    </Link>
  )
}
