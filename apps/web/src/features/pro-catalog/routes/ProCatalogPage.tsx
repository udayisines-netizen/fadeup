import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { useProOrganization } from '@/shared/data/organization'
import { useOrganizationBarbers } from '@/shared/data/proBarbers'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { Dialog } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconServices } from '@/shared/ui/icons'
import {
  useArchiveService,
  useCatalog,
  useDeleteService,
  useRestoreService,
  useSaveService,
  useServiceCategories,
  useSetServiceBarbers,
  type CatalogServiceRow,
  type ServiceDraft,
} from '@/features/pro-catalog/api/catalog'
import { AssignSheet } from '@/features/pro-catalog/components/AssignSheet'
import { ServiceRow } from '@/features/pro-catalog/components/ServiceRow'
import { ServiceSheet } from '@/features/pro-catalog/components/ServiceSheet'
import { groupByCategory } from '@/features/pro-catalog/lib/group'
import { canCreateCategory, catalogPermissions } from '@/features/pro-catalog/lib/permissions'
import { parseServiceRefusal, serviceRefusalMessageKey } from '@/features/pro-catalog/lib/refusals'

/**
 * OS-2 — /dashboard/catalog : ce que le salon propose, et qui le réalise.
 *
 * Régime DENSE (P1PRO §3) : des rangées à filet fin groupées par catégorie,
 * pas une grille de cartes. Un seul CTA primaire sur la page (« Créer un
 * service ») ; tout le reste des gestes vit dans la feuille du service.
 *
 * Rôles (miroir des gardes SQL, lib/permissions.ts) : owner/manager font
 * tout ; un barber décrit un service mais ne le tarife pas — le champ prix
 * n'est pas rendu pour lui et la clé n'est jamais envoyée ; un réceptionniste
 * LIT et n'écrit rien, donc aucune rangée ne s'ouvre et aucun bouton
 * d'écriture n'existe dans son DOM.
 */

type SheetTarget = { kind: 'create' } | { kind: 'edit'; serviceId: string }
type Confirmation = { kind: 'archive' | 'delete'; serviceId: string }

const panelClass = 'overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)] [&>*:last-child]:border-b-0'

function GroupTitle({ label }: { label: string }) {
  return (
    <h2 className="mb-2 px-1 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
      {label.toLocaleUpperCase()}
    </h2>
  )
}

