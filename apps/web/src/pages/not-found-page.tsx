import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold text-neutral-900">Page not found</h1>
      <Link to="/" className="text-sm font-medium text-neutral-900 underline">
        Back home
      </Link>
    </main>
  )
}
