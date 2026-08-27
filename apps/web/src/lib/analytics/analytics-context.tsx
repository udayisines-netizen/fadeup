import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { getSupabaseClient } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { normalizeLocale } from '@/lib/locale'
import { getAnalyticsSessionId } from './session'
import {
  createAnalyticsClient,
  NOOP_ANALYTICS_CLIENT,
  type AnalyticsClient,
} from './client'
import type {
  AnalyticsClientEventName,
  AnalyticsContext as AnalyticsEventContext,
  AnalyticsProperties,
} from './events'

/**
 * The React binding for the analytics client.
 *
 * This file is the ONLY place in apps/web that knows both about React and
 * about analytics. `events.ts`, `client.ts` and `session.ts` are deliberately
 * framework-free so `apps/mobile` can import them unchanged (§19) — and this
 * file is deliberately the thing mobile will NOT import, because §19 also says
 * web React components are not shared.
 */

const AnalyticsClientContext = createContext<AnalyticsClient>(NOOP_ANALYTICS_CLIENT)

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { i18n } = useTranslation()

  // The origin follows the SESSION, not the route: a signed-in customer
  // browsing a public shop page is still a customer_web visit, and reporting
  // it as public_web would make "logged-in engagement" undercount. The
  // database independently refuses public_web-only claims from signed-in
  // callers' opposite direction — an anonymous caller asserting customer_web —
  // so the two agree by construction.
  const origin = user ? 'customer_web' : 'public_web'

  const client = useMemo(
    () =>
      createAnalyticsClient({
        origin,
        transport: async (args) => {
          const supabase = getSupabaseClient()
          const { error } = await supabase.rpc('track_analytics_event', args)
          if (error) throw error
        },
        getSessionId: getAnalyticsSessionId,
        getLocale: () => normalizeLocale(i18n.language),
        onError: (reason, error) => {
          // Analytics failures are DIAGNOSTICS, never user-facing. No toast, no
          // error boundary, no retry: the server already records the rejection
          // in analytics_ingestion_rejections, which is where a broken
          // instrumentation change is meant to be noticed (§22).
          if (import.meta.env.DEV) {
            console.warn('[analytics]', reason, error)
          }
        },
      }),
    [origin, i18n.language],
  )

  return (
    <AnalyticsClientContext.Provider value={client}>
      {children}
    </AnalyticsClientContext.Provider>
  )
}

/**
 * The hook every component uses. Returns a no-op client when no provider is
 * mounted, so a component under test or rendered outside the app shell keeps
 * working — an analytics hook that threw would make analytics able to break
 * exactly the screens it is meant to measure.
 */
export function useAnalytics(): AnalyticsClient {
  return useContext(AnalyticsClientContext)
}

/**
 * Reports a view-type event once the data it describes is actually available.
 *
 * This exists because the naive `useEffect(() => track(...), [])` is wrong in
 * three ways at once on these pages: it fires before the query resolves (so
 * there is no organization id to attribute), it fires again on every
 * dependency change, and under React StrictMode it fires twice in development.
 *
 * `enabled` handles the first, the ref handles the second and third, and the
 * client's throttle catches anything that still slips past — belt, braces and
 * a third belt, because an inflated view count is not visibly wrong and
 * therefore never gets found.
 */
export function useTrackView<N extends AnalyticsClientEventName>(
  name: N,
  input: { properties: AnalyticsProperties<N>; context?: AnalyticsEventContext },
  enabled: boolean,
): void {
  const analytics = useAnalytics()
  const sent = useRef<string | null>(null)

  // Serialised so the effect depends on the CONTENT of the event rather than
  // on object identity — otherwise a new object literal on every render would
  // re-fire it every render.
  const signature = JSON.stringify({ name, ...input })

  useEffect(() => {
    if (!enabled) return
    if (sent.current === signature) return

    sent.current = signature
    analytics.track(name, input)
    // `input` and `name` are captured by `signature`; depending on them
    // directly would reintroduce the identity problem this avoids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, enabled, signature])
}
