import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDateTime } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { Textarea } from '@/shared/ui/Textarea'
import { IconError } from '@/shared/ui/icons'
import type { AgendaAppointmentRow, TimeBlockRow } from '@/features/pro-agenda/api/agenda'
import type { ConflictReport } from '@/features/pro-agenda/lib/layout'

/**
 * OS-1 — l'AVERTISSEMENT de conflit, avant le geste. Rouge = conflit
 * (contrat), jamais la couleur seule : l'icône et le titre le disent. Deux
 * issues : « Choisir un autre créneau » (toujours) et « Forcer » (owner /
 * manager seulement, motif OBLIGATOIRE — la trace est annoncée avant le
 * geste). Un temps bloqué ne se force pas : on le dit, et on ne propose pas
 * le geste.
 */
export interface ConflictDialogProps {
  open: boolean
  report: ConflictReport<AgendaAppointmentRow, TimeBlockRow> | null
  timezone: string
  canForce: boolean
  submitting: boolean
  onCancel: () => void
  onForce: (reason: string) => void
}

export function ConflictDialog({ open, report, timezone, canForce, submitting, onCancel, onForce }: ConflictDialogProps) {
  const { t, i18n } = useTranslation('v2')
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  // Chaque conflit a SON motif : rien ne se recopie d'un dialogue à l'autre.
  useEffect(() => {
    if (open) {
      setReason('')
      setTouched(false)
    }
  }, [open])
  const blocked = (report?.blocks.length ?? 0) > 0
  const forceable = canForce && !blocked
  const reasonError = touched && reason.trim().length === 0 ? t('booking.refusal.force_reason_required') : undefined

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
      title={t('pro.agenda.conflict.title')}
      description={blocked ? t('pro.agenda.conflict.blockBody') : t('pro.agenda.conflict.body')}
    >
      <div data-testid="agenda-conflict" className="flex flex-col gap-4">
        <ul className="flex flex-col divide-y divide-[var(--fu-border)] rounded-[var(--radius-control)] border border-[var(--fu-state-danger)]">
          {report?.appointments.map((row) => (
            <li key={row.id} className="flex items-center gap-2 px-3 py-2 text-fu-sm">
              <IconError aria-hidden="true" className="size-4 shrink-0 text-[var(--fu-state-danger)]" />
              <span className="font-fu-mono tabular-nums text-[var(--fu-text-secondary)]">
                {formatDateTime(row.starts_at, timezone, 'time', i18n.language)}–{formatDateTime(row.ends_at, timezone, 'time', i18n.language)}
              </span>
              <span className="min-w-0 truncate font-semibold text-[var(--fu-text-primary)]">{row.customer_name}</span>
              {row.service_name && <span className="min-w-0 truncate text-[var(--fu-text-secondary)]">· {row.service_name}</span>}
            </li>
          ))}
          {report?.blocks.map((block) => (
            <li key={block.id} className="flex items-center gap-2 px-3 py-2 text-fu-sm">
              <IconError aria-hidden="true" className="size-4 shrink-0 text-[var(--fu-state-danger)]" />
              <span className="font-fu-mono tabular-nums text-[var(--fu-text-secondary)]">
                {formatDateTime(block.starts_at, timezone, 'time', i18n.language)}–{formatDateTime(block.ends_at, timezone, 'time', i18n.language)}
              </span>
              <span className="min-w-0 truncate font-semibold text-[var(--fu-text-primary)]">{t('pro.agenda.card.block')}</span>
              {block.reason && <span className="min-w-0 truncate text-[var(--fu-text-secondary)]">· {block.reason}</span>}
            </li>
          ))}
        </ul>

        {blocked ? (
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.agenda.conflict.blockCannotForce')}</p>
        ) : canForce ? (
          <Textarea
            label={t('pro.agenda.conflict.reason')}
            hint={reasonError ? undefined : t('pro.agenda.conflict.forceHint')}
            error={reasonError}
            placeholder={t('pro.agenda.conflict.reasonPlaceholder')}
            maxLength={200}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
            data-testid="agenda-force-reason"
            className="[&>textarea]:min-h-20"
          />
        ) : (
          <p className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="agenda-conflict-cannot-force">
            {t('pro.agenda.conflict.cannotForce')}
          </p>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} data-testid="agenda-conflict-other">
            {t('pro.agenda.conflict.otherSlot')}
          </Button>
          {forceable && (
            <Button
              variant="destructive"
              loading={submitting}
              data-testid="agenda-conflict-force"
              onClick={() => {
                setTouched(true)
                if (reason.trim().length === 0) return
                onForce(reason.trim())
              }}
            >
              {t('pro.agenda.conflict.forceSubmit')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  )
}
