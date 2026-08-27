import {
  analyticsThrottleKey,
  buildAnalyticsCall,
  type AnalyticsClientEventName,
  type AnalyticsContext,
  type AnalyticsOrigin,
  type AnalyticsProperties,
  type AnalyticsRpcArgs,
} from './events'

/**
 * The transport. A function, not a Supabase client, so that `apps/mobile` can
 * hand this module its own RPC caller later and reuse the entire contract
 * (§19) — and so that tests can assert on the exact arguments without a
 * network or a mocked client.
 */
export type AnalyticsTransport = (args: AnalyticsRpcArgs) => Promise<unknown>

export interface AnalyticsClientOptions {
  transport: AnalyticsTransport
  origin: AnalyticsOrigin
  /** Called for every rejected or failed event. Never called with a user-visible error. */
  onError?: (reason: string, error?: unknown) => void
  getSessionId?: () => string | null
  getLocale?: () => string | null
  /** Injected so throttle behaviour is testable without waiting in real time. */
  now?: () => number
  /** Identical event + context inside this window is treated as one view. */
  throttleMs?: number
}

export interface AnalyticsClient {
  track<N extends AnalyticsClientEventName>(
    name: N,
    input?: { properties?: AnalyticsProperties<N>; context?: AnalyticsContext },
  ): void
}

const DEFAULT_THROTTLE_MS = 30_000

/**
 * Creates the one analytics entry point the application uses.
 *
 * THE TWO PROPERTIES THAT MATTER, AND HOW THEY ARE GUARANTEED
 *
 * 1. `track()` NEVER THROWS AND NEVER RETURNS A PROMISE.
 *    It returns void. There is nothing for a caller to await, so no component
 *    can accidentally block a render or an event handler on analytics, and no
 *    `await track(...)` can turn a failed event into a failed booking (§19,
 *    §14). Validation errors are caught, transport rejections are caught, and
 *    a transport that throws synchronously is caught too.
 *
 * 2. THERE IS EXACTLY ONE OF THESE.
 *    No component calls `supabase.rpc('track_analytics_event')` directly.
 *    That is what makes the event contract enforceable at all: adding an event
 *    means adding it to `events.ts`, which means adding it to the database
 *    taxonomy, which means the reports know about it.
 */
export function createAnalyticsClient(options: AnalyticsClientOptions): AnalyticsClient {
  const {
    transport,
    origin,
    onError,
    getSessionId,
    getLocale,
    now = () => Date.now(),
    throttleMs = DEFAULT_THROTTLE_MS,
  } = options

  const lastSent = new Map<string, number>()

  function report(reason: string, error?: unknown): void {
    try {
      onError?.(reason, error)
    } catch {
      // An onError that itself throws must not escape either. This is the last
      // line of the "analytics never breaks the product" guarantee.
    }
  }

  function track<N extends AnalyticsClientEventName>(
    name: N,
    input: { properties?: AnalyticsProperties<N>; context?: AnalyticsContext } = {},
  ): void {
    try {
      const built = buildAnalyticsCall(
        name,
        {
          properties: (input.properties ?? {}) as AnalyticsProperties<N>,
          context: input.context,
        },
        {
          origin,
          sessionId: getSessionId?.() ?? null,
          locale: getLocale?.() ?? null,
        },
      )

      if (!built.ok) {
        report(built.reason)
        return
      }

      const key = analyticsThrottleKey(built.args)
      const at = now()
      const previous = lastSent.get(key)

      if (previous !== undefined && at - previous < throttleMs) {
        // Not an error. A remount, a re-render or a back-navigation reporting
        // the same view again is expected, and §13 asks that it not inflate
        // the count.
        return
      }

      lastSent.set(key, at)

      // Bound the map. Without this a long marketplace session accumulates one
      // entry per result viewed and never releases them.
      if (lastSent.size > 256) {
        for (const [k, t] of lastSent) {
          if (at - t >= throttleMs) lastSent.delete(k)
        }
      }

      // Fire and forget, deliberately. The result is never awaited by a caller
      // and a rejection is swallowed here rather than becoming an unhandled
      // rejection in the console of a customer's browser.
      void Promise.resolve()
        .then(() => transport(built.args))
        .catch((error: unknown) => {
          report(`analytics transport failed for ${String(name)}`, error)
        })
    } catch (error) {
      report(`analytics threw for ${String(name)}`, error)
    }
  }

  return { track }
}

/**
 * A client that does nothing, for tests and for any render path that has no
 * provider above it. Returning this rather than throwing is what lets a
 * component call `useAnalytics()` unconditionally.
 */
export const NOOP_ANALYTICS_CLIENT: AnalyticsClient = {
  track: () => {},
}
