import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import { Textarea } from '@/shared/ui/Textarea'
import { IconError } from '@/shared/ui/icons'
import type { CatalogServiceRow, ServiceCategoryRow, ServiceDraft } from '@/features/pro-catalog/api/catalog'
import { estimateNotice } from '@/features/pro-catalog/lib/estimate'
import type { CatalogPermissions } from '@/features/pro-catalog/lib/permissions'

/** Valeurs sentinelles du Select — Radix n'accepte pas la chaîne vide. */
const CATEGORY_NONE = '__none__'
const CATEGORY_NEW = '__new__'

export interface ServiceSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = création. */
  service: CatalogServiceRow | null
  categories: ServiceCategoryRow[]
  permissions: CatalogPermissions
  /** `create_service_category` est réservée à owner/manager. */
  canCreateCategory: boolean
  saving: boolean
  onSave: (draft: Omit<ServiceDraft, 'serviceId'>) => void
  onArchive: () => void
  onRestore: () => void
  onDelete: () => void
  onAssign: () => void
}

interface FieldErrors {
  name?: string
  duration?: string
  price?: string
  newCategory?: string
}

/** Centimes -> saisie en unité monétaire, sans jamais afficher un prix absent. */
function centsToInput(service: CatalogServiceRow | null): string {
  if (!service || service.price_pending) return ''
  return (service.price_cents / 100).toFixed(2)
}

