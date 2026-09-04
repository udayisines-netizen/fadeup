import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import {
  IconCheck,
  IconClose,
  IconError,
  IconInfo,
  IconOffline,
  IconPending,
  IconQueue,
} from '@/shared/ui/icons'

export type FadeUpState =
  | 'bookable'
  | 'not-bookable'
  | 'available'
  | 'unavailable'
  | 'pending-request'
  | 'confirmed'
  | 'queue-open'
  | 'queue-full'
  | 'queue-closed'
  | 'called'
  | 'missed'
  | 'offline'
  | 'reconnecting'
  | 'partial-data'

export interface StateBadgeProps {
  state: FadeUpState
  size?: 'sm' | 'md'
  className?: string
}

type Tone = 'neutral' | 'positive' | 'attention' | 'danger' | 'brand' | 'live'

interface StateSpec {
  labelKey: string
  tone: Tone
  icon: React.ReactNode
}

/**
 * Chaque état a un libellé traduit, une forme (icône ou point) et un ton —
 * JAMAIS la couleur seule. Les états de file et opérationnels n'existent
 * qu'en thème Pro par usage ; leurs couleurs retombent sur des tokens
 * neutres dans les autres thèmes via des fallbacks var(), sans condition
 * dans le code.
 *
 * `pending-request` ne suggère JAMAIS une confirmation : « En attente de
 * confirmation », pas « Réservé ».
 */
const SPECS: Record<FadeUpState, StateSpec> = {
  bookable: { labelKey: 'states.booking.bookable', tone: 'positive', icon: <IconCheck aria-hidden="true" /> },
  'not-bookable': { labelKey: 'states.booking.notBookable', tone: 'neutral', icon: <IconClose aria-hidden="true" /> },
  available: { labelKey: 'states.booking.available', tone: 'positive', icon: <IconCheck aria-hidden="true" /> },
  unavailable: { labelKey: 'states.booking.unavailable', tone: 'neutral', icon: <IconClose aria-hidden="true" /> },
  'pending-request': { labelKey: 'states.booking.pendingRequest', tone: 'attention', icon: <IconPending aria-hidden="true" /> },
  confirmed: { labelKey: 'states.booking.confirmed', tone: 'positive', icon: <IconCheck aria-hidden="true" /> },
  'queue-open': { labelKey: 'states.queue.open', tone: 'live', icon: <IconQueue aria-hidden="true" /> },
  'queue-full': { labelKey: 'states.queue.full', tone: 'attention', icon: <IconQueue aria-hidden="true" /> },
  'queue-closed': { labelKey: 'states.queue.closed', tone: 'neutral', icon: <IconQueue aria-hidden="true" /> },
  called: { labelKey: 'states.queue.called', tone: 'brand', icon: <IconCheck aria-hidden="true" /> },
  missed: { labelKey: 'states.queue.missed', tone: 'danger', icon: <IconError aria-hidden="true" /> },
  offline: { labelKey: 'states.connection.offline', tone: 'neutral', icon: <IconOffline aria-hidden="true" /> },
  reconnecting: { labelKey: 'states.connection.reconnecting', tone: 'attention', icon: <IconOffline aria-hidden="true" /> },
  'partial-data': { labelKey: 'states.connection.partialData', tone: 'attention', icon: <IconInfo aria-hidden="true" /> },
}

const TONES: Record<Tone, string> = {
  neutral: 'border-[var(--fu-border)] text-[var(--fu-text-secondary)]',
  positive: 'border-transparent bg-[var(--fu-accent-soft)] text-[var(--fu-text-primary)]',
  attention:
    'border-[var(--fu-state-warn,var(--fu-border-strong))] text-[var(--fu-text-primary)]',
  danger: 'border-[var(--fu-state-danger,var(--fu-danger))] text-[var(--fu-text-primary)]',
  // « called » est un moment de marque : vert plein, texte encre (8,30:1).
  brand: 'border-transparent bg-[var(--fu-accent)] text-[var(--fu-accent-fg)] font-semibold',
  live: 'border-[var(--fu-border-strong)] text-[var(--fu-text-primary)]',
}

export function StateBadge({ state, size = 'md', className }: StateBadgeProps) {
  const { t } = useTranslation('v2')
  const spec = SPECS[state]

  return (
    <span
      data-state={state}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-0.5 font-medium',
        size === 'sm' ? 'text-fu-xs' : 'text-fu-sm',
        TONES[spec.tone],
        className,
      )}
    >
      {spec.tone === 'live' ? (
        // Le point « live » — la forme, pas la couleur, dit que c'est vivant.
        <span aria-hidden="true" className="relative inline-flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-[var(--radius-avatar)] bg-[var(--fu-accent)] opacity-60" />
          <span className="relative inline-flex size-2 rounded-[var(--radius-avatar)] bg-[var(--fu-accent)]" />
        </span>
      ) : (
        <span className={cn('inline-flex shrink-0', size === 'sm' ? '[&>svg]:size-3' : '[&>svg]:size-3.5')}>{spec.icon}</span>
      )}
      {t(spec.labelKey)}
    </span>
  )
}
