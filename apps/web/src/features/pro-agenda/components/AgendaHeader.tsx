import { useTranslation } from 'react-i18next'
import { cn } from '@/shared/lib/cn'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { IconButton } from '@/shared/ui/IconButton'
import { Popover } from '@/shared/ui/Popover'
import { SegmentedControl } from '@/shared/ui/SegmentedControl'
import { Select } from '@/shared/ui/Select'
import { Switch } from '@/shared/ui/Switch'
import { IconBook, IconChevronLeft, IconChevronRight, IconTeam } from '@/shared/ui/icons'
import { Money } from '@/shared/ui/Money'
import { zonedDayStart, type DayKey } from '@/features/pro-agenda/lib/time'

/**
 * OS-1 — l'en-tête de l'agenda : la date (navigation sans animation), la
 * vue, le sélecteur de barber (essentiel en mobile), les deux actions, et
 * — pour qui voit le revenu — le revenu calculé du jour en secondaire.
 *
 * Le sélecteur est un filtre MULTIPLE en desktop (puces : limiter les
 * barbers côte à côte — la réponse à la tension aération / ressources) et
 * un Select UNIQUE en mobile. Absent en solo (aucune entrée d'équipe).
 * Le propriétaire règle, depuis la liste d'équipe, qui voit le revenu.
 */
export type AgendaView = 'day' | 'week'

export interface AgendaHeaderProps {
  view: AgendaView
  dayKey: DayKey
  weekDays: DayKey[]
  timezone: string
  barbers: OrganizationBarber[]
  /** Barbers affichés (desktop : plusieurs ; mobile : un seul). */
  selected: string[]
  isSolo: boolean
  isMobile: boolean
  /** Le sélecteur de barber (comptoir) — un barber salarié n'a que le sien. */
  canPickBarber: boolean
  canCreate: boolean
  canBlock: boolean
  canSetRevenue: boolean
  revenue: { cents: number; currency: string; completed: number } | null
  onViewChange: (view: AgendaView) => void
  onNavigate: (direction: -1 | 1) => void
  onToday: () => void
  onSelectionChange: (ids: string[]) => void
  onCreate: () => void
  onBlock: () => void
  onToggleRevenue: (barber: OrganizationBarber, visible: boolean) => void
}

export function AgendaHeader({
  view,
  dayKey,
  weekDays,
  timezone,
  barbers,
  selected,
  isSolo,
  isMobile,
  canPickBarber,
  canCreate,
  canBlock,
  canSetRevenue,
  revenue,
  onViewChange,
  onNavigate,
  onToday,
  onSelectionChange,
  onCreate,
  onBlock,
  onToggleRevenue,
}: AgendaHeaderProps) {
  const { t, i18n } = useTranslation('v2')
  const noon = (key: DayKey) => new Date(zonedDayStart(key, timezone).getTime() + 43_200_000)
  const dayTitle = new Intl.DateTimeFormat(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).format(noon(dayKey))
  const firstWeekDay = weekDays[0] ?? dayKey
  const lastWeekDay = weekDays[6] ?? dayKey
  const weekTitle = `${new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(noon(firstWeekDay))} – ${new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }).format(noon(lastWeekDay))}`

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) return
      onSelectionChange(selected.filter((s) => s !== id))
    } else {
      onSelectionChange([...selected, id])
    }
  }

  return (
    <header className="flex flex-col gap-3" data-testid="agenda-header">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton aria-label={t('pro.agenda.nav.previous')} variant="outline" onClick={() => onNavigate(-1)} data-testid="agenda-prev">
            <IconChevronLeft className="rtl:-scale-x-100" />
          </IconButton>
          <IconButton aria-label={t('pro.agenda.nav.next')} variant="outline" onClick={() => onNavigate(1)} data-testid="agenda-next">
            <IconChevronRight className="rtl:-scale-x-100" />
          </IconButton>
          <Button variant="tertiary" size="sm" onClick={onToday} data-testid="agenda-today">
            {t('pro.agenda.nav.today')}
          </Button>
        </div>
        <SegmentedControl
          label={t('pro.agenda.view.label')}
          value={view}
          onValueChange={(next) => onViewChange(next as AgendaView)}
          options={[
            { value: 'day', label: t('pro.agenda.view.day') },
            { value: 'week', label: t('pro.agenda.view.week') },
          ]}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-fu-xl font-semibold capitalize text-[var(--fu-text-primary)] lg:text-fu-2xl" data-testid="agenda-title">
            {view === 'day' ? dayTitle : weekTitle}
          </h1>
          {revenue && (
            <p className="mt-0.5 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="agenda-revenue">
              <span className="font-fu-mono text-fu-base tabular-nums text-[var(--fu-text-primary)]">
                <Money cents={revenue.cents} currency={revenue.currency} />
              </span>{' '}
              · {t('pro.agenda.revenue.label')} · {t('pro.agenda.revenue.hint', { count: revenue.completed })}
            </p>
          )}
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          {canBlock && (
            <Button variant="secondary" onClick={onBlock} data-testid="agenda-block-button" className="flex-1 sm:flex-none">
              {t('pro.agenda.actions.block')}
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" iconStart={<IconBook />} onClick={onCreate} data-testid="agenda-create-button" className="flex-[1.4] sm:flex-none">
              {t('pro.agenda.actions.create')}
            </Button>
          )}
        </div>
      </div>

      {!isSolo && canPickBarber && barbers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" data-testid="agenda-barber-picker">
          {isMobile ? (
            <Select
              label={t('pro.agenda.barbers.label')}
              value={selected[0] ?? ''}
              onValueChange={(next) => onSelectionChange([next])}
              options={barbers.map((b) => ({ value: b.id, label: b.display_name }))}
              className="min-w-0 flex-1"
            />
          ) : (
            <>
              <Chip selected={selected.length === barbers.length} onClick={() => onSelectionChange(barbers.map((b) => b.id))} data-testid="agenda-barber-all">
                {t('pro.agenda.barbers.all')}
              </Chip>
              {barbers.map((barber) => (
                <Chip key={barber.id} selected={selected.includes(barber.id)} onClick={() => toggle(barber.id)} data-testid="agenda-barber-chip" data-barber-id={barber.id}>
                  {barber.display_name}
                </Chip>
              ))}
              <span className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.agenda.barbers.shown', { count: selected.length })}</span>
            </>
          )}
          {canSetRevenue && (
            <Popover
              align="end"
              trigger={
                <IconButton aria-label={t('pro.agenda.barbers.choose')} variant="outline" data-testid="agenda-team-button">
                  <IconTeam />
                </IconButton>
              }
            >
              <div className="flex flex-col gap-2" data-testid="agenda-team-popover">
                <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.agenda.barbers.revenueHint')}</p>
                {barbers.map((barber) => (
                  <div key={barber.id} className={cn('flex flex-col border-t border-[var(--fu-border)] pt-2')}>
                    <span className="text-fu-sm font-semibold">{barber.display_name}</span>
                    {barber.membership_id && barber.membership_role === 'barber' ? (
                      <Switch
                        label={t('pro.agenda.barbers.revenueToggle')}
                        checked={barber.can_view_revenue}
                        onCheckedChange={(next) => onToggleRevenue(barber, next)}
                      />
                    ) : (
                      <span className="text-fu-xs text-[var(--fu-text-secondary)]">
                        {barber.membership_id ? '' : t('pro.agenda.barbers.noAccount')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Popover>
          )}
        </div>
      )}
      <p className="sr-only">{t('pro.agenda.grid.instructions')}</p>
    </header>
  )
}
