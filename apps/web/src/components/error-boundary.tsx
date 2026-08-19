import { useTranslation } from 'react-i18next'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Container } from '@/components/ui/container'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled application error', error, info.componentStack)
  }

  render() {
    if (this.state.error) return <ErrorBoundaryFallback />
    return this.props.children
  }
}

/**
 * The fallback, as a function component so it can use the translation hook —
 * a class cannot, and `withTranslation` would wrap the boundary itself, which
 * is the one component that must keep working when everything else has failed.
 *
 * Every string carries an English defaultValue. This is the screen shown when
 * the app has already crashed; if the crash was i18next failing to load its
 * bundles, `t()` would otherwise render raw key names at the user. Degrading
 * to English is not ideal, but it is a sentence.
 */
function ErrorBoundaryFallback() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-paper-50 p-8">
      <Container size="sm" className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-2xl font-semibold text-balance text-ink-950">
          {t('common:errors.somethingWentWrong', { defaultValue: 'Something went wrong' })}
        </h1>
        <p className="text-ink-500">
          {t('common:errors.anUnexpectedErrorOccurredTry', {
            defaultValue: 'An unexpected error occurred. Try reloading the page.',
          })}
        </p>
        <Button onClick={() => window.location.reload()}>
          {t('common:action.reload', { defaultValue: 'Reload' })}
        </Button>
      </Container>
    </div>
  )
}
