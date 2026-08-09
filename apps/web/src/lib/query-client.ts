import { QueryClient } from '@tanstack/react-query'

/**
 * Single app-wide TanStack Query client. All Supabase reads/writes that
 * aren't one-shot Supabase Auth calls should go through this.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})
