import { RouterProvider } from 'react-router-dom'
import { Providers } from '@/app/providers'
import { router } from '@/app/routes'

/**
 * Composition racine : la pile de providers (legacy + V2, voir
 * app/providers.tsx) autour de LA table de routes (app/routes.tsx) — qui
 * sert à la fois la console /platform existante (verbatim) et les nouvelles
 * surfaces V2.
 */
function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  )
}

export default App
