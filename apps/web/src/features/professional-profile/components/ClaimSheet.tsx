import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { Textarea } from '@/shared/ui/Textarea'
import { useSubmitClaim } from '@/features/professional-profile/api/professionalProfile'

interface ClaimSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  professionalId: string
}

/**
 * Le chemin de revendication (F2 §5) : un professionnel qui découvre sa page
 * doit pouvoir dire « c'est moi ». La revendication est gratuite ; la
 * validation est faite par l'équipe (automatique si la preuve est forte,
 * manuelle sinon — MASTER_SPEC §5), jamais « dernier arrivé gagne ».
 *
 * Sans session : le geste mène à la connexion et RAMÈNE ici — la porte
 * d'entrée ne se referme pas sur l'intention.
 */
export function ClaimSheet({ open, onOpenChange, professionalId }: ClaimSheetProps) {
  const { t } = useTranslation('v2')
  const { session } = useSession()
  const location = useLocation()
  const [evidence, setEvidence] = useState('')
  const submit = useSubmitClaim(professionalId)

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('profile.unclaimed.claimTitle')}
      description={t('profile.unclaimed.claimDescription')}
    >
      {submit.isSuccess ? (
        <p className="text-fu-base leading-relaxed" role="status" data-testid="claim-submitted">
          {t('profile.unclaimed.claimSubmitted')}
        </p>
      ) : session ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate(evidence)
          }}
        >
          <Textarea
            label={t('profile.unclaimed.claimEvidenceLabel')}
            placeholder={t('profile.unclaimed.claimEvidencePlaceholder')}
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            rows={4}
          />
          {submit.isError && (
            <p className="text-fu-sm text-[var(--fu-text-secondary)]" role="alert">
              {t('profile.unclaimed.claimError')}
            </p>
          )}
          <Button type="submit" variant="primary" loading={submit.isPending} data-testid="claim-submit">
            {t('profile.unclaimed.claimSubmit')}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-fu-base leading-relaxed">{t('profile.unclaimed.claimSignInFirst')}</p>
          <Link
            to={`/auth/login?redirect=${encodeURIComponent(location.pathname)}`}
            className="inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-[var(--fu-accent)] px-4 text-fu-sm font-medium text-[var(--fu-accent-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)] focus-visible:ring-offset-2"
          >
            {t('common.action.signIn')}
          </Link>
        </div>
      )}
    </Sheet>
  )
}

/** Le point d'entrée discret, rendu sur tout profil non revendiqué. */
export function ClaimPrompt({ professionalName, onOpen }: { professionalName: string; onOpen: () => void }) {
  const { t } = useTranslation('v2')
  return (
    <p className="mt-4 flex flex-wrap items-center gap-2 text-fu-sm text-[var(--fu-text-secondary)]" data-testid="claim-prompt">
      {t('profile.unclaimed.claimPrompt')}
      <button
        type="button"
        onClick={onOpen}
        className="min-h-11 font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--fu-focus)]"
        aria-label={`${t('profile.unclaimed.claimPrompt')} ${t('profile.unclaimed.claimAction')} — ${professionalName}`}
      >
        {t('profile.unclaimed.claimAction')}
      </button>
    </p>
  )
}
