import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bell } from 'lucide-react'
import { useAuth } from '@/lib/auth-context'
import { useNotifications } from '@/lib/queries/notifications'

/**
 * The notification entry point in the shell header.
 *
 * ============================================================================
 * A BADGE IS A CLAIM ABOUT DATA
 * ============================================================================
 *
 * The count comes from `useNotifications`, which reads the caller's own
 * `notifications` rows under RLS and derives `unreadCount` from real
 * `read_at IS NULL`. It renders only when that number is genuinely above zero
 * and the query has genuinely resolved — a signed-out visitor, a still-loading
 * query and a customer with nothing waiting all show the same quiet bell,
 * because all three are the same truth: nothing to report.
 *
 * The hook is disabled entirely without a user id, so an anonymous preview
 * visitor makes no request at all rather than one that returns an empty array.
 *
 * ============================================================================
 * ACTIVITY IS NOT A TAB
 * ============================================================================
 *
 * PRODUCT_UI_BLUEPRINT.md §3 keeps Activity out of primary navigation and
 * reaches it through notification UI instead. The Activity surface itself is
 * R5R.1H, so this points at Profile for now rather than at a route that does
 * not exist — a control that navigates somewhere real is better than one that
 * dead-ends, and better than one that is missing from the first screen the
 * blueprint says must have it.
 */
export function V2NotificationEntry({ to, activityLabel }: { to: string; activityLabel: string }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { unreadCount, isSuccess } = useNotifications(user?.id)

  const showCount = isSuccess && unreadCount > 0

  return (
    <Link
      to={to}
      aria-label={
        showCount
          ? t('customer-app:v2.shell.notificationsWithCount', { count: unreadCount })
          : activityLabel
      }
      className="v2-press relative flex h-11 w-11 items-center justify-center rounded-v2-2 text-v2-ink hover:bg-v2-fill"
    >
      <Bell className="h-[1.2rem] w-[1.2rem]" strokeWidth={1.7} aria-hidden="true" />
      {showCount ? (
        <span
          aria-hidden="true"
          className="absolute end-1.5 top-1.5 min-w-4 rounded-v2-1 bg-v2-green px-1 text-center text-[0.625rem] font-semibold leading-4 text-v2-paper"
        >
          {unreadCount > 9 ? '9+' : unreadCount}
        </span>
      ) : null}
    </Link>
  )
}
