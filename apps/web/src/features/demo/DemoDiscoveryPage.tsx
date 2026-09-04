import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useApplySurfaceTheme } from '@/shared/theme/useTheme'
import { useDiscovery, type DiscoveryRow } from '@/features/demo/api/discovery'
import { DemoFrame } from '@/features/demo/components/DemoFrame'
import { errorMessageKey } from '@/shared/data/errors'
import { Badge } from '@/shared/ui/Badge'
import { ClaimBadge } from '@/shared/ui/ClaimBadge'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { MediaFrame } from '@/shared/ui/MediaFrame'
import { Money } from '@/shared/ui/Money'
import { Row } from '@/shared/ui/Row'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { IconLocation, IconSearch } from '@/shared/ui/icons'

/**
 * Étude A — découverte client (P1c §5A).
 * La rangée à filet fin (direction A) face à des résultats RÉELS de
 * `search_public_professionals`, restriction marketplace FORCÉE
 * (`p_entity_type: 'shop'` — voir api/discovery.ts).
 * Book en vert plein ; Follow en secondaire — l'écart doit sauter aux yeux.
 */

/**
 * LA rangée de résultat (raffinée après inspection 390 px) : le prix et
 * l'état vivent DANS la colonne de contenu — un `trailing` leur volait la
 * moitié de la largeur mobile. Vignette compacte (icône seule), nom clampé
 * sur 2 lignes, l'écart Book/Follow reste immédiat.
 */
function ResultRow({ row, onBook }: { row: DiscoveryRow; onBook: () => void }) {
  const { t, i18n } = useTranslation('v2')
  const isMobileZone = row.addressLine1 === null

  return (
    <Row clampTitle leading={<MediaFrame alt="" ratio="square" compact className="w-14 shrink-0" />} title={row.organizationName}>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-fu-sm text-[var(--fu-text-secondary)]">
        <span>{row.supplyType === 'independent' ? t('demo.discovery.supplyIndependent') : t('demo.discovery.supplyBarbershop')}</span>
        <span className="inline-flex items-center gap-1">
          <IconLocation aria-hidden="true" className="size-3.5" />
          {isMobileZone ? `${t('demo.discovery.mobileZone')} — ` : null}
          {row.city}
        </span>
        {row.distanceKm !== null && (
          <span className="font-fu-mono tabular-nums">
            {new Intl.NumberFormat(i18n.language, {
              style: 'unit',
              unit: 'kilometer',
              maximumFractionDigits: 1,
            }).format(row.distanceKm)}
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {row.startingPriceCents !== null && <Money cents={row.startingPriceCents} currency="EUR" from className="text-fu-sm" />}
        <Badge variant={row.isOpenNow ? 'brand' : 'neutral'}>
          {row.isOpenNow ? t('states.opening.open') : t('states.opening.closed')}
        </Badge>
        <ClaimBadge state="unclaimed" size="sm" />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onBook}>
          {t('common.action.book')}
        </Button>
        <Button variant="secondary" size="sm">
          {t('common.action.follow')}
        </Button>
      </div>
    </Row>
  )
}

export function DemoDiscoveryPage() {
  useApplySurfaceTheme('consumer')
  const { t } = useTranslation('v2')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [openNowOnly, setOpenNowOnly] = useState(false)
  const { rows, loading, error } = useDiscovery({ query: query || undefined, openNowOnly })

  const searchPanel = (
    <div className="flex flex-col gap-3">
      <Input
        label={t('demo.discovery.searchLabel')}
        placeholder={t('demo.discovery.searchPlaceholder')}
        iconStart={<IconSearch />}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="flex flex-wrap gap-2">
        <Chip selected={openNowOnly} onClick={() => setOpenNowOnly((value) => !value)}>
          {t('demo.discovery.openNow')}
        </Chip>
      </div>
      {!loading && !error && (
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">
          {t('demo.discovery.resultCount', { count: rows.length })}
        </p>
      )}
    </div>
  )

  const list = (
    <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]">
      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : error ? (
        <EmptyState
          title={t('errors.boundary.title')}
          description={t(errorMessageKey(error))}
          action={
            <Button variant="secondary" onClick={() => window.location.reload()}>
              {t('common.action.retry')}
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        /* L'état vide de l'étude : une VRAIE recherche sans résultat. */
        <EmptyState
          title={t('demo.discovery.noResults.title')}
          description={t('demo.discovery.noResults.description')}
          action={
            <Button variant="secondary" onClick={() => setQuery('')}>
              {t('demo.discovery.noResults.action')}
            </Button>
          }
        />
      ) : (
        rows.map((row) => (
          <ResultRow
            key={row.locationId}
            row={row}
            onBook={() => navigate(`/demo/profile?org=${encodeURIComponent(row.organizationSlug)}`)}
          />
        ))
      )}
    </div>
  )

  return (
    <DemoFrame title={t('demo.discovery.title')} note={t('demo.discovery.rpcNote')}>
      {/* ≥1024 px : composition volontaire — rail de recherche + liste.
          En dessous : pile mobile. */}
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="lg:sticky lg:top-4">{searchPanel}</div>
        {list}
      </div>
      <p className="mt-3 text-fu-xs text-[var(--fu-text-secondary)]">{t('demo.controls.emptyHint')}</p>
    </DemoFrame>
  )
}
