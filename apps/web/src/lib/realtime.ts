import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * One way to subscribe to Postgres Changes, used by every live surface.
 *
 * THE EVENT IS A SIGNAL, NEVER THE STATE. Every subscriber here invalidates a
 * TanStack query and lets the authoritative RPC answer. Rendering the payload
 * directly would mean trusting a row shape that RLS filtered but that no
 * authorization check has curated — and the customer-facing reads deliberately
 * go through RPCs precisely so internal columns stay unreachable.
 *
 * Postgres Changes is RLS-aware: a subscriber only receives events for rows its
 * own policies would let it SELECT. That is what makes these subscriptions
 * tenant-safe, not the `filter` string — the filter only narrows the traffic.
 *
 * THE FALLBACK MATTERS AS MUCH AS THE SUBSCRIPTION. A websocket that drops
 * silently is worse than no websocket, because the screen looks live and is
 * not. So this reports its own connection state, refetches once on reconnect
 * (events during the gap are simply gone), and callers pair it with a slow
 * poll that speeds up whenever realtime is not connected.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'offline'

export interface RealtimeSubscription {
  table: string
  /** PostgREST filter, e.g. `organization_id=eq.<uuid>`. Narrows traffic, never authorization. */
  filter?: string
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
}

/**
 * Subscribes while mounted and invalidates `queryKeys` on every matching
 * change. Returns the connection status so the UI can be honest about whether
 * it is actually live.
 */
export function useRealtimeInvalidation(
  channelName: string | null,
  subscriptions: RealtimeSubscription[],
  queryKeys: QueryKey[],
): RealtimeStatus {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<RealtimeStatus>('connecting')

  // Serialized so the effect re-runs when the SHAPE changes, not on every
  // render — callers build these arrays inline, and a new array identity each
  // render would tear the channel down and rebuild it in a loop.
  const subscriptionKey = JSON.stringify(subscriptions)
  const queryKey = JSON.stringify(queryKeys)

  // Kept in a ref so the effect never depends on them and never resubscribes
  // because a caller re-rendered.
  const latest = useRef({ subscriptions, queryKeys })
  latest.current = { subscriptions, queryKeys }

  useEffect(() => {
    if (!channelName) {
      setStatus('offline')
      return
    }

    const supabase = getSupabaseClient()
    let cancelled = false

    function invalidateAll() {
      for (const key of latest.current.queryKeys) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    }

    const channel = supabase.channel(channelName)

    for (const subscription of latest.current.subscriptions) {
      channel.on(
        // The supabase-js overloads for postgres_changes are not expressible
        // through a loop without widening here; the runtime contract is exact.
        'postgres_changes' as never,
        {
          event: subscription.event ?? '*',
          schema: 'public',
          table: subscription.table,
          ...(subscription.filter ? { filter: subscription.filter } : {}),
        } as never,
        () => invalidateAll(),
      )
    }

    channel.subscribe((subscribeStatus) => {
      if (cancelled) return

      if (subscribeStatus === 'SUBSCRIBED') {
        setStatus('live')
        // Anything that changed while we were not listening is not coming as
        // an event. Refetch once so reconnecting closes the gap instead of
        // leaving a stale screen that merely looks connected.
        invalidateAll()
        return
      }

      if (
        subscribeStatus === 'CHANNEL_ERROR' ||
        subscribeStatus === 'TIMED_OUT' ||
        subscribeStatus === 'CLOSED'
      ) {
        // supabase-js retries on its own. Reporting `offline` is what switches
        // the caller's polling to its faster interval in the meantime.
        setStatus('offline')
      }
    })

    return () => {
      cancelled = true
      void supabase.removeChannel(channel)
    }
  }, [channelName, subscriptionKey, queryKey, queryClient])

  return status
}

/**
 * How often to poll, given whether realtime is actually connected.
 *
 * Live: a slow safety net for the events a websocket can still miss.
 * Offline: fast enough that a broken socket degrades into a slightly laggy
 * screen rather than a wrong one.
 */
export function pollingInterval(status: RealtimeStatus, options?: { live?: number; offline?: number }): number {
  return status === 'live' ? (options?.live ?? 120_000) : (options?.offline ?? 20_000)
}