export function ProCatalogPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()

  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const currency = organization?.currency ?? 'EUR'
  // Tant que l'organisation n'est pas résolue, on ne DEVINE pas de rôle :
  // un défaut à « barber » rendrait « Créer un service » à un réceptionniste
  // pendant le chargement, et la RPC le refuserait ensuite. Capacité
  // inconnue = rien de rendu (P1PRO §0bis).
  const permissions = catalogPermissions(organization?.role ?? null)

  const [showArchived, setShowArchived] = useState(false)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [assignId, setAssignId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)

  const catalogQuery = useCatalog(organizationId, showArchived)
  const categoriesQuery = useServiceCategories(organizationId)
  // Les fauteuils ne servent QU'À l'affectation : inutile de les charger pour
  // qui n'a pas le droit d'affecter.
  const barbersQuery = useOrganizationBarbers(permissions.canAssign ? organizationId : null)

  const save = useSaveService(organizationId)
  const archive = useArchiveService(organizationId)
  const restore = useRestoreService(organizationId)
  const remove = useDeleteService(organizationId)
  const assign = useSetServiceBarbers(organizationId)

  const services = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data])
  const groups = useMemo(() => groupByCategory(services), [services])
  const activeCount = useMemo(() => services.filter((row) => row.status === 'active').length, [services])

  const byId = (serviceId: string): CatalogServiceRow | null => services.find((row) => row.id === serviceId) ?? null
  const editing = sheet?.kind === 'edit' ? byId(sheet.serviceId) : null
  const assigning = assignId ? byId(assignId) : null
  const confirming = confirmation ? byId(confirmation.serviceId) : null

  /** Traduit un refus SERVEUR : motif nommé s'il en a un, sinon la clé générique. */
  const failure = (raw: unknown) => {
    const refusal = parseServiceRefusal(raw)
    const key = refusal ? serviceRefusalMessageKey(refusal) : null
    toast({ tone: 'error', title: t(key ?? errorMessageKey(toAppError(raw))) })
  }

  const succeed = (key: string) => toast({ tone: 'success', title: t(key) })

  const loading = orgLoading || catalogQuery.isPending
  const error = catalogQuery.error
  // L'état vide du catalogue porte lui-même l'action : l'en-tête doit alors
  // s'effacer, sinon deux boutons verts demandent la même chose.
  const showEmptyCreate =
    !loading && !error && !showArchived && (catalogQuery.data?.length ?? 0) === 0 && permissions.canWrite

  const onSave = (draft: Omit<ServiceDraft, 'serviceId'>) => {
    const serviceId = sheet?.kind === 'edit' ? sheet.serviceId : null
    save.mutate(
      { ...draft, serviceId },
      {
        onSuccess: () => {
          succeed(serviceId === null ? 'pro.catalog.toast.created' : 'pro.catalog.toast.updated')
          setSheet(null)
        },
        onError: failure,
      },
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24" data-testid="pro-catalog">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)] lg:text-fu-2xl">
            {t('pro.catalog.title')}
          </h1>
          <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.catalog.subtitle')}</p>
        </div>
        {/* UN SEUL CTA primaire par surface : quand l'état vide porte déjà
            « Créer un service », celui de l'en-tête ne se rend pas. */}
        {permissions.canWrite && !showEmptyCreate && (
          <Button variant="primary" onClick={() => setSheet({ kind: 'create' })} data-testid="pro-catalog-create">
            {t('pro.catalog.add')}
          </Button>
        )}
      </header>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]" data-testid="pro-catalog-count">
          {t('pro.catalog.activeCount', { count: activeCount })}
        </p>
        <Chip
          selected={showArchived}
          onClick={() => setShowArchived((current) => !current)}
          data-testid="pro-catalog-show-archived"
        >
          {t('pro.catalog.showArchived')}
        </Chip>
      </div>

      {loading ? (
        <div className={panelClass} aria-busy="true" aria-label={t('common.a11y.loading')}>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : error ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(error)))}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void catalogQuery.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : services.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)]" data-testid="pro-catalog-empty">
          {showArchived ? (
            <EmptyState
              icon={<IconServices />}
              title={t('pro.catalog.emptyArchived.title')}
              description={t('pro.catalog.emptyArchived.description')}
              action={
                <Button variant="secondary" onClick={() => setShowArchived(false)}>
                  {t('pro.catalog.emptyArchived.action')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<IconServices />}
              title={t('pro.catalog.empty.title')}
              description={t('pro.catalog.empty.description')}
              action={
                showEmptyCreate ? (
                  <Button variant="primary" onClick={() => setSheet({ kind: 'create' })} data-testid="pro-catalog-empty-create">
                    {t('pro.catalog.empty.action')}
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-5" data-testid="pro-catalog-list">
          {groups.map((group) => (
            <section key={group.categoryId ?? 'uncategorized'}>
              <GroupTitle label={group.categoryName ?? t('pro.catalog.categoryNone')} />
              <div className={panelClass}>
                {group.services.map((service) => (
                  <ServiceRow
                    key={service.id}
                    service={service}
                    currency={currency}
                    /* Un archivé ne s'édite pas côté serveur : il ne s'ouvre
                       que pour qui peut le restaurer. */
                    interactive={permissions.canWrite && (service.archived_at === null || permissions.canArchive)}
                    onOpen={() => setSheet({ kind: 'edit', serviceId: service.id })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* La feuille d'édition n'existe que pour un service encore présent :
          un service supprimé ou sorti de la vue ne laisse pas un formulaire
          orphelin qui se prendrait pour une création. */}
      {permissions.canWrite && sheet !== null && (sheet.kind === 'create' || editing !== null) && (
        <ServiceSheet
          /* Remonté à chaque service : la saisie ne peut pas fuiter d'une
             fiche à l'autre, et un rafraîchissement de liste ne l'écrase pas. */
          key={sheet.kind === 'create' ? 'create' : sheet.serviceId}
          open
          onOpenChange={(next) => {
            if (!next) setSheet(null)
          }}
          service={editing}
          categories={categoriesQuery.data ?? []}
          permissions={permissions}
          canCreateCategory={canCreateCategory(organization?.role ?? null)}
          saving={save.isPending || restore.isPending}
          onSave={onSave}
          onArchive={() => {
            if (editing) setConfirmation({ kind: 'archive', serviceId: editing.id })
          }}
          onRestore={() => {
            if (!editing) return
            restore.mutate(editing.id, {
              onSuccess: () => {
                succeed('pro.catalog.toast.restored')
                setSheet(null)
              },
              onError: failure,
            })
          }}
          onDelete={() => {
            if (editing) setConfirmation({ kind: 'delete', serviceId: editing.id })
          }}
          onAssign={() => {
            if (editing) setAssignId(editing.id)
          }}
        />
      )}

      {assigning !== null && permissions.canAssign && (
        <AssignSheet
          key={assigning.id}
          open
          onOpenChange={(next) => {
            if (!next) setAssignId(null)
          }}
          serviceName={assigning.name}
          barbers={barbersQuery.data ?? []}
          loading={barbersQuery.isPending}
          error={barbersQuery.error}
          onRetry={() => void barbersQuery.refetch()}
          saving={assign.isPending}
          assigned={assigning.assigned_barber_ids}
          onSave={(barberIds) =>
            assign.mutate(
              { serviceId: assigning.id, barberIds },
              {
                onSuccess: () => {
                  succeed('pro.catalog.toast.assigned')
                  setAssignId(null)
                },
                onError: failure,
              },
            )
          }
        />
      )}

      {/* Archiver et supprimer passent TOUJOURS par une confirmation. */}
      {confirming !== null && confirmation !== null && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirmation(null)
          }}
          title={t(confirmation.kind === 'archive' ? 'pro.catalog.archive.title' : 'pro.catalog.remove.title')}
          description={t(confirmation.kind === 'archive' ? 'pro.catalog.archive.body' : 'pro.catalog.remove.body')}
        >
          <div className="flex flex-col gap-2">
            <Button
              variant={confirmation.kind === 'archive' ? 'primary' : 'destructive'}
              loading={archive.isPending || remove.isPending}
              data-testid="pro-catalog-confirm"
              onClick={() => {
                const done = (key: string) => {
                  succeed(key)
                  setConfirmation(null)
                  setSheet(null)
                }
                if (confirmation.kind === 'archive') {
                  archive.mutate(confirmation.serviceId, {
                    onSuccess: () => done('pro.catalog.toast.archived'),
                    onError: (raw) => {
                      failure(raw)
                      setConfirmation(null)
                    },
                  })
                } else {
                  remove.mutate(confirmation.serviceId, {
                    onSuccess: () => done('pro.catalog.toast.deleted'),
                    onError: (raw) => {
                      // `has_history` : la garde serveur reste la vérité même
                      // quand l'écran n'offrait pas le bouton.
                      failure(raw)
                      setConfirmation(null)
                    },
                  })
                }
              }}
            >
              {t(confirmation.kind === 'archive' ? 'pro.catalog.archive.confirm' : 'pro.catalog.remove.confirm')}
            </Button>
            <Button variant="tertiary" onClick={() => setConfirmation(null)}>
              {t('common.action.cancel')}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
