import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useProOrganization } from '@/shared/data/organization'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import { deviceTimezone } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Row } from '@/shared/ui/Row'
import { SkeletonRow } from '@/shared/ui/Skeleton'
import { useToast } from '@/shared/ui/Toast'
import { IconEmail } from '@/shared/ui/icons'
import { useCampaignHistory, useCampaignQuota } from '@/features/pro-notifications/api/campaigns'
import { CampaignSheet } from '@/features/pro-notifications/components/CampaignSheet'
import { atCap, CAMPAIGN_KINDS, type CampaignKind } from '@/features/pro-notifications/lib/campaigns'

/**
 * OS-3 §4 — les sollicitations par modèles.
 *
 * Régime AÉRÉ pour la décision (le compteur, les quatre modèles), DENSE pour
 * l'historique. UN chiffre domine : ce qu'il RESTE au professionnel ce
 * mois-ci — c'est la seule question qu'il se pose en arrivant ici.
 *
 * Le plafond vit en base (`commercial_plans.monthly_campaign_allowance`) et
 * est appliqué par `send_notification_campaign`. Cet écran ne fait que
 * l'ANNONCER : au plafond, les modèles restent visibles et la feuille dit
 * pourquoi et ce qu'un plan supérieur apporterait — jamais un mur.
 *
 * Un rôle qui n'a pas le droit d'écrire n'arrive pas ici (l'entrée de nav est
 * conditionnée) ; s'il y arrive par URL, la RPC refuse et l'écran rend un état
 * honnête plutôt qu'un squelette éternel.
 */

function PanelTitle({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 font-fu-mono text-fu-xs font-medium tracking-widest text-[var(--fu-text-secondary)]">
      {icon}
      {label.toLocaleUpperCase()}
    </h2>
  )
}

const panelClass = 'rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface)] p-4 lg:p-5'

