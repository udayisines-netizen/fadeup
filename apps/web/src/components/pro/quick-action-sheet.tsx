import { useTranslation } from 'react-i18next'
import { CalendarPlus, Ban, UserPlus, ListPlus } from 'lucide-react'
import {
  BottomSheet,
  BottomSheetBody,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetTitle,
} from '@/components/ui/bottom-sheet'
import { cn } from '@/lib/cn'

/**
 * What the raised "+" opens.
 *
 * Every entry here maps to something the backend can actually do today —
 * create an appointment, add a walk-in, block time, add a customer. The
 * reference shows the same affordance; the discipline is refusing to add a
 * fifth row for something aspirational, because a quick-action sheet that
 * sometimes leads nowhere stops being trusted after the first time.
 *
 * These navigate rather than opening nested dialogs from the shell. A creation
 * form owned by the shell would have to know about services, professionals and
 * availability on every page of the product; the destination pages already do.
 */
export function QuickActionSheet({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigate: (to: string) => void
}) {
  const { t } = useTranslation()

  const actions = [
    { to: '/app/calendar?action=book', icon: CalendarPlus, label: t('app:quickAction.newBooking') },
    { to: '/app/queue?action=add', icon: ListPlus, label: t('app:quickAction.addWalkIn') },
    { to: '/app/calendar?action=block', icon: Ban, label: t('app:quickAction.blockTime') },
    { to: '/app/customers?action=add', icon: UserPlus, label: t('app:quickAction.newCustomer') },
  ]

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange}>
      <BottomSheetContent>
        <BottomSheetHeader>
          <BottomSheetTitle>{t('app:quickAction.title')}</BottomSheetTitle>
        </BottomSheetHeader>
        <BottomSheetBody>
          <ul className="flex flex-col gap-1 pb-2">
            {actions.map((action) => {
              const Icon = action.icon
              return (
                <li key={action.to}>
                  <button
                    type="button"
                    onClick={() => onNavigate(action.to)}
                    className={cn(
                      'flex min-h-14 w-full items-center gap-3 rounded-lg px-3 text-start',
                      'hover:bg-paper-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-700',
                    )}
                  >
                    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-100 text-accent-600">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-950">
                      {action.label}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </BottomSheetBody>
      </BottomSheetContent>
    </BottomSheet>
  )
}
