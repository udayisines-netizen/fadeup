import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import {
  usePlatformNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  type PlatformNotification,
} from '@/lib/queries/professional-applications'
import { cn } from '@/lib/cn'

/**
 * Platform-only notification bell.
 *
 * Lives in the /platform header, which is already behind RequirePlatformRole,
 * and the underlying table is RLS-scoped to `recipient_user_id = auth.uid()
 * AND the caller actually holds a platform role` — so a tenant owner cannot
 * reach these rows even if this component were somehow rendered for them.
 *
 * Realtime updates reuse the postgres_changes pattern already established
 * for the live queue rather than introducing an event bus.
 */
export function NotificationBell() {
  const { t } = useTranslation('auth')
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const notificationsQuery = usePlatformNotifications(user?.id)
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const notifications = notificationsQuery.data ?? []
  const unreadCount = notifications.filter((n) => !n.readAt).length

  function handleOpen(notification: PlatformNotification) {
    if (!notification.readAt) markRead.mutate(notification.id)
    setOpen(false)
    if (notification.targetType === 'professional_applications' && notification.targetId) {
      navigate(`/platform/applications/${notification.targetId}`)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={
          unreadCount > 0 ? `${t('platform.openNotifications')} (${unreadCount})` : t('platform.openNotifications')
        }
        aria-expanded={open}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-ink-500 transition-colors hover:bg-paper-100 hover:text-ink-950"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute end-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger-600 px-1 text-[10px] font-semibold text-paper-0">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          {/* Click-away layer; keeps the panel dismissible without a portal. */}
          <button
            type="button"
            className="fixed inset-0 z-20 cursor-default"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
          />
          <div className="absolute end-0 z-30 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-paper-0 shadow-lg">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <p className="text-sm font-semibold text-ink-950">{t('platform.notificationsTitle')}</p>
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => markAllRead.mutate()}
                  className="text-xs font-medium text-accent-700 hover:text-accent-800"
                >
                  {t('platform.markAllRead')}
                </button>
              ) : null}
            </div>

            <ul className="max-h-96 overflow-y-auto">
              {notifications.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-ink-500">{t('platform.notificationsEmpty')}</li>
              ) : (
                notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => handleOpen(notification)}
                      className={cn(
                        'flex w-full flex-col items-start gap-0.5 border-b border-border px-4 py-3 text-start transition-colors last:border-b-0 hover:bg-paper-50',
                        !notification.readAt && 'bg-accent-100/30',
                      )}
                    >
                      <span className="flex w-full items-center gap-2">
                        {!notification.readAt ? (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-600" aria-hidden="true" />
                        ) : null}
                        <span className="text-xs font-medium uppercase tracking-wide text-ink-500">
                          {notification.type === 'professional_application_submitted'
                            ? t('platform.newApplication')
                            : notification.type}
                        </span>
                      </span>
                      <span className="text-sm font-medium text-ink-950">{notification.title}</span>
                      {notification.body ? (
                        <span className="text-xs text-ink-500">{notification.body}</span>
                      ) : null}
                      <span className="text-xs text-ink-500">
                        {new Date(notification.createdAt).toLocaleString()}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </>
      ) : null}
    </div>
  )
}
