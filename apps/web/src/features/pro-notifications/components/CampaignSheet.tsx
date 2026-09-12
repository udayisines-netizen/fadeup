import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { DateTime } from '@/shared/ui/DateTime'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'
import { SkeletonRect } from '@/shared/ui/Skeleton'
import { errorMessageKey, toAppError } from '@/shared/data/errors'
import {
  useCampaignPreview,
  useCampaignServices,
  useSendCampaign,
  type CampaignParams,
  type CampaignQuota,
} from '@/features/pro-notifications/api/campaigns'
import {
  atCap,
  canSend,
  clampThreshold,
  HEADLINE_MAX,
  kindNeedsOffer,
  kindNeedsService,
  kindNeedsThreshold,
  OFFER_MAX,
  parseCampaignRefusal,
  promotionBounds,
  suppressionLines,
  THRESHOLD_DEFAULT_DAYS,
  validateCampaignText,
  type CampaignKind,
} from '@/features/pro-notifications/lib/campaigns'

/**
 * OS-3 §4 — la feuille d'un modèle. Le professionnel CHOISIT un modèle et
 * remplit quelques champs ; il ne rédige pas d'e-mail. Le corps du message
 * vit dans `email_templates` (fr + en), en base, comme tous les e-mails de
 * FadeUp.
 *
 * L'aperçu est LA même audience que l'envoi (même fonction SQL) : il dit
 * combien de clients sont concernés, combien sont joignables, et pourquoi les
 * autres ne le sont pas. Au plafond, la feuille explique et propose la suite
 * — elle ne disparaît pas, et le bouton d'envoi n'est pas caché mais désactivé
 * avec son motif écrit.
 */

interface CampaignSheetProps {
  organizationId: string | null
  timezone: string
  kind: CampaignKind
  quota: CampaignQuota | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSent: (recipients: number, deferred: boolean) => void
}

