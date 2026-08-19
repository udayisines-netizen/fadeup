import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Bell } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/cn'
import { useAuth } from '@/lib/auth-context'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from '@/lib/queries/notifications'
import { useTranslation } from 'react-i18next'

/**
 * Product notifications for customers and professionals.
 *
 * Deliberately a separate component from components/platform/notification-bell:
 * that one reads public.platform_notifications, which is FadeUp staff only and
 * whose RLS demands a platform role. Merging them would mean one component
 * asking two tables which audience it is serving.
 *
 * Kept small on purpose. This is the amount of notification surface LOT C needs
 * to make live state changes understandable — a list, an unread count, and a
 * way to dismiss. A full notification centre is not this lot's job.
 */
export function NotificationBell({
  className,
  extraInvalidation,
}: {
  className?: string
  /** Extra query keys to refetch when a notification arrives — e.g. the caller's booking list. */
  extraInvalidation?: string[][]
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const reduced = useReducedMotion()
  const [open, setOpen] = useState(false)
  const { data, unreadCount } = useNotifications(user?.id, extraInvalidation)
  const markRead = useMarkNotificationRead(user?.id)
  const markAllRead = useMarkAllNotificationsRead(user?.id)

  const notifications = data ?? []

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // Named for assistive tech including the count, since the dot alone
          // is not information a screen reader can use.
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'
          }
          className={cn(
            'relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-700',
            'hover:bg-paper-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
            className,
          )}
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          <AnimatePresence>
            {unreadCount > 0 ? (
              <motion.span
                // A small, quiet arrival. Enough to notice out of the corner of
                // the eye; nothing that pulses or demands attention on a screen
                // that stays open all day.
                initial={reduced ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                exit={reduced ? { opacity: 0 } : { scale: 0 }}
                transition={{ duration: reduced ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
                className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-semibold text-on-accent"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between px-3 py-2">
          <span className="text-sm font-semibold text-ink-950">{t('common:notifications.notifications')}</span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs font-medium text-accent-700 underline underline-offset-2"
            >
              {t('common:notifications.markAllRead')}
            </button>
          ) : null}
        </div>

        {notifications.length === 0 ? (
          <p className="px-3 pb-3 pt-1 text-sm text-ink-500">{t('common:notifications.nothingYet')}</p>
        ) : (
          <ul className="max-h-96 overflow-y-auto">
            {notifications.map((notification) => (
              <li key={notification.id}>
                <DropdownMenuItem
                  onSelect={() => markRead.mutate(notification.id)}
                  className="flex flex-col items-start gap-0.5 whitespace-normal py-2.5"
                >
                  <span className="flex w-full items-start gap-2">
                    {/* Unread is shown by a dot AND by weight, never colour alone. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        notification.readAt ? 'bg-transparent' : 'bg-accent-600',
                      )}
                    />
                    <span
                      className={cn(
                        'text-sm',
                        notification.readAt ? 'text-ink-700' : 'font-medium text-ink-950',
                      )}
                    >
                      {notification.title}
                    </span>
                  </span>
                  {notification.body ? (
                    <span className="ps-3.5 text-xs text-ink-500">{notification.body}</span>
                  ) : null}
                  <span className="ps-3.5 text-xs text-ink-500">
                    {new Date(notification.createdAt).toLocaleString(undefined, {
                      day: 'numeric',
                      month: 'short',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                </DropdownMenuItem>
              </li>
            ))}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
