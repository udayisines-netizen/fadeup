import { useTranslation } from 'react-i18next'
import { DEFAULT_RADIUS_KM, type SearchState } from '@/features/discovery/lib/searchParams'
import { SORT_OPTIONS } from '@/shared/lib/searchRanking'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Switch } from '@/shared/ui/Switch'

/**
 * F3 — le contenu des filtres, UNIQUE pour les deux contenants : feuille
 * plein écran sous 768 px, panneau latéral au-dessus (`Sheet` de P1b) ou rail
 * desktop. Chaque changement s'applique immédiatement à l'URL — l'état vit
 * là-bas, pas ici (retour arrière et partage fonctionnent pendant qu'on
 * filtre).
 */

const RADIUS_CHOICES = [5, DEFAULT_RADIUS_KM, 25, 50] as const

export interface FiltersPanelProps {
  state: SearchState
  onChange: (next: Partial<SearchState>) => void
  onReset: () => void
}

function parsePrice(raw: string): number | null {
  if (raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

export function FiltersPanel({ state, onChange, onReset }: FiltersPanelProps) {
  const { t } = useTranslation('v2')
  const hasPoint = state.latitude !== null && state.longitude !== null

  return (
    <div className="flex flex-col gap-5" data-testid="filters-panel">
      <Switch
        label={t('discovery.filters.openNow')}
        checked={state.openNow}
        onCheckedChange={(openNow) => onChange({ openNow })}
      />
      <Switch
        label={t('discovery.filters.availableNow')}
        checked={state.availableNow}
        onCheckedChange={(availableNow) => onChange({ availableNow })}
      />

      {/* Le rayon n'a de sens qu'autour d'un point réel. */}
      {hasPoint && (
        <Select
          label={t('discovery.filters.radius')}
          value={String(state.radiusKm)}
          onValueChange={(value) => onChange({ radiusKm: Number(value) })}
          options={RADIUS_CHOICES.map((km) => ({
            value: String(km),
            label: t('discovery.filters.radiusKm', { km }),
          }))}
        />
      )}

      {/* Champs non contrôlés, re-montés quand la valeur d'URL change (clé) :
          le tapé ne pousse dans l'URL qu'au blur/Entrée, jamais par frappe. */}
      <Input
        key={`service-${state.service}`}
        label={t('discovery.filters.service')}
        placeholder={t('discovery.filters.servicePlaceholder')}
        defaultValue={state.service}
        onBlur={(event) => onChange({ service: event.target.value.trim() })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onChange({ service: (event.target as HTMLInputElement).value.trim() })
        }}
      />

      <div className="grid grid-cols-2 gap-3">
        <Input
          key={`pmin-${state.minPrice ?? ''}`}
          label={t('discovery.filters.priceMin')}
          inputMode="numeric"
          suffix="€"
          defaultValue={state.minPrice ?? ''}
          onBlur={(event) => onChange({ minPrice: parsePrice(event.target.value) })}
        />
        <Input
          key={`pmax-${state.maxPrice ?? ''}`}
          label={t('discovery.filters.priceMax')}
          inputMode="numeric"
          suffix="€"
          defaultValue={state.maxPrice ?? ''}
          onBlur={(event) => onChange({ maxPrice: parsePrice(event.target.value) })}
        />
      </div>

      <Select
        label={t('discovery.filters.sort')}
        value={state.sort}
        onValueChange={(sort) => onChange({ sort: sort as SearchState['sort'] })}
        options={SORT_OPTIONS
          /* « Le plus proche » sans point de recherche est un contrôle sans
             effet (aucune distance n'existe) : il n'est pas proposé. */
          .filter((option) => option !== 'nearest' || hasPoint)
          .map((option) => ({
            value: option,
            label: t(`discovery.sort.${option}`),
          }))}
      />

      <Button variant="tertiary" onClick={onReset} data-testid="filters-reset">
        {t('discovery.filters.reset')}
      </Button>
    </div>
  )
}
