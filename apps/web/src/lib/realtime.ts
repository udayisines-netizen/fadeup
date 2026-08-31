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
 *
 * THE PHYSICAL TOPIC IS LIFECYCLE IDENTITY, NOT AUTHORIZATION. `channelName`
 * is the logical name a caller asks for; what actually reaches the socket is
 * that name plus a process-wide generation counter (see `nextChannelTopic`).
 * That is purely a transport concern — nothing about a topic string grants,
 * narrows or proves access, and the tenant boundary is still exactly where it
 * was: RLS in the database, plus the `organization_id=eq.` filter that keeps
 * the traffic narrow.
 */

export type RealtimeStatus = 'connecting' | 'live' | 'offline'

/**
 * Monotonic, process-wide. Every mount of every channel gets its own number,
 * so no two physical topics ever collide — not across tenants, and not across
 * two generations of the same logical channel.
 */
let channelGeneration = 0

/**
 * Builds the physical topic for one effect generation.
 *
 * WHY THIS EXISTS. `supabase.channel(topic)` returns the EXISTING channel when
 * one with that topic is still registered, and `removeChannel()` is async — it
 * awaits the server's leave acknowledgement before the channel is dropped from
 * the client's registry. So a teardown and a re-create that overlap (a tenant
 * switch to org B and back to org A, a fast remount, React StrictMode's double
 * effect) would hand the new generation the OLD, already-subscribed channel,
 * and `.on('postgres_changes', …)` on a joined channel throws
 * "cannot add `postgres_changes` callbacks … after `subscribe()`" — killing the
 * render. A unique topic per generation means the new channel is always a new
 * channel, and the pending removal of the old one can settle in its own time.
 */
export function nextChannelTopic(channelName: string): string {
  channelGeneration += 1
  return `${channelName}#g${channelGeneration}`
}

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

    // Snapshotted for this generation, deliberately NOT read from the ref at
    // callback time. A channel opened for org A must invalidate org A's keys or
    // nothing at all — never whatever tenant the ref has moved on to. Reading
    // the ref late is what would let a not-yet-torn-down org A channel refetch
    // org B's screens. The effect already re-runs whenever the serialized shape
    // changes, so a snapshot is never staler than the ref would have been.
    const generationSubscriptions = latest.current.subscriptions
    const generationQueryKeys = latest.current.queryKeys

    function invalidateAll() {
      // The single gate for every invalidation on this generation: once the
      // cleanup has run, a late event or status callback from the old channel
      // does nothing at all.
      if (cancelled) return
      for (const key of generationQueryKeys) {
        void queryClient.invalidateQueries({ queryKey: key })
      }
    }

    // A new generation is genuinely connecting. Saying 'live' because the
    // PREVIOUS channel was live is the same lie as a silently dropped socket.
    setStatus('connecting')

    const channel = supabase.channel(nextChannelTopic(channelName))

    for (const subscription of generationSubscriptions) {
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
      // Same gate as invalidateAll: a status callback arriving from a channel
      // this component has already abandoned must not touch React state either.
      // supabase-js emits CLOSED as a direct result of our own unsubscribe.
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
