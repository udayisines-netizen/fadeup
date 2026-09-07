import { MutationCache, QueryClient } from '@tanstack/react-query'
import { reportError } from '@/shared/observability/errorReporting'

/**
 * The single app-wide TanStack Query client (mounted once in app/providers).
 * Same defaults the retained /platform code was tuned against — one cache
 * serves both the legacy platform pages and every V2 feature.
 *
 * X1 — every mutation failure is reported centrally: a mutation is a user
 * action that did not take effect (booking, cancellation, profile edit), and
 * until now it left no trace anywhere. The component-level onError handlers
 * (toasts, form errors) still run; this only adds the report.
 */
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error) => {
      reportError(error, 'mutation')
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})
