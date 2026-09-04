import { Link } from 'react-router-dom'
import { cn } from '@/shared/lib/cn'
import { IconChevronRight } from '@/shared/ui/icons'

interface RowBaseProps {
  /** Zone de tête : avatar ou média. */
  leading?: React.ReactNode
  /** Ligne d'identité — le contenu principal, typographie dominante. */
  title: React.ReactNode
  /** Métadonnées secondaires sous le titre. */
  subtitle?: React.ReactNode
  /** Zone de fin : prix, état, action. */
  trailing?: React.ReactNode
  /** Chevron directionnel (retourné en RTL par la logique CSS). */
  chevron?: boolean
  className?: string
  children?: React.ReactNode
}

type RowProps = RowBaseProps &
  (
    | { as?: 'div' }
    | { as: 'link'; to: string; 'aria-label'?: string }
    | ({ as: 'button' } & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'aria-label'>)
  )

/**
 * LA primitive centrale de la direction A : une rangée à filet fin — pas une
 * carte à ombre. Elle porte l'essentiel des listes du produit (résultats de
 * recherche, services, réservations, réglages). La hiérarchie vient du
 * filet (`--fu-border`), de l'échelle typographique et de l'espace.
 */
export function Row(props: RowProps) {
  const { leading, title, subtitle, trailing, chevron = false, className, children } = props

  const inner = (
    <>
      {leading != null && <div className="flex shrink-0 items-center">{leading}</div>}
      <div className="min-w-0 flex-1">
        <div className="truncate text-fu-base font-semibold text-[var(--fu-text-primary)]">{title}</div>
        {subtitle != null && <div className="mt-0.5 truncate text-fu-sm text-[var(--fu-text-secondary)]">{subtitle}</div>}
        {children}
      </div>
      {trailing != null && <div className="flex shrink-0 items-center gap-2">{trailing}</div>}
      {chevron && <IconChevronRight aria-hidden="true" className="size-4 shrink-0 text-[var(--fu-text-tertiary)] rtl:-scale-x-100" />}
    </>
  )

  const base = cn(
    'flex w-full min-h-14 items-center gap-3 border-b border-[var(--fu-border)] bg-[var(--fu-surface)] px-4 py-3 text-start',
    className,
  )
  const interactive = cn(
    base,
    'transition-colors duration-[var(--fu-dur-instant)] ease-[var(--fu-ease)] hover:bg-[var(--fu-surface-subtle)]',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fu-focus)]',
  )

  if (props.as === 'link') {
    return (
      <Link to={props.to} aria-label={props['aria-label']} className={interactive}>
        {inner}
      </Link>
    )
  }
  if (props.as === 'button') {
    return (
      <button
        type="button"
        onClick={props.onClick}
        disabled={props.disabled}
        aria-label={props['aria-label']}
        className={cn(interactive, 'disabled:cursor-not-allowed disabled:opacity-45')}
      >
        {inner}
      </button>
    )
  }
  return <div className={base}>{inner}</div>
}
