/**
 * The analytics module's public surface.
 *
 * Components import from `@/lib/analytics` and nothing deeper. Keeping the
 * entry point narrow is what makes "no random tracking RPC calls scattered
 * through components" (§19) checkable: there is one import path, one hook and
 * one typed event registry behind it.
 */

export {
  ANALYTICS_CLIENT_EVENTS,
  ANALYTICS_ORIGINS,
  analyticsThrottleKey,
  buildAnalyticsCall,
  type AnalyticsBuildResult,
  type AnalyticsClientEventName,
  type AnalyticsContext,
  type AnalyticsEnvelope,
  type AnalyticsOrigin,
  type AnalyticsProperties,
  type AnalyticsRpcArgs,
} from './events'

export {
  createAnalyticsClient,
  NOOP_ANALYTICS_CLIENT,
  type AnalyticsClient,
  type AnalyticsClientOptions,
  type AnalyticsTransport,
} from './client'

export { getAnalyticsSessionId, resetAnalyticsSessionId } from './session'

export { AnalyticsProvider, useAnalytics, useTrackView } from './analytics-context'
