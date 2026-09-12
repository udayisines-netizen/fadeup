import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { Dialog } from '@/shared/ui/Dialog'
import { Select } from '@/shared/ui/Select'
import type { TeamMember } from '@/features/pro-team/api/team'
import { reassignCandidates } from '@/features/pro-team/lib/reassign'

/**
 * OS-2 — le moment délicat de l'écran. Trois choses doivent se lire AVANT
 * de confirmer :
 *
 *  1. retirer quelqu'un NE SUPPRIME PAS son profil professionnel — handle,
 *     abonnés, portfolio et historique public lui appartiennent
 *     (MASTER_SPEC §9, identité à trois couches). C'est une loi produit,
 *     pas une note de bas de page ;
 *  2. ce qui se ferme vraiment : l'accès, le fauteuil, la file ;
 *  3. qui reprend les rendez-vous à venir — obligatoire dès qu'il en reste
 *     un (la base REFUSE sans remplaçant plutôt que d'annuler dans le dos
 *     du salon). Le bouton reste `disabled` tant que rien n'est choisi :
 *     c'est « momentanément impossible », pas « pas le droit ».
 */

export interface RemoveMemberDialogProps {
  member: TeamMember | null
  members: TeamMember[]
  pending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onConfirm: (reassignToBarberId: string | null) => void
}

export function RemoveMemberDialog({
  member,
  members,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: RemoveMemberDialogProps) {
  const { t } = useTranslation('v2')
  const [reassignTo, setReassignTo] = useState<string>('')

  useEffect(() => {
    setReassignTo('')
  }, [member])

  /* Le nombre vient de la RPC (`upcoming_appointments`) — jamais estimé. */
  const upcoming = member?.upcoming_appointments ?? 0
  const needsReassign = upcoming > 0
  const candidates = member ? reassignCandidates(members, member.membership_id) : []
  const blocked = needsReassign && reassignTo === ''

  return (
    <Dialog
      open={member !== null}
      onOpenChange={onOpenChange}
      title={t('pro.team.remove.title', { name: member?.display_name ?? '' })}
    >
      <div data-testid="pro-team-remove-dialog" className="flex flex-col gap-3">
        {/* La loi produit, en évidence — pas une ligne de plus dans un corps de texte. */}
        <p
          data-testid="pro-team-remove-identity-notice"
          className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface-subtle)] p-3 text-fu-sm text-[var(--fu-text-primary)]"
        >
          {t('pro.team.remove.identityNotice')}
        </p>

        <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('pro.team.remove.effects')}</p>

        {needsReassign && (
          <div className="flex flex-col gap-1.5">
            <Select
              label={t('pro.team.remove.reassignLabel')}
              options={candidates.map((candidate) => ({
                value: candidate.barber_id ?? '',
                label: candidate.display_name,
              }))}
              /* Contrôlé dès le départ : Radix affiche le placeholder sur la
                 chaîne vide, sans bascule non-contrôlé → contrôlé. */
              value={reassignTo}
              placeholder={t('pro.team.remove.reassignLabel')}
              hint={t('pro.team.remove.reassignHint', { count: upcoming })}
              onValueChange={setReassignTo}
            />
            {blocked && (
              <p className="text-fu-xs text-[var(--fu-text-secondary)]">{t('pro.team.remove.reassignRequired')}</p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-fu-sm text-[color:var(--fu-danger)]">
            {error}
          </p>
        )}

        <div className="mt-1 flex flex-col gap-2">
          <Button
            variant="destructive"
            fullWidth
            loading={pending}
            disabled={blocked}
            data-testid="pro-team-remove-confirm"
            onClick={() => onConfirm(needsReassign ? reassignTo : null)}
          >
            {t('pro.team.remove.confirm')}
          </Button>
          <Button variant="tertiary" fullWidth onClick={() => onOpenChange(false)}>
            {t('pro.team.remove.cancel')}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
