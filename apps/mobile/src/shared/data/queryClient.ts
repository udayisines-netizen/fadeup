import { QueryClient } from '@tanstack/react-query'

/**
 * Le QueryClient unique du mobile — mêmes partis pris que le web (P1b) :
 * pas de retry agressif sur mobile (le réseau cellulaire rend les retries
 * chers), staleTime par défaut court, refetch au refocus de l'app.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 15_000,
        refetchOnReconnect: true,
      },
    },
  })
}
