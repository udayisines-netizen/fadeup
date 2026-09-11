import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { OrganizationBarber } from '@/shared/data/proBarbers'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { Checkbox } from '@/shared/ui/Checkbox'
import { SkeletonRow } from '@/shared/ui/Skeleton'

export interface AssignSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serviceName: string
  barbers: OrganizationBarber[]
  loading: boolean
  saving: boolean
  /** Les barbers déjà affectés (`assigned_barber_ids`). */
  assigned: string[]
  onSave: (barberIds: string[]) => void
}

/**
 * OS-2 — « Qui réalise ce service ». `set_service_barbers` REMPLACE la
 * liste : la feuille envoie donc toujours la sélection complète.
 *
 * Aucune case cochée n'est pas un vide : côté disponibilité, une table
 * `barber_services` sans ligne signifie « pas de restriction », donc toute
 * l'équipe. C'est dit, pas deviné.
 */
export function AssignSheet({
  open,
  onOpenChange,
  serviceName,
  barbers,
  loading,
  saving,
  assigned,
  onSave,
}: AssignSheetProps) {
  const { t } = useTranslation('v2')
  const [selected, setSelected] = useState<string[]>(() => [...assigned])

  const toggle = (barberId: string, checked: boolean) => {
    setSelected((current) =>
      checked ? (current.includes(barberId) ? current : [...current, barberId]) : current.filter((id) => id !== barberId),
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('pro.catalog.assign.title')} description={serviceName}>
      <div className="flex flex-col gap-4" data-testid="pro-catalog-assign">
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.catalog.assign.hint')}</p>

        {loading ? (
          <div aria-busy="true" aria-label={t('common.a11y.loading')} className="flex flex-col">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : (
          <div className="flex flex-col">
            {barbers.map((barber) => (
              <Checkbox
                key={barber.id}
                label={barber.display_name}
                checked={selected.includes(barber.id)}
                onCheckedChange={(checked) => toggle(barber.id, checked)}
              />
            ))}
          </div>
        )}

        <Button
          variant="primary"
          loading={saving}
          onClick={() => onSave(selected)}
          data-testid="pro-catalog-assign-save"
        >
          {t('pro.catalog.assign.save')}
        </Button>
      </div>
    </Sheet>
  )
}
