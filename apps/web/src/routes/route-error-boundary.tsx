import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { useEffect } from 'react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Container } from '@/components/ui/container'
import { Alert } from '@/components/ui/alert'
import { getErrorMessage } from '@/lib/get-error-message'
import { useTranslation } from 'react-i18next'

/**
 * The router's errorElement.
 *
 * `components/error-boundary.tsx` wraps <RouterProvider> in App.tsx, but a
 * React error boundary ABOVE the router never sees a route render error:
 * React Router catches it first and, with no errorElement configured, renders
 * its own developer screen — "Unexpected Application Error! Hey developer…"
 * — to real visitors. That is what production showed when /onboarding threw.
 *
 * So this is not a duplicate of that boundary; it is the one that actually
 * runs for route errors. The outer boundary still catches everything above
 * the router (providers, the query client, the theme bootstrap).
 *
 * It deliberately does NOT redirect. Turning an application error into a
 * silent bounce to /workspace would hide a broken route from everyone,
 * including us — the visitor would just find themselves somewhere they did
 * not ask to be, with no signal that anything failed. It shows what broke,
 * offers a way forward, and logs.
 */
export function RouteErrorBoundary() {
  const { t } = useTranslation()
  const error = useRouteError()

  useEffect(() => {
    // Same channel the outer boundary uses, so route failures do not become
    // quieter than any other unhandled error just because the router caught
    // them first.
    console.error('Unhandled route error', error)
  }, [error])

  const isNotFound = isRouteErrorResponse(error) && error.status === 404

  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : (getErrorMessage(error) ?? String(error))

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-paper-50 p-8">
      <Container size="sm" className="flex flex-col items-center gap-4 text-center">
        <Link to="/" className="text-lg font-semibold text-ink-950">
          {t('common:customerNav.fadeup')}
        </Link>

        <h1 className="text-2xl font-semibold text-balance text-ink-950">
          {isNotFound ? "We couldn't find that page" : 'Something went wrong'}
        </h1>
        <p className="text-ink-500">
          {isNotFound
            ? 'The link may be out of date.'
            : "This page didn't load properly. Nothing you'd saved is affected."}
        </p>

        {/*
          The real message, not a shrug. Someone reporting a problem can tell
          us what it said, and it is the same string console.error logged.
        */}
        {detail ? (
          <Alert variant="error" className="w-full text-start">
            {detail}
          </Alert>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Button onClick={() => window.location.reload()}>{t('common:action.reload')}</Button>
          {/*
            A full navigation rather than a client-side <Link>: the router
            state that produced this error is exactly what we do not want to
            carry into the recovery destination.
          */}
          <a href="/workspace" className={buttonVariants({ variant: 'secondary' })}>
            {t('common:errors.goToMyWorkspace')}
          </a>
          <a href="/" className={buttonVariants({ variant: 'ghost' })}>
            {t('common:nav.home')}
          </a>
        </div>
      </Container>
    </main>
  )
}
