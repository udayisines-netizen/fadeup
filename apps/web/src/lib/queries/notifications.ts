import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'
import { pollingInterval, useRealtimeInvalidation } from '@/lib/realtime'

/**
 * Product notifications — for customers and professionals.
 *
 * Deliberately NOT public.platform_notifications, which is FadeUp staff only:
 * its RLS demands a platform role, so it cannot carry "your appointment was
 * confirmed" to a customer. Same idea, different audience, different table.
 *
 * These rows are written server-side inside the same transaction as the
 * booking decision they describe, so a notification cannot exist for a
 * decision that did not commit, or be missing for one that did.
 */

export type NotificationType =
  | 'booking_request_created'
  | 'booking_confirmed'
  | 'booking_declined'
  | 'booking_expired'
  | 'booking_cancelled'
  | 'booking_rescheduled'
  | 'team_invitation'

export interface AppNotification {
  id: string
  type: NotificationType
  title: string
  body: string | null
  organizationId: string | null
  appointmentId: string | null
  readAt: string | null
  createdAt: string
}

interface NotificationRow {
  id: string
  type: NotificationType
  title: string
  body: string | null
  organization_id: string | null
  appointment_id: string | null
  read_at: string | null
  created_at: string
}

function mapNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    organizationId: row.organization_id,
    appointmentId: row.appointment_id,
    readAt: row.read_at,
    createdAt: row.created_at,
  }
}

export const notificationsKey = (userId: string | undefined) => ['notifications', userId] as const

/**
 * The caller's own notifications, live.
 *
 * This subscription does double duty on the customer side. Customers
 * deliberately have NO select policy on `appointments` — their reads go through
 * curated RPCs so internal columns stay unreachable — which means Postgres
 * Changes on that table would deliver them nothing. They own their
 * notification rows, though, and every booking transition writes one. So the
 * notification IS the signal that their booking moved, and `extraInvalidation`
 * lets a caller refetch the appointment list off the back of it.
 */
export function useNotifications(userId: string | undefined, extraInvalidation: string[][] = []) {
  const realtimeStatus = useRealtimeInvalidation(
    userId ? `notifications-${userId}` : null,
    [{ table: 'notifications', filter: userId ? `user_id=eq.${userId}` : undefined, event: 'INSERT' }],
    [notificationsKey(userId), ...extraInvalidation],
  )

  const query = useQuery({
    queryKey: notificationsKey(userId),
    queryFn: async (): Promise<AppNotification[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('notifications')
        .select('id, type, title, body, organization_id, appointment_id, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return ((data ?? []) as NotificationRow[]).map(mapNotification)
    },
    enabled: Boolean(userId),
    refetchInterval: pollingInterval(realtimeStatus),
  })

  const unreadCount = (query.data ?? []).filter((notification) => notification.readAt === null).length

  return { ...query, unreadCount, realtimeStatus }
}

export function useMarkNotificationRead(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (notificationId: string) => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('mark_notification_read', { p_notification_id: notificationId })
      if (error) throw error
    },
    // Optimistic here, and only here: marking read is the caller's own private
    // flag, it cannot fail for a reason they would care about, and it must feel
    // instant. Contrast with accepting a booking, which is never optimistic.
    onMutate: async (notificationId: string) => {
      await queryClient.cancelQueries({ queryKey: notificationsKey(userId) })
      const previous = queryClient.getQueryData<AppNotification[]>(notificationsKey(userId))
      queryClient.setQueryData<AppNotification[]>(notificationsKey(userId), (current) =>
        (current ?? []).map((notification) =>
          notification.id === notificationId
            ? { ...notification, readAt: notification.readAt ?? new Date().toISOString() }
            : notification,
        ),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(notificationsKey(userId), context.previous)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) })
    },
  })
}

export function useMarkAllNotificationsRead(userId: string | undefined) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('mark_all_notifications_read')
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationsKey(userId) })
    },
  })
}
