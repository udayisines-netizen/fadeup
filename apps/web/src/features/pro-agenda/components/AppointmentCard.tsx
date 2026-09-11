import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import { formatDateTime, formatMoney } from '@/shared/lib/format'
import { IconCheck, IconError, IconPending } from '@/shared/ui/icons'
import type { AgendaAppointmentRow } from '@/features/pro-agenda/api/agenda'

/**
 * OS-1 — LE langage visuel du créneau (question laissée ouverte par le
 * contrat P1PRO §14.1, tranchée ici) :
 *
 * - une CARTE bordée (`--fu-border-strong`), fond `--fu-surface`, rayon
 *   contrôle 8 — jamais d'ombre (invariant pro) ;
 * - une BARRE d'état inline-start de 3 px : vert accent = confirmé, ambre
 *   = en attente (demande), neutre = terminé, rouge = chevauchement forcé ;
 * - la couleur n'est JAMAIS seule : un badge texte + icône l'accompagne
 *   (« En attente », « Terminé », « Forcé », « Absent ») ;
 * - le nom en 14 px semi-gras, l'horaire en Geist Mono, le prix en mono
 *   SEULEMENT si le rôle voit le revenu (sinon rien — pas de « — ») ;
 * - sous 44 px de haut (15 min), une seule ligne : nom + heure.
 */

export type CardTone = 'confirmed' | 'pending' | 'completed' | 'forced' | 'no_show'

export function toneOf(row: Pick<AgendaAppointmentRow, 'status' | 'overlap_forced_at'>): CardTone {
  if (row.overlap_forced_at && (row.status === 'confirmed' || row.status === 'pending')) return 'forced'
  if (row.status === 'pending') return 'pending'
  if (row.status === 'completed') return 'completed'
  if (row.status === 'no_show') return 'no_show'
  return 'confirmed'
}

const BAR_CLASS: Record<CardTone, string> = {
  confirmed: 'bg-[var(--fu-accent)]',
  pending: 'bg-[var(--fu-state-warn)]',
  completed: 'bg-[var(--fu-border-strong)]',
  forced: 'bg-[var(--fu-state-danger)]',
  no_show: 'bg-[var(--fu-state-danger)]',
}

export function StatusBadge({ tone, size = 'sm' }: { tone: CardTone; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('v2')
  if (tone === 'confirmed') return null
  const label =
    tone === 'pending'
      ? t('pro.agenda.card.pending')
      : tone === 'completed'
        ? t('pro.agenda.card.completed')
        : tone === 'forced'
          ? t('pro.agenda.card.forced')
          : t('pro.agenda.card.noShow')
  const Icon = tone === 'pending' ? IconPending : tone === 'completed' ? IconCheck : IconError
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-control)] border px-1.5 font-medium leading-4',
        size === 'sm' ? 'text-fu-xs' : 'text-fu-sm py-0.5',
        tone === 'pending' && 'border-[var(--fu-state-warn)] text-[var(--fu-text-primary)]',
        (tone === 'forced' || tone === 'no_show') && 'border-[var(--fu-state-danger)] text-[var(--fu-text-primary)]',
        tone === 'completed' && 'border-[var(--fu-border)] text-[var(--fu-text-secondary)]',
      )}
    >
      <Icon aria-hidden="true" className="size-3" />
      {label}
    </span>
  )
}

export interface AppointmentCardProps {
  row: AgendaAppointmentRow
  timezone: string
  seesRevenue: boolean
  /** Mode « grille jour » (absolu, hauteur = durée) ou « puce semaine » (rangée). */
  variant: 'grid' | 'chip'
  /** Hauteur réelle en px (variant grid) — décide du nombre de lignes. */
  height?: number
  draggable: boolean
  dragging?: boolean
  animateToken?: string
  onOpen: (row: AgendaAppointmentRow) => void
  /**
   * « Terminé » EN UN GESTE, sur la carte (OS-1 §3, le geste le plus
   * fréquent de la journée) : rendu seulement si fourni — le parent décide
   * (rôle, statut confirmé, rendez-vous commencé). La fiche reste le chemin
   * pour tout le reste.
   */
  onComplete?: (row: AgendaAppointmentRow) => void
  onPointerDown?: (event: React.PointerEvent<HTMLElement>) => void
  style?: React.CSSProperties
  className?: string
}

