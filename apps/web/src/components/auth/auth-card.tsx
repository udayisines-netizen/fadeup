import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Container } from '@/components/ui/container'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface AuthCardProps {
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  /** `lg` for the professional application, which is a real form rather than three fields. */
  size?: 'sm' | 'lg'
  /**
   * Context marker above the title. Customer and pro auth share FadeUp's
   * shell deliberately — same brand — so the badge is what makes "this is
   * the professional entrance" unmistakable at a glance.
   */
  badge?: string
}

/** Shared centered-card shell for the unauthenticated auth screens. */
export function AuthCard({ title, subtitle, children, footer, size = 'sm', badge }: AuthCardProps) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-paper-50 py-12">
      <Container size={size === 'lg' ? 'md' : 'sm'}>
        <div className="mb-8 text-center">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center text-lg font-semibold text-ink-950"
          >
            FadeUp
          </Link>
        </div>
        <Card elevated className="p-6 sm:p-8">
          <div className="mb-6">
            {badge ? (
              <Badge variant="accent" className="mb-3">
                {badge}
              </Badge>
            ) : null}
            <h1 className="text-xl font-semibold text-ink-950">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm text-ink-500">{subtitle}</p> : null}
          </div>
          {children}
        </Card>
        {footer ? <div className="mt-6 text-center text-sm text-ink-500">{footer}</div> : null}
      </Container>
    </main>
  )
}