export function ProCampaignsPage() {
  const { t } = useTranslation('v2')
  const { toast } = useToast()
  const { organization, loading: orgLoading } = useProOrganization()
  const organizationId = organization?.organizationId ?? null
  const timezone = organization?.locations[0]?.timezone ?? deviceTimezone()
  const role = organization?.role ?? 'barber'
  const canWrite = role === 'owner' || role === 'manager'

  const quota = useCampaignQuota(organizationId, canWrite)
  const history = useCampaignHistory(organizationId, canWrite)
  const [openKind, setOpenKind] = useState<CampaignKind | null>(null)

  const capped = atCap(quota.data ?? null)
  const rows = history.data ?? []
  const loading = orgLoading || (canWrite && quota.isPending)

  const onSent = (recipients: number, deferred: boolean) => {
    toast({
      tone: 'success',
      title: t('pro.campaigns.sent.title', { count: recipients }),
      description: deferred ? t('pro.campaigns.sent.deferred') : t('pro.campaigns.sent.now'),
    })
  }

  if (!canWrite && !orgLoading) {
    /* Le rôle ne rend rien de l'écran : pas un cadenas, pas une vente
       incitative — une phrase et une sortie (P1PRO §0bis). */
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-campaigns">
        <div className={panelClass} data-testid="pro-campaigns-forbidden">
          <EmptyState
            icon={<IconEmail aria-hidden="true" />}
            title={t('pro.campaigns.forbidden.title')}
            description={t('pro.campaigns.forbidden.description')}
            action={
              <Link
                to="/dashboard"
                className="inline-flex min-h-11 items-center text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
              >
                {t('pro.campaigns.forbidden.action')}
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 lg:px-8 lg:py-8" data-testid="pro-campaigns">
      <header className="mb-4 lg:mb-6">
        <h1 className="text-fu-xl font-semibold text-[var(--fu-text-primary)] lg:text-fu-2xl">
          {t('pro.campaigns.title')}
        </h1>
        <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.campaigns.subtitle')}</p>
      </header>

      {loading ? (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label={t('common.a11y.loading')}>
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : quota.error ? (
        <div className={panelClass} data-testid="pro-campaigns-error">
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t(errorMessageKey(toAppError(quota.error)))}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void quota.refetch()}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:gap-5">
          {/* LE compteur — le chiffre dominant de cet écran. */}
          <section
            className={`${panelClass} ${capped ? 'border-[var(--fu-state-warn)]' : ''}`}
            data-testid="pro-campaigns-quota"
          >
            <PanelTitle label={t('pro.campaigns.quotaLabel')} />
            <p
              className="mt-2 font-fu-mono text-fu-3xl font-semibold tabular-nums text-[var(--fu-text-primary)] lg:text-fu-4xl"
              data-testid="pro-campaigns-remaining"
            >
              {quota.data?.monthly_allowance === null ? t('pro.campaigns.unlimited') : (quota.data?.remaining ?? 0)}
            </p>
            <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
              {quota.data?.monthly_allowance === null
                ? t('pro.campaigns.quotaUnlimitedHint', { used: quota.data?.used ?? 0 })
                : t('pro.campaigns.quotaHint', {
                    used: quota.data?.used ?? 0,
                    allowance: quota.data?.monthly_allowance ?? 0,
                    plan: quota.data?.plan_display_name ?? '',
                  })}
            </p>
            {capped && quota.data && (
              <div className="mt-3 border-t border-[var(--fu-border)] pt-3" data-testid="pro-campaigns-capped">
                <p className="text-fu-sm text-[var(--fu-state-warn)]">{t('pro.campaigns.cap.title')}</p>
                <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
                  {quota.data.next_plan_display_name
                    ? t('pro.campaigns.cap.upgrade', {
                        plan: quota.data.next_plan_display_name,
                        allowance: quota.data.next_plan_allowance ?? 0,
                      })
                    : t('pro.campaigns.cap.resets')}
                </p>
                {role === 'owner' && quota.data.next_plan_key && (
                  <Link
                    to="/dashboard/billing"
                    className="mt-2 inline-flex min-h-11 items-center text-fu-sm font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline"
                    data-testid="pro-campaigns-upgrade-link"
                  >
                    {t('pro.campaigns.cap.action')}
                  </Link>
                )}
              </div>
            )}
          </section>

          {/* LES QUATRE MODÈLES. Toujours visibles — au plafond, c'est la
              feuille qui explique, pas l'écran qui cache. */}
          <section className="grid gap-3 lg:grid-cols-2 lg:gap-4" data-testid="pro-campaigns-templates">
            {CAMPAIGN_KINDS.map((kind) => (
              <div key={kind} className={panelClass} data-testid={`pro-campaigns-template-${kind}`}>
                <h3 className="text-fu-base font-semibold text-[var(--fu-text-primary)]">
                  {t(`pro.campaigns.kind.${kind}.title`)}
                </h3>
                <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
                  {t(`pro.campaigns.kind.${kind}.description`)}
                </p>
                <Button
                  variant="secondary"
                  className="mt-3"
                  onClick={() => setOpenKind(kind)}
                  data-testid={`pro-campaigns-open-${kind}`}
                >
                  {t('pro.campaigns.action.prepare')}
                </Button>
              </div>
            ))}
          </section>

          {/* L'HISTORIQUE et ce que ça a donné — dense. */}
          <section className={panelClass} data-testid="pro-campaigns-history">
            <PanelTitle label={t('pro.campaigns.historyLabel')} icon={<IconEmail aria-hidden="true" className="size-3.5" />} />
            {history.isPending ? (
              <div className="mt-2" aria-busy="true">
                <SkeletonRow />
                <SkeletonRow />
              </div>
            ) : rows.length === 0 ? (
              <p className="mt-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="pro-campaigns-history-empty">
                {t('pro.campaigns.historyEmpty')}
              </p>
            ) : (
              <div className="mt-1">
                {rows.map((row) => (
                  <Row
                    key={row.campaign_id}
                    className="px-0"
                    title={
                      <span className="text-fu-sm font-medium">{t(`pro.campaigns.kind.${row.kind}.title`)}</span>
                    }
                    /* Le RÉSULTAT passe dans `children`, pas dans `subtitle` :
                       la primitive `Row` tronque son sous-titre sur une seule
                       ligne (c'est sa loi, et les autres écrans en dépendent),
                       et à 390 px la troisième valeur — « ont réservé
                       ensuite », la plus intéressante — disparaissait. Ici
                       elle se replie. */
                    subtitle={<span className="text-fu-xs text-[var(--fu-text-secondary)]">{row.headline}</span>}
                    trailing={
                      <span className="flex flex-col items-end gap-0.5">
                        <span className="font-fu-mono text-fu-xs tabular-nums text-[var(--fu-text-secondary)]">
                          <DateTime value={row.created_at} timezone={timezone} format="date" />
                        </span>
                        {row.deferred_count > 0 && (
                          <span className="font-fu-mono text-fu-xs tabular-nums text-[var(--fu-state-warn)]">
                            {t('pro.campaigns.row.deferred')}
                          </span>
                        )}
                      </span>
                    }
                  >
                    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-fu-xs text-[var(--fu-text-secondary)]">
                      <div className="flex gap-1">
                        <dt>{t('pro.campaigns.row.recipientsLabel')}</dt>
                        <dd className="font-fu-mono tabular-nums">{row.recipient_count}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t('pro.campaigns.row.openedLabel')}</dt>
                        <dd className="font-fu-mono tabular-nums">{row.opened_count}</dd>
                      </div>
                      <div className="flex gap-1">
                        <dt>{t('pro.campaigns.row.bookedLabel')}</dt>
                        <dd className="font-fu-mono tabular-nums">{row.booked_count}</dd>
                      </div>
                    </dl>
                  </Row>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {openKind !== null && (
        <CampaignSheet
          organizationId={organizationId}
          timezone={timezone}
          kind={openKind}
          quota={quota.data ?? null}
          open
          onOpenChange={(next) => {
            if (!next) setOpenKind(null)
          }}
          onSent={onSent}
        />
      )}
    </div>
  )
}
