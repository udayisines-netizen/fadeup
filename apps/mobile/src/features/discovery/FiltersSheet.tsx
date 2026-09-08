import { useState } from 'react'
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/shared/ui/Sheet'
import { Button } from '@/shared/ui/Button'
import { FuText } from '@/shared/ui/Text'
import { SORT_OPTIONS, type SortOption } from '@/shared/lib/searchRanking'
import {
  DEFAULT_RADIUS_KM,
  INITIAL_SEARCH_STATE,
  RADIUS_OPTIONS,
  eurosInputToCents,
  type SearchState,
} from '@/features/discovery/searchState'
import { color, font, fontSize, radius, spacing, touchTarget } from '@/shared/theme/tokens'

/**
 * Les filtres, en FEUILLE native (M1a §8) : disponibilité réelle, distance,
 * prix, ouvert maintenant, type de service, tri. Brouillon local, appliqué
 * d'un geste — fermer sans appliquer ne change rien.
 */
export interface FiltersSheetProps {
  open: boolean
  state: SearchState
  onApply: (next: SearchState) => void
  onClose: () => void
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <FuText variant="smMedium" style={selected ? { color: color.accentText } : undefined}>
        {label}
      </FuText>
    </Pressable>
  )
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <FuText variant="body">{label}</FuText>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ true: color.accent, false: color.border }}
        thumbColor={color.surface}
        accessibilityLabel={label}
      />
    </View>
  )
}

export function FiltersSheet({ open, state, onApply, onClose }: FiltersSheetProps) {
  const { t } = useTranslation('v2')
  const [draft, setDraft] = useState<SearchState>(state)
  const [priceMinInput, setPriceMinInput] = useState('')
  const [priceMaxInput, setPriceMaxInput] = useState('')

  // La feuille repart de l'état APPLIQUÉ à chaque ouverture — ajustement
  // d'état PENDANT le rendu (motif React sanctionné), pas un effet.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setDraft(state)
      setPriceMinInput(state.priceMinCents !== null ? String(state.priceMinCents / 100) : '')
      setPriceMaxInput(state.priceMaxCents !== null ? String(state.priceMaxCents / 100) : '')
    }
  }

  const apply = () => {
    onApply({
      ...draft,
      priceMinCents: eurosInputToCents(priceMinInput),
      priceMaxCents: eurosInputToCents(priceMaxInput),
    })
    onClose()
  }

  const reset = () => {
    setDraft({
      ...INITIAL_SEARCH_STATE,
      query: draft.query,
      city: draft.city,
      point: draft.point,
      radiusKm: draft.point ? DEFAULT_RADIUS_KM : draft.radiusKm,
    })
    setPriceMinInput('')
    setPriceMaxInput('')
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('discovery.filters.title')}>
      <View style={styles.content}>
        <FuText variant="title">{t('discovery.filters.title')}</FuText>

        <ToggleRow
          label={t('discovery.filters.availableNow')}
          value={draft.availableNow}
          onChange={(availableNow) => setDraft((d) => ({ ...d, availableNow }))}
        />
        <ToggleRow
          label={t('discovery.filters.openNow')}
          value={draft.openNow}
          onChange={(openNow) => setDraft((d) => ({ ...d, openNow }))}
        />

        {draft.point ? (
          <View style={styles.group}>
            <FuText variant="smMedium" tone="secondary">
              {t('discovery.filters.radius')}
            </FuText>
            <View style={styles.chipRow}>
              {RADIUS_OPTIONS.map((km) => (
                <Chip
                  key={km}
                  label={t('discovery.filters.radiusKm', { km })}
                  selected={draft.radiusKm === km}
                  onPress={() => setDraft((d) => ({ ...d, radiusKm: km }))}
                />
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.group}>
          <FuText variant="smMedium" tone="secondary">
            {t('discovery.filters.service')}
          </FuText>
          <TextInput
            value={draft.service}
            onChangeText={(service) => setDraft((d) => ({ ...d, service }))}
            placeholder={t('discovery.filters.servicePlaceholder')}
            placeholderTextColor={color.textTertiary}
            accessibilityLabel={t('discovery.filters.service')}
            style={styles.input}
          />
        </View>

        <View style={styles.priceRow}>
          <View style={styles.priceField}>
            <FuText variant="smMedium" tone="secondary">
              {t('discovery.filters.priceMin')}
            </FuText>
            <TextInput
              value={priceMinInput}
              onChangeText={setPriceMinInput}
              keyboardType="numeric"
              placeholder="—"
              placeholderTextColor={color.textTertiary}
              accessibilityLabel={t('discovery.filters.priceMin')}
              style={[styles.input, styles.mono]}
            />
          </View>
          <View style={styles.priceField}>
            <FuText variant="smMedium" tone="secondary">
              {t('discovery.filters.priceMax')}
            </FuText>
            <TextInput
              value={priceMaxInput}
              onChangeText={setPriceMaxInput}
              keyboardType="numeric"
              placeholder="—"
              placeholderTextColor={color.textTertiary}
              accessibilityLabel={t('discovery.filters.priceMax')}
              style={[styles.input, styles.mono]}
            />
          </View>
        </View>

        <View style={styles.group}>
          <FuText variant="smMedium" tone="secondary">
            {t('discovery.filters.sort')}
          </FuText>
          <View style={styles.chipRow}>
            {SORT_OPTIONS.map((option: SortOption) => {
              // « Le plus proche » n'a pas d'objet sans point de recherche
              // (décision F3 — un tri sur une distance absente ment).
              if (option === 'nearest' && !draft.point) return null
              return (
                <Chip
                  key={option}
                  label={t(`discovery.sort.${option}`)}
                  selected={draft.sort === option}
                  onPress={() => setDraft((d) => ({ ...d, sort: option }))}
                />
              )
            })}
          </View>
        </View>

        <View style={styles.actions}>
          <Button label={t('discovery.filters.showResultsPlain')} size="lg" fullWidth onPress={apply} />
          <Button label={t('discovery.filters.reset')} variant="ghost" fullWidth onPress={reset} />
        </View>
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  content: { gap: spacing(4), paddingBottom: spacing(2) },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: touchTarget,
  },
  group: { gap: spacing(2) },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  chip: {
    minHeight: 40,
    paddingHorizontal: spacing(3.5),
    borderRadius: radius.control,
    borderWidth: 1.5,
    borderColor: color.border,
    backgroundColor: color.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipSelected: { borderColor: color.accent, backgroundColor: color.accentSoft },
  input: {
    minHeight: touchTarget,
    paddingHorizontal: spacing(3),
    borderRadius: radius.control,
    backgroundColor: color.surface,
    borderWidth: 1.5,
    borderColor: color.border,
    fontFamily: font.regular,
    fontSize: fontSize.base,
    color: color.textPrimary,
  },
  mono: { fontFamily: font.mono },
  priceRow: { flexDirection: 'row', gap: spacing(3) },
  priceField: { flex: 1, gap: spacing(2) },
  actions: { gap: spacing(1), marginTop: spacing(2) },
})