export function CampaignSheet({
  organizationId,
  timezone,
  kind,
  quota,
  open,
  onOpenChange,
  onSent,
}: CampaignSheetProps) {
  const { t } = useTranslation('v2')
  const [headline, setHeadline] = useState('')
  const [offer, setOffer] = useState('')
  const [threshold, setThreshold] = useState(THRESHOLD_DEFAULT_DAYS)
  const [serviceId, setServiceId] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [touched, setTouched] = useState(false)

  const services = useCampaignServices(kindNeedsService(kind) ? organizationId : null)
  const send = useSendCampaign(organizationId)

  // Le premier service actif par défaut : le professionnel ne doit pas avoir
  // à choisir pour voir un aperçu utile.
  useEffect(() => {
    if (kindNeedsService(kind) && serviceId === '' && services.data && services.data.length > 0) {
      setServiceId(services.data[0]?.id ?? '')
    }
  }, [kind, serviceId, services.data])

  const bounds = useMemo(() => promotionBounds(new Date()), [])

  const params: CampaignParams = useMemo(() => {
    const next: CampaignParams = {}
    if (kindNeedsThreshold(kind)) next.threshold_days = threshold
    if (kindNeedsService(kind) && serviceId) next.service_id = serviceId
    if (kindNeedsOffer(kind)) {
      if (offer.trim()) next.offer = offer.trim()
      if (validUntil) next.valid_until = validUntil
    }
    return next
  }, [kind, threshold, serviceId, offer, validUntil])

  const preview = useCampaignPreview(open ? organizationId : null, open ? kind : null, params)

  const headlineRefusal = validateCampaignText(headline, HEADLINE_MAX)
  const offerRefusal = kindNeedsOffer(kind) ? validateCampaignText(offer, OFFER_MAX) : null
  const missingUntil = kindNeedsOffer(kind) && validUntil === ''
  const missingService = kindNeedsService(kind) && serviceId === ''
  const capped = atCap(quota)

  const formReady = headlineRefusal === null && offerRefusal === null && !missingUntil && !missingService
  const sendable = formReady && canSend(preview.data ?? null, quota)

  const refusalText = (refusal: ReturnType<typeof validateCampaignText>, field: 'headline' | 'offer') => {
    if (refusal === null) return undefined
    return t(`pro.campaigns.refusal.${refusal}`, { max: field === 'headline' ? HEADLINE_MAX : OFFER_MAX })
  }

  const serverRefusal = send.error ? parseCampaignRefusal(send.error) : null

  const submit = () => {
    setTouched(true)
    if (!sendable) return
    send.mutate(
      { kind, headline: headline.trim(), params },
      {
        onSuccess: (result) => {
          onSent(result.recipient_count, result.deferred_count > 0)
          setHeadline('')
          setOffer('')
          setValidUntil('')
          setTouched(false)
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t(`pro.campaigns.kind.${kind}.title`)}
      description={t(`pro.campaigns.kind.${kind}.description`)}
    >
      <div className="flex flex-col gap-4" data-testid={`campaign-sheet-${kind}`}>
        {/* Les champs du modèle — quelques-uns, jamais un éditeur. */}
        {kindNeedsThreshold(kind) && (
          <Input
            label={t('pro.campaigns.field.threshold')}
            type="number"
            inputMode="numeric"
            value={String(threshold)}
            hint={t('pro.campaigns.field.thresholdHint')}
            onChange={(event) => setThreshold(clampThreshold(Number(event.target.value)))}
            data-testid="campaign-threshold"
          />
        )}

        {kindNeedsService(kind) && (
          <Select
            label={t('pro.campaigns.field.service')}
            options={(services.data ?? []).map((service) => ({ value: service.id, label: service.name }))}
            value={serviceId}
            onValueChange={setServiceId}
            placeholder={t('pro.campaigns.field.servicePlaceholder')}
            error={touched && missingService ? t('pro.campaigns.refusal.missing') : undefined}
          />
        )}

        {kindNeedsOffer(kind) && (
          <>
            <Input
              label={t('pro.campaigns.field.offer')}
              value={offer}
              maxLength={OFFER_MAX}
              hint={t('pro.campaigns.field.offerHint')}
              error={touched || offer.length > 0 ? refusalText(offerRefusal, 'offer') : undefined}
              onChange={(event) => setOffer(event.target.value)}
              data-testid="campaign-offer"
            />
            <Input
              label={t('pro.campaigns.field.validUntil')}
              type="date"
              value={validUntil}
              min={bounds.min}
              max={bounds.max}
              error={touched && missingUntil ? t('pro.campaigns.refusal.missing') : undefined}
              onChange={(event) => setValidUntil(event.target.value)}
              data-testid="campaign-valid-until"
            />
          </>
        )}

        <Input
          label={t('pro.campaigns.field.headline')}
          value={headline}
          maxLength={HEADLINE_MAX}
          hint={t('pro.campaigns.field.headlineHint', { max: HEADLINE_MAX })}
          /* Le refus s'affiche dès que le champ porte quelque chose — pas
             seulement à la soumission. Un bouton désactivé n'appelle pas son
             `onClick` : attendre la soumission pour dire « pas de lien »
             laisserait le professionnel devant un bouton mort sans motif. */
          error={touched || headline.length > 0 ? refusalText(headlineRefusal, 'headline') : undefined}
          onChange={(event) => setHeadline(event.target.value)}
          data-testid="campaign-headline"
        />

        {/* L'APERÇU — la même audience que l'envoi. */}
        <div
          className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface-subtle)] p-3"
          data-testid="campaign-preview"
        >
          {preview.isPending ? (
            <SkeletonRect className="h-16 w-full" />
          ) : preview.error ? (
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">
              {t(errorMessageKey(toAppError(preview.error)))}
            </p>
          ) : preview.data === null ? (
            <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.campaigns.preview.none')}</p>
          ) : (
            <>
              <p className="font-fu-mono text-fu-xl font-semibold tabular-nums text-[var(--fu-text-primary)]">
                {preview.data.reachable_count}
              </p>
              <p className="text-fu-sm text-[var(--fu-text-secondary)]">
                {t('pro.campaigns.preview.reachable', { count: preview.data.reachable_count })}
              </p>
              {suppressionLines(preview.data).map((line) => (
                <p key={line.reason} className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">
                  {t(`pro.campaigns.preview.suppressed.${line.reason}`, { count: line.count })}
                </p>
              ))}
              {kindNeedsService(kind) && preview.data.slot_count !== null && (
                <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]" data-testid="campaign-preview-slots">
                  {t('pro.campaigns.preview.slots', { count: preview.data.slot_count })}
                </p>
              )}
              {preview.data.deferred && (
                <p className="mt-2 text-fu-xs text-[var(--fu-state-warn)]" data-testid="campaign-preview-quiet">
                  {t('pro.campaigns.preview.quietHours')}{' '}
                  <DateTime value={preview.data.scheduled_at} timezone={timezone} format="datetime" />
                </p>
              )}
            </>
          )}
        </div>

        {/* AU PLAFOND : on explique, on ne mure pas. */}
        {capped && quota && (
          <div
            className="rounded-[var(--radius-card)] border border-[var(--fu-state-warn)] p-3"
            data-testid="campaign-capped"
          >
            <p className="text-fu-sm text-[var(--fu-text-primary)]">
              {t('pro.campaigns.cap.reached', { used: quota.used, allowance: quota.monthly_allowance ?? 0 })}
            </p>
            <p className="mt-1 text-fu-xs text-[var(--fu-text-secondary)]">
              {quota.next_plan_display_name
                ? t('pro.campaigns.cap.upgrade', {
                    plan: quota.next_plan_display_name,
                    allowance: quota.next_plan_allowance ?? 0,
                  })
                : t('pro.campaigns.cap.resets')}
            </p>
          </div>
        )}

        {serverRefusal !== null && (
          <p className="text-fu-sm text-[var(--fu-state-danger)]" data-testid="campaign-server-refusal">
            {t(`pro.campaigns.serverRefusal.${serverRefusal}`, {
              defaultValue: t('pro.campaigns.serverRefusal.unknown'),
            })}
          </p>
        )}
        {send.error !== null && serverRefusal === null && (
          <p className="text-fu-sm text-[var(--fu-state-danger)]">{t(errorMessageKey(toAppError(send.error)))}</p>
        )}

        <Button
          variant="primary"
          fullWidth
          loading={send.isPending}
          disabled={!sendable}
          onClick={submit}
          data-testid="campaign-send"
        >
          {preview.data && preview.data.reachable_count > 0
            ? t('pro.campaigns.action.sendTo', { count: preview.data.reachable_count })
            : t('pro.campaigns.action.send')}
        </Button>
      </div>
    </Sheet>
  )
}