function parsePrice(raw: string): number | null {
  const normalized = raw.trim().replace(',', '.')
  if (normalized === '') return null
  const value = Number(normalized)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

/**
 * OS-2 — la feuille de création/édition d'un service. Une seule feuille pour
 * les deux gestes : les mêmes champs, les mêmes gardes, un titre différent.
 *
 * Le champ PRIX n'est pas grisé pour un barber : il n'est pas rendu du tout
 * (P1PRO §0bis). Et l'écran DIT ce que la durée annoncée change encore,
 * plutôt que de laisser le professionnel croire qu'il pilote une estimation
 * que la base a déjà apprise autrement.
 */
export function ServiceSheet({
  open,
  onOpenChange,
  service,
  categories,
  permissions,
  canCreateCategory,
  saving,
  onSave,
  onArchive,
  onRestore,
  onDelete,
  onAssign,
}: ServiceSheetProps) {
  const { t } = useTranslation('v2')

  /* La saisie s'initialise UNE fois, au montage. La page monte la feuille
     avec une `key` par service : un rafraîchissement de la liste (invalidation
     TanStack, poll) ne peut donc pas écraser ce que le professionnel est en
     train de taper. */
  const [name, setName] = useState(() => service?.name ?? '')
  const [duration, setDuration] = useState(() => (service ? String(service.duration_minutes) : ''))
  const [description, setDescription] = useState(() => service?.description ?? '')
  const [category, setCategory] = useState<string>(() => service?.category_id ?? CATEGORY_NONE)
  const [newCategory, setNewCategory] = useState('')
  const [price, setPrice] = useState(() => centsToInput(service))
  const [errors, setErrors] = useState<FieldErrors>({})

  const isArchived = service?.archived_at != null

  const declaredMinutes = Number.parseInt(duration, 10)
  const notice = estimateNotice({
    sampleCount: service?.sample_count ?? 0,
    declaredWeightPercent: service?.declared_weight_percent ?? 100,
    declaredMinutes: Number.isFinite(declaredMinutes) ? declaredMinutes : 0,
    observedMinutes: service?.observed_minutes ?? null,
  })

  const categoryOptions = [
    { value: CATEGORY_NONE, label: t('pro.catalog.categoryNone') },
    ...categories.map((row) => ({ value: row.id, label: row.name })),
    ...(canCreateCategory ? [{ value: CATEGORY_NEW, label: t('pro.catalog.sheet.categoryNew') }] : []),
  ]

  const submit = () => {
    const next: FieldErrors = {}
    const trimmedName = name.trim()
    if (trimmedName === '') next.name = t('pro.catalog.errors.nameRequired')
    const minutes = Number.parseInt(duration, 10)
    if (!Number.isFinite(minutes) || minutes <= 0) next.duration = t('pro.catalog.errors.durationRequired')

    let priceCents: number | undefined
    if (permissions.canPrice) {
      const parsed = parsePrice(price)
      // Le champ est rendu, donc il est obligatoire : vider le prix d'un
      // service actif ne doit pas le laisser silencieusement inchangé — le
      // professionnel croirait avoir effacé quelque chose.
      if (parsed === null) next.price = t('pro.catalog.errors.priceRequired')
      priceCents = parsed ?? undefined
    }

    const trimmedNewCategory = newCategory.trim()
    if (category === CATEGORY_NEW && trimmedNewCategory === '') {
      next.newCategory = t('pro.catalog.errors.nameRequired')
    }

    setErrors(next)
    if (Object.keys(next).length > 0) return

    onSave({
      name: trimmedName,
      durationMinutes: minutes,
      description: description.trim() === '' ? null : description.trim(),
      categoryId: category === CATEGORY_NONE || category === CATEGORY_NEW ? null : category,
      newCategoryName: category === CATEGORY_NEW ? trimmedNewCategory : null,
      priceCents,
      isDraft: service?.price_pending ?? false,
      currentPriceCents: service && !service.price_pending ? service.price_cents : null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={service ? t('pro.catalog.sheet.editTitle') : t('pro.catalog.sheet.createTitle')}
    >
      <div className="flex flex-col gap-4">
        <Input
          label={t('pro.catalog.sheet.name')}
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          data-testid="pro-catalog-field-name"
        />

        <Input
          label={t('pro.catalog.sheet.duration')}
          type="number"
          inputMode="numeric"
          min={1}
          step={5}
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
          error={errors.duration}
          data-testid="pro-catalog-field-duration"
        />

        {/* Ce que la durée annoncée change VRAIMENT — dit, pas caché. */}
        <div
          className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4"
          data-testid="pro-catalog-estimate"
        >
          <h3 className="font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
            {t('pro.catalog.estimate.title').toLocaleUpperCase()}
          </h3>
          <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]">{t(notice.key, notice.params)}</p>
          {/* La mesure réelle, ou son absence — jamais un zéro fabriqué. */}
          <p className="mt-1.5 text-fu-sm text-[var(--fu-text-secondary)]">
            {service && service.observed_minutes !== null
              ? t('pro.catalog.meta.observed', {
                  observed: Math.round(service.observed_minutes),
                  count: service.sample_count,
                })
              : t('pro.catalog.meta.noObservation')}
          </p>
          {notice.capped && (
            <p className="mt-2 flex items-start gap-2 text-fu-sm text-[var(--fu-state-warn)]">
              <IconError aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>{t('pro.catalog.estimate.capped')}</span>
            </p>
          )}
        </div>

        <Textarea
          label={t('pro.catalog.sheet.description')}
          hint={t('pro.catalog.sheet.descriptionHint')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          data-testid="pro-catalog-field-description"
        />

        <Select
          label={t('pro.catalog.sheet.category')}
          options={categoryOptions}
          value={category}
          onValueChange={setCategory}
        />
        {category === CATEGORY_NEW && (
          <Input
            label={t('pro.catalog.sheet.categoryNewLabel')}
            value={newCategory}
            onChange={(event) => setNewCategory(event.target.value)}
            error={errors.newCategory}
            data-testid="pro-catalog-field-new-category"
          />
        )}

        {/* Capacité absente = NON rendue : un barber ne voit pas le prix. */}
        {permissions.canPrice ? (
          <Input
            label={t('pro.catalog.sheet.price')}
            hint={errors.price ? undefined : t('pro.catalog.sheet.priceHint')}
            error={errors.price}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.5}
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            data-testid="pro-catalog-field-price"
          />
        ) : (
          /* Pas de champ prix pour un barber — mais on lui DIT pourquoi
             plutôt que de laisser un trou inexpliqué au milieu du
             formulaire. À la création, la phrase dit en plus ce qui va se
             passer : le service naîtra brouillon. */
          <p
            className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 text-fu-sm text-[var(--fu-text-secondary)]"
            data-testid={service === null ? 'pro-catalog-draft-notice' : 'pro-catalog-price-reserved'}
          >
            {service === null ? t('pro.catalog.sheet.draftNotice') : t('pro.catalog.sheet.priceReserved')}
          </p>
        )}

        <div className="flex flex-col gap-2 border-t border-[var(--fu-border)] pt-4">
          {/* Un service archivé refuse l'édition côté serveur : on ne propose
              pas une action que la RPC rejetterait — c'est la restauration
              qui devient le geste principal. */}
          {isArchived ? (
            permissions.canArchive && (
              <Button variant="primary" loading={saving} onClick={onRestore} data-testid="pro-catalog-restore">
                {t('pro.catalog.archive.restore')}
              </Button>
            )
          ) : (
            <Button variant="primary" loading={saving} onClick={submit} data-testid="pro-catalog-save">
              {t('pro.catalog.sheet.save')}
            </Button>
          )}

          {permissions.canAssign && service !== null && !isArchived && (
            <Button variant="secondary" onClick={onAssign} data-testid="pro-catalog-assign-open">
              {t('pro.catalog.assign.title')}
            </Button>
          )}

          {permissions.canArchive && service !== null && !isArchived && (
            <Button variant="secondary" onClick={onArchive} data-testid="pro-catalog-archive">
              {t('pro.catalog.archive.action')}
            </Button>
          )}

          {/* La suppression n'est proposée QUE sans historique. La garde
              serveur reste la vérité : son refus s'affiche quand même. */}
          {permissions.canDelete && service !== null && !service.has_history && (
            <Button variant="destructive" onClick={onDelete} data-testid="pro-catalog-delete">
              {t('pro.catalog.remove.action')}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
