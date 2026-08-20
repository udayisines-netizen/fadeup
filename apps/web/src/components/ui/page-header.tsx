import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The top of a page, and the top of a block within it.
 *
 * These exist so that "title, optional subtitle, optional actions on the
 * trailing edge" is decided once. Before V2 every page invented its own
 * heading row and they disagreed about type scale, spacing and whether actions
 * wrapped — which is most of why the old product read as a set of screens
 * rather than one application.
 *
 * `actions` sits on the INLINE END, so it moves to the left in Arabic without
 * any component knowing that.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        {/* text-balance keeps a long translated title from breaking with one
            word alone on the second line. */}
        <h1 className="text-balance text-2xl font-semibold tracking-tight text-ink-950">{title}</h1>
        {subtitle ? <p className="mt-1 text-pretty text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

/**
 * A block heading inside a page.
 *
 * Uppercase, tracked, small and quiet — the references use exactly this for
 * AUJOURD'HUI / FLOW DU JOUR / FILE D'ATTENTE, and it works because it labels
 * a region without competing with the data inside it. A second `<h1>`-weight
 * heading here would flatten the page's hierarchy.
 */
export function SectionHeader({
  title,
  meta,
  action,
  as: Tag = 'h2',
  className,
}: {
  title: ReactNode
  /** A count, a status, a timestamp — something true about the section. */
  meta?: ReactNode
  action?: ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Tag className="truncate text-xs font-semibold uppercase tracking-wider text-ink-500">{title}</Tag>
        {meta ? <span className="shrink-0 text-xs text-ink-300">{meta}</span> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/**
 * A panel: section header, body, and an optional footer action rail.
 *
 * The footer is separated by a rule rather than floated inside the body, which
 * is what gives the three-column operational row in the reference its rhythm —
 * three panels of different content heights still line up at the bottom.
 */
export function Panel({
  title,
  meta,
  headerAction,
  footer,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode
  meta?: ReactNode
  headerAction?: ReactNode
  footer?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('flex flex-col overflow-hidden rounded-lg border border-border bg-paper-0', className)}>
      {title ? (
        <div className="border-b border-border px-4 py-3">
          <SectionHeader title={title} meta={meta} action={headerAction} />
        </div>
      ) : null}
      <div className={cn('min-h-0 flex-1', bodyClassName ?? 'p-4')}>{children}</div>
      {footer ? <div className="border-t border-border p-3">{footer}</div> : null}
    </section>
  )
}
