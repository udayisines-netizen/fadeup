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
    if (this.state.error) {
      return (
        <div className="flex min-h-svh flex-col items-center justify-center bg-paper-50 p-8">
          <Container size="sm" className="flex flex-col items-center gap-4 text-center">
            <h1 className="text-2xl font-semibold text-balance text-ink-950">Something went wrong</h1>
            <p className="text-ink-500">An unexpected error occurred. Try reloading the page.</p>
            <Button onClick={() => window.location.reload()}>Reload</Button>
          </Container>
        </div>
      )
    }

    return this.props.children
  }
}
