import { Component, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'

interface ErrorBoundaryProps extends WithTranslation {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * Un ErrorBoundary par shell : AUCUN écran blanc possible. L'erreur est
 * loggée (pas avalée) et l'utilisateur garde une action.
 */
class ShellErrorBoundaryInner extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  override componentDidCatch(error: unknown, info: unknown): void {
    // Volontairement bruyant en console : un boundary silencieux cache des bugs.
    console.error('[shell-error-boundary]', error, info)
  }

  override render(): ReactNode {
    const { t } = this.props
    if (this.state.hasError) {
      return (
        <main className="flex min-h-dvh items-center justify-center bg-[var(--fu-canvas)]">
          <EmptyState
            title={t('errors.boundary.title', { ns: 'v2' })}
            description={t('errors.boundary.description', { ns: 'v2' })}
            action={
              <Button variant="primary" onClick={() => window.location.reload()}>
                {t('errors.boundary.reload', { ns: 'v2' })}
              </Button>
            }
          />
        </main>
      )
    }
    return this.props.children
  }
}

export const ShellErrorBoundary = withTranslation('v2')(ShellErrorBoundaryInner)
