import type { ReactNode } from 'react'
import { RealtimeValue } from '@/components/ui/realtime-value'
import { cn } from '@/lib/cn'

/**
 * A number worth looking at.
 *
 * The hierarchy is fixed and deliberate: VALUE, then LABEL, then optional
 * CONTEXT. Not label-then-value. A professional glancing at this from across
 * the room reads the figure first and only then asks what it is — reversing
 * that is what makes most SaaS dashboards feel like forms.
 *
 * There is NO delta prop. The references show "+18% vs hier" on every tile, and
 * FadeUp does not query yesterday. A comparison the product cannot compute is
 * the easiest lie in a dashboard to tell and the hardest for a user to catch,
 * so `context` takes real text or nothing at all.
 */

const TONES = {
  neutral: 'text-ink-950',
  accent: 'text-accent-600',
  warning: 'text-warning-600',
  danger: 'text-danger-600',
  /** For a zero that is GOOD news — no no-shows should not shout. */
  quiet: 'text-ink-300',
} as const

export type MetricTone = keyof typeof TONES

export function Metric({
  value,
  label,
  context,
  icon,
  tone = 'neutral',
  className,
  realtimeKey,
}: {
  value: ReactNode
  label: string
  /** Real supporting text only. Never an invented comparison. */
  context?: ReactNode
  icon?: ReactNode
  tone?: MetricTone
  className?: string
  /**
   * The comparison key for the realtime highlight (§20). Deliberately separate
   * from `value`, which is formatted output: comparing "€1,240.00" would make
   * a locale change or a plain re-render look like new data. Omit it and the
   * metric never highlights, which is right for anything not actually live.
   */
  realtimeKey?: string | number
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      {icon ? (
        <span
          className="mb-1 inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent-100 text-accent-600"
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <span className={cn('text-2xl font-semibold leading-none tracking-tight tabular-nums', TONES[tone])}>
        {realtimeKey === undefined ? value : <RealtimeValue value={realtimeKey}>{value}</RealtimeValue>}
      </span>
      {/* text-pretty stops a two-word label orphaning its second word, which
          happens constantly once these are translated into German. */}
      <span className="text-pretty text-xs leading-snug text-ink-500">{label}</span>
      {context ? <span className="text-pretty text-xs text-ink-300">{context}</span> : null}
    </div>
  )
}

/**
 * The desktop KPI tile — a Metric with its own surface.
 *
 * Mobile uses bare `Metric`s divided by whitespace instead of boxes: four
 * bordered cards on a 375px screen is four cramped boxes, whereas four columns
 * of numbers on one surface reads instantly. Same data, different container,
 * which is the whole argument for keeping Metric and MetricTile separate.
 */
export function MetricTile({
  className,
  ...props
}: Parameters<typeof Metric>[0] & { className?: string }) {
  return (
    <div className={cn('rounded-lg border border-border bg-paper-0 p-4', className)}>
      <Metric {...props} />
    </div>
  )
}

/** The mobile strip: one surface, columns separated by rules rather than gaps. */
export function MetricStrip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-y-5 rounded-lg border border-border bg-paper-0 p-4',
        'sm:grid-cols-4 sm:gap-y-0 sm:divide-x sm:divide-border rtl:sm:divide-x-reverse',
        className,
      )}
    >
      {children}
    </div>
  )
}
