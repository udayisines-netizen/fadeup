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
        <div className="flex min-w-0 items-start gap-6 sm:items-center">
          <div className="shrink-0">{brand}</div>
          {/*
            The link row scrolls sideways rather than pushing the page wider.
            Without this, adding one nav item silently breaks every page under
            the shell on a phone — the whole document gains a horizontal
            scrollbar, not just the nav. Negative margin + padding keeps the
            focus ring of the first and last link from being clipped.

            PLAT-2 — MAIS IL NE DÉFILE PLUS SUR GRAND ÉCRAN, IL PASSE À LA
            LIGNE. La barre de défilement de cette rangée est MASQUÉE
            (`scrollbar-width: none`) : quand la console est passée de huit à
            treize entrées, les cinq dernières — dont « Team » et « Audit
            log » — sont devenues invisibles sur un écran de 1440 px, SANS LE
            MOINDRE INDICE qu'elles existaient encore. Mesuré : le conteneur
            est plafonné à 1024 px, la rangée en demandait 1059.
            Le défilement reste le comportement du téléphone, où l'espace
            manque de toute façon et où le geste est naturel ; au-delà de
            `sm`, la rangée passe à la ligne et tout redevient atteignable.
          */}
          {links ? (
            <nav className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] sm:flex-wrap sm:overflow-x-visible [&::-webkit-scrollbar]:hidden">
              {links}
            </nav>
          ) : null}
        </div>
        {actions ? <div className="flex items-center justify-between gap-3 sm:justify-end">{actions}</div> : null}
      </Container>
    </header>
  )
}
