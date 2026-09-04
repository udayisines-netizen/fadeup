import { QueryClient } from '@tanstack/react-query'

/**
 * The single app-wide TanStack Query client (mounted once in app/providers).
 * Same defaults the retained /platform code was tuned against — one cache
 * serves both the legacy platform pages and every V2 feature.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})
