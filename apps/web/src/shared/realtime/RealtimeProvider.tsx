import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/**
 * Central realtime infrastructure (P1b §11). No component ever creates a
 * channel — they declare one through `useChannel`, which registers its
 * connection state here so the app can expose ONE honest connectivity
 * indicator (after 10 s of degraded state) instead of a per-widget guess.
 */

export type ChannelStatus = 'connecting' | 'live' | 'reconnecting' | 'offline'
export type ConnectionStatus = 'live' | 'reconnecting' | 'offline'

interface RealtimeContextValue {
  /** Aggregate of every mounted channel; 'live' when none are mounted. */
  status: ConnectionStatus
  /** True once the aggregate has been degraded for more than 10 s. */
  showIndicator: boolean
  /** Internal — useChannel reports its lifecycle here. */
  report: (id: number, status: ChannelStatus | null) => void
}

export const RealtimeContext = createContext<RealtimeContextValue | null>(null)

function aggregate(statuses: Iterable<ChannelStatus>): ConnectionStatus {
  let result: ConnectionStatus = 'live'
  for (const status of statuses) {
    if (status === 'offline') return 'offline'
    if (status === 'reconnecting' || status === 'connecting') result = 'reconnecting'
  }
  return result
}

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const channels = useRef(new Map<number, ChannelStatus>())
  const [status, setStatus] = useState<ConnectionStatus>('live')
  const [showIndicator, setShowIndicator] = useState(false)

  const report = useCallback((id: number, channelStatus: ChannelStatus | null) => {
    if (channelStatus === null) {
      channels.current.delete(id)
    } else {
      channels.current.set(id, channelStatus)
    }
    setStatus(aggregate(channels.current.values()))
  }, [])

  useEffect(() => {
    if (status === 'live') {
      setShowIndicator(false)
      return
    }
    const timer = window.setTimeout(() => setShowIndicator(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [status])

  const value = useMemo(() => ({ status, showIndicator, report }), [status, showIndicator, report])

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

export function useRealtimeStatus(): { status: ConnectionStatus; showIndicator: boolean } {
  const ctx = useContext(RealtimeContext)
  if (!ctx) throw new Error('useRealtimeStatus must be used within RealtimeProvider')
  return { status: ctx.status, showIndicator: ctx.showIndicator }
}
