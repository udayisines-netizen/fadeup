import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { Textarea } from '@/shared/ui/Textarea'
import { IconInfo } from '@/shared/ui/icons'
import {
  fetchProfessionalRef,
  parseProfessionalRef,
  useProfessionalRef,
  useSubmitWithdrawal,
  WithdrawalRefusedError,
  withdrawalRefusalMessageKey,
  type PublicProfessionalRef,
  type WithdrawalResult,
} from '@/features/legal/api/legal'

/**
 * Le formulaire de retrait (X2, chantier 1). Il ENREGISTRE une demande dans
 * le circuit opérateur B2 — rien n'est dépublié depuis le navigateur : un
 * membre de l'équipe vérifie que le demandeur est bien le professionnel
 * concerné (sinon n'importe qui déréférencerait n'importe quel commerce,
 * l'objection exacte de B2), puis l'engagement des 72 h court.
 *
 * `initialRef` vient de `?pro=` (lien du profil ou de l'e-mail d'information) ;
 * `token` vient de `?t=` (l'e-mail) et marque la demande comme vérifiée par
 * contrôle de la boîte aux lettres, côté opérateur.
 */
export function WithdrawalForm({ initialRef, token }: { initialRef: string | null; token: string | null }) {
  const { t, i18n } = useTranslation('v2')

  const [refInput, setRefInput] = useState('')
  const [refLocked, setRefLocked] = useState(Boolean(initialRef))
  const [refError, setRefError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [resolving, setResolving] = useState(false)
  const [refusalKey, setRefusalKey] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [result, setResult] = useState<WithdrawalResult | null>(null)

  const prefilled = useProfessionalRef(refLocked ? initialRef : null)
  const submit = useSubmitWithdrawal()

  const formatDeadline = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long', timeStyle: 'short' }).format(new Date(iso))

  const runSubmit = async (professional: PublicProfessionalRef) => {
    setRefusalKey(null)
    setFailed(false)
    try {
      const row = await submit.mutateAsync({
        professionalId: professional.id,
        requesterEmail: email.trim() || undefined,
        requesterNote: note.trim() || undefined,
        token: token ?? undefined,
      })
      setResult(row)
    } catch (error) {
      if (error instanceof WithdrawalRefusedError) setRefusalKey(withdrawalRefusalMessageKey(error.code))
      else setFailed(true)
    }
  }

  const onSubmit = async () => {
    setRefError(null)
    if (refLocked && prefilled.data) {
      await runSubmit(prefilled.data)
      return
    }
    const parsed = parseProfessionalRef(refInput)
    if (!parsed) {
      setRefError(t('legal.withdrawal.refRequired'))
      return
    }
    setResolving(true)
    let professional: PublicProfessionalRef | null
    try {
      professional = await fetchProfessionalRef(parsed)
    } catch {
      setResolving(false)
      setRefError(t('legal.withdrawal.refLookupFailed'))
      return
    }
    setResolving(false)
    if (!professional) {
      setRefError(t('legal.withdrawal.refNotFound'))
      return
    }
    if (professional.claim_state === 'claimed') {
      setRefusalKey(withdrawalRefusalMessageKey('professional_is_claimed'))
      return
    }
    await runSubmit(professional)
  }

  if (result) {
    return (
      <div
        role="status"
        data-testid="withdrawal-success"
        className="rounded-[var(--radius-card)] border border-[var(--fu-border)] bg-[var(--fu-surface-subtle)] p-4"
      >
        <p className="text-fu-base font-semibold text-[var(--fu-text-primary)]">
          {result.already_pending ? t('legal.withdrawal.alreadyPendingTitle') : t('legal.withdrawal.successTitle')}
        </p>
        <p className="mt-1 text-fu-sm text-[var(--fu-text-secondary)]">
          {result.already_pending
            ? t('legal.withdrawal.alreadyPendingBody', { deadline: formatDeadline(result.deadline_at) })
            : t('legal.withdrawal.successBody', { deadline: formatDeadline(result.deadline_at) })}
        </p>
      </div>
    )
  }

  // La fiche arrivée par lien : nommée, verrouillée, remplaçable. Un profil
  // revendiqué n'est pas retirable ici — son propriétaire contrôle sa
  // visibilité depuis son compte.
  const prefilledClaimed = refLocked && prefilled.data?.claim_state === 'claimed'

  return (
    <form
      noValidate
      data-testid="withdrawal-form"
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit()
      }}
    >
      {refLocked && prefilled.data ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-fu-base font-medium text-[var(--fu-text-primary)]" data-testid="withdrawal-concerning">
            {t('legal.withdrawal.concerning', { name: prefilled.data.display_name })}
          </p>
          <Button
            variant="tertiary"
            size="sm"
            type="button"
            onClick={() => {
              setRefLocked(false)
              setRefusalKey(null)
            }}
          >
            {t('legal.withdrawal.changeRef')}
          </Button>
        </div>
      ) : refLocked && prefilled.isLoading ? (
        <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('common.loading.generic')}</p>
      ) : (
        <Input
          label={t('legal.withdrawal.refLabel')}
          hint={t('legal.withdrawal.refHint')}
          value={refInput}
          onChange={(event) => setRefInput(event.target.value)}
          error={refError ?? undefined}
          required
        />
      )}

      {prefilledClaimed ? (
        <p role="status" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="withdrawal-claimed">
          <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {t('legal.withdrawal.claimed')}{' '}
            <Link to="/auth/login" className="font-medium text-[var(--fu-accent-text)] underline-offset-2 hover:underline">
              {t('common.action.signIn')}
            </Link>
          </span>
        </p>
      ) : (
        <>
          <Input
            type="email"
            label={t('legal.withdrawal.emailLabel')}
            hint={t('legal.withdrawal.emailHint')}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />
          <Textarea
            label={t('legal.withdrawal.noteLabel')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            rows={3}
          />
          {refusalKey && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="withdrawal-refusal">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t(refusalKey)}
            </p>
          )}
          {failed && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="withdrawal-error">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('legal.withdrawal.error')}
            </p>
          )}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={resolving || submit.isPending}
            data-testid="withdrawal-submit"
          >
            {t('legal.withdrawal.submit')}
          </Button>
        </>
      )}
    </form>
  )
}
