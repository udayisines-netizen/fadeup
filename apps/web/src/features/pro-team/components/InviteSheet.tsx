import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProMembershipRole } from '@/shared/data/organization'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { Sheet } from '@/shared/ui/Sheet'

/**
 * OS-2 — la feuille d'invitation. Trois champs au plus, et la règle du lien
 * DITE AVANT l'envoi : sept jours, usage unique, un renvoi annule le
 * précédent. Le professionnel ne doit pas découvrir ça après coup.
 *
 * Aucun second chemin d'envoi : ce formulaire appelle `invite_team_member`,
 * la base dépose le message dans `email_outbox`.
 */

export interface InviteSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** L'option `owner` n'est proposée qu'à un owner (miroir de la garde SQL). */
  canInviteOwner: boolean
  locations: Array<{ id: string; name: string }>
  pending: boolean
  /** Message d'échec déjà traduit — le refus nommé de la base. */
  error: string | null
  onSubmit: (input: { email: string; role: ProMembershipRole; locationId: string | null }) => void
}

const ANY_LOCATION = 'any'

export function InviteSheet({
  open,
  onOpenChange,
  canInviteOwner,
  locations,
  pending,
  error,
  onSubmit,
}: InviteSheetProps) {
  const { t } = useTranslation('v2')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<ProMembershipRole>('barber')
  const [locationId, setLocationId] = useState<string>(ANY_LOCATION)

  const roleOptions = (
    canInviteOwner
      ? (['owner', 'manager', 'receptionist', 'barber'] as const)
      : (['manager', 'receptionist', 'barber'] as const)
  ).map((value) => ({ value, label: t(`pro.team.role.${value}`) }))

  /* Un seul établissement : le champ ne se rend pas — l'invitation y va
     forcément. Plusieurs : « tous les établissements » reste possible. */
  const showLocation = locations.length > 1

  const submit = () => {
    onSubmit({
      email: email.trim(),
      role,
      locationId: showLocation && locationId !== ANY_LOCATION ? locationId : null,
    })
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setEmail('')
          setRole('barber')
          setLocationId(ANY_LOCATION)
        }
        onOpenChange(next)
      }}
      title={t('pro.team.inviteSheet.title')}
      className="md:w-[26rem]"
    >
      <form
        data-testid="pro-team-invite-sheet"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          type="email"
          autoComplete="email"
          inputMode="email"
          label={t('pro.team.inviteSheet.email')}
          hint={t('pro.team.inviteSheet.emailHint')}
          error={error ?? undefined}
          value={email}
          data-testid="pro-team-invite-email"
          onChange={(event) => setEmail(event.target.value)}
        />

        <Select
          label={t('pro.team.inviteSheet.role')}
          options={roleOptions}
          value={role}
          onValueChange={(value) => setRole(value as ProMembershipRole)}
        />

        {showLocation && (
          <Select
            label={t('pro.team.inviteSheet.location')}
            options={[
              { value: ANY_LOCATION, label: t('pro.team.inviteSheet.locationAny') },
              ...locations.map((location) => ({ value: location.id, label: location.name })),
            ]}
            value={locationId}
            onValueChange={setLocationId}
          />
        )}

        {/* La règle du lien, VISIBLE avant l'envoi. */}
        <p className="rounded-[var(--radius-card)] bg-[var(--fu-surface-subtle)] p-3 text-fu-sm text-[var(--fu-text-secondary)]">
          {t('pro.team.inviteSheet.expiryNotice')}
        </p>

        <div className="flex flex-col gap-2">
          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={pending}
            data-testid="pro-team-invite-submit"
          >
            {t('pro.team.inviteSheet.send')}
          </Button>
          <Button variant="tertiary" fullWidth onClick={() => onOpenChange(false)}>
            {t('pro.team.inviteSheet.cancel')}
          </Button>
        </div>
      </form>
    </Sheet>
  )
}
