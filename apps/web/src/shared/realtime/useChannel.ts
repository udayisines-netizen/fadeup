import { useContext, useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '@/shared/lib/supabase'
import { RealtimeContext, type ChannelStatus } from '@/shared/realtime/RealtimeProvider'

/**
 * THE way V2 subscribes to Postgres Changes. One channel per CONTEXT (a
 * screen, a shell), never per component.
 *
 * The event is a signal, never the state: handlers should invalidate query
 * keys and let the authoritative RPC answer. Direct cache writes are
 * reserved for the Live Queue (P2). `onReconnect` fires on every successful
 * (re)subscribe — anything that changed while the socket was down is not
 * coming as an event, so callers refetch there.
 */

export interface UseChannelOptions {
  /** Logical channel name, e.g. `notifications:<userId>`. Null disables. */
  name: string | null
  table: string
  /** PostgREST filter (`user_id=eq.<uuid>`). Narrows traffic, never authorization. */
  filter?: string
  onInsert?: () => void
  onUpdate?: () => void
  onDelete?: () => void
  /** Fired on every successful subscribe, including the first. */
  onReconnect?: () => void
}

/**
 * Monotonic, process-wide. Every mount gets its own physical topic so an
 * async `removeChannel` from the previous generation can never hand the new
 * effect an already-subscribed channel (which throws in supabase-js). Same
 * proven pattern as the retained lib/realtime.ts.
 */
let channelGeneration = 0

const BACKOFF_BASE_MS = 1_000
const BACKOFF_CAP_MS = 30_000

export function useChannel(options: UseChannelOptions): void {
  const context = useContext(RealtimeContext)
  if (!context) throw new Error('useChannel must be used within RealtimeProvider')
  const report = context.report

  // Callbacks live in a ref so a re-render never tears the channel down.
  const latest = useRef(options)
  latest.current = options

  const { name, table, filter } = options

  useEffect(() => {
    if (!name) return

    channelGeneration += 1
    const id = channelGeneration
    const supabase = getSupabase()

    let cancelled = false
    let attempt = 0
    let everConnected = false
    let channel: RealtimeChannel | null = null
    let retryTimer: number | null = null

    const setStatus = (status: ChannelStatus) => {
      if (!cancelled) report(id, status)
    }

    function connect() {
      if (cancelled) return

      setStatus(everConnected ? 'reconnecting' : 'connecting')

      const next = supabase.channel(`${name}#g${id}a${attempt}`)
      channel = next

      next.on(
        // The supabase-js overloads for postgres_changes are not expressible
        // through a variable event without widening; the runtime contract is exact.
        'postgres_changes' as never,
        {
          event: '*',
          schema: 'public',
          table,
          ...(filter ? { filter } : {}),
        } as never,
        (payload: { eventType?: string }) => {
          if (cancelled || channel !== next) return
          const current = latest.current
          if (payload.eventType === 'INSERT') current.onInsert?.()
          else if (payload.eventType === 'UPDATE') current.onUpdate?.()
          else if (payload.eventType === 'DELETE') current.onDelete?.()
        },
      )

      next.subscribe((subscribeStatus) => {
        // Ignore callbacks from an abandoned attempt — our own removeChannel
        // emits CLOSED, and reacting to it would spawn a second retry loop.
        if (cancelled || channel !== next) return

        if (subscribeStatus === 'SUBSCRIBED') {
          attempt = 0
          everConnected = true
          setStatus('live')
          // Events that happened while we were not listening are gone —
          // close the gap with a refetch.
          latest.current.onReconnect?.()
          return
        }

        if (subscribeStatus === 'CHANNEL_ERROR' || subscribeStatus === 'TIMED_OUT' || subscribeStatus === 'CLOSED') {
          setStatus(everConnected ? 'reconnecting' : 'offline')
          // Exponential backoff, capped at 30 s.
          const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_CAP_MS)
          attempt += 1
          if (retryTimer !== null) window.clearTimeout(retryTimer)
          retryTimer = window.setTimeout(() => {
            if (cancelled) return
            const stale = channel
            channel = null
            if (stale) void supabase.removeChannel(stale)
            connect()
          }, delay)
        }
      })
    }

    connect()

    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      if (channel) void supabase.removeChannel(channel)
      report(id, null)
    }
  }, [name, table, filter, report])
}