export function AppointmentCard({
  row,
  timezone,
  seesRevenue,
  variant,
  height,
  draggable,
  dragging = false,
  animateToken,
  onOpen,
  onComplete,
  onPointerDown,
  style,
  className,
}: AppointmentCardProps) {
  const { t, i18n } = useTranslation('v2')
  const tone = toneOf(row)
  const time = `${formatDateTime(row.starts_at, timezone, 'time', i18n.language)}–${formatDateTime(row.ends_at, timezone, 'time', i18n.language)}`
  const compact = variant === 'grid' && (height ?? 0) < 44
  const dimmed = tone === 'completed' || tone === 'no_show'
  const name = row.customer_name || row.service_name || ''
  const price = seesRevenue && row.price_cents !== null ? formatMoney(row.price_cents, row.currency, i18n.language) : null
  const quickComplete = onComplete && !compact && (
    <button
      type="button"
      data-testid="agenda-quick-complete"
      aria-label={t('pro.agenda.card.completeNow', { name })}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onComplete(row)
      }}
      className={cn(
        'absolute end-1 z-10 flex w-11 items-center justify-center rounded-[var(--radius-control)]',
        'bg-[var(--fu-accent)] text-[var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]',
        // Tactile : toujours visible. Souris (≥ 1024) : au survol ou au focus
        // de la carte — sans transition (le survol d'une ligne ne s'anime pas).
        'lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100',
        variant === 'grid' ? 'inset-y-0.5' : 'inset-y-0.5',
      )}
    >
      <IconCheck aria-hidden="true" className="size-5" />
    </button>
  )

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="agenda-appointment"
      data-appointment-id={row.id}
      data-status={row.status}
      data-tone={tone}
      data-barber-id={row.barber_id ?? ''}
      aria-label={t('pro.agenda.card.open', { name })}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(row)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(row)
        }
      }}
      onPointerDown={draggable ? onPointerDown : undefined}
      onContextMenu={draggable ? (event) => event.preventDefault() : undefined}
      style={style}
      className={cn(
        'group relative overflow-hidden rounded-[var(--radius-control)] border bg-[var(--fu-surface)] text-start',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--fu-focus)]',
        tone === 'forced' ? 'border-[var(--fu-state-danger)]' : 'border-[var(--fu-border-strong)]',
        variant === 'grid' ? 'absolute ps-2.5 pe-1.5 py-1' : 'flex min-h-11 w-full items-center gap-2 ps-3 pe-2 py-1.5',
        draggable && 'cursor-grab select-none',
        dragging && 'opacity-45',
        // Un seul jeton par événement : arrivée = montée, changement = flash
        // (les deux règles CSS écrivent `animation`, la dernière gagnerait).
        animateToken?.startsWith('in:') ? 'fu-rise-in' : animateToken ? 'fu-update-flash' : undefined,
        className,
      )}
    >
      <span aria-hidden="true" className={cn('absolute inset-y-0 start-0 w-[3px]', BAR_CLASS[tone])} />
      {variant === 'chip' ? (
        <>
          <span className="w-12 shrink-0 font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]">
            {formatDateTime(row.starts_at, timezone, 'time', i18n.language)}
          </span>
          <span className={cn('min-w-0 flex-1 truncate text-fu-sm font-semibold', dimmed ? 'text-[var(--fu-text-secondary)]' : 'text-[var(--fu-text-primary)]')}>
            {name}
            {row.service_name && <span className="font-normal text-[var(--fu-text-secondary)]"> · {row.service_name}</span>}
          </span>
          <StatusBadge tone={tone} />
        </>
      ) : compact ? (
        <p className="flex items-center gap-2 truncate text-fu-xs leading-4">
          <span className={cn('truncate font-semibold', dimmed ? 'text-[var(--fu-text-secondary)]' : 'text-[var(--fu-text-primary)]')}>{name}</span>
          <span className="shrink-0 font-fu-mono tabular-nums text-[var(--fu-text-secondary)]">{time}</span>
          <StatusBadge tone={tone} />
        </p>
      ) : (
        <>
          <p className="flex items-start justify-between gap-2">
            <span className={cn('min-w-0 truncate text-fu-sm font-semibold leading-5', dimmed ? 'text-[var(--fu-text-secondary)]' : 'text-[var(--fu-text-primary)]')}>
              {name}
            </span>
            <StatusBadge tone={tone} />
          </p>
          <p className="truncate font-fu-mono text-fu-xs tabular-nums leading-4 text-[var(--fu-text-secondary)]">{time}</p>
          {(height ?? 0) >= 64 && (
            <p className="flex items-baseline justify-between gap-2 truncate text-fu-xs leading-4 text-[var(--fu-text-secondary)]">
              <span className="truncate">{row.service_name}</span>
              {price && <span className="shrink-0 font-fu-mono tabular-nums" data-testid="agenda-price">{price}</span>}
            </p>
          )}
        </>
      )}
      {quickComplete}
    </div>
  )
}
