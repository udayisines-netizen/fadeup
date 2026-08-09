import type { ReactNode } from 'react'
import { Container } from '@/components/ui/container'
import { cn } from '@/lib/cn'

interface NavbarProps {
  brand: ReactNode
  links?: ReactNode
  actions?: ReactNode
  className?: string
}

/** Thin top-nav shell shared by the app shell today and the marketing site later (LOT 5 owns marketing content). */
export function Navbar({ brand, links, actions, className }: NavbarProps) {
  return (
    <header className={cn('border-b border-border bg-paper-0', className)}>
      <Container
        size="lg"
        className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-6">
          {brand}
          {links ? <nav className="flex items-center gap-1">{links}</nav> : null}
        </div>
        {actions ? <div className="flex items-center justify-between gap-3 sm:justify-end">{actions}</div> : null}
      </Container>
    </header>
  )
}
