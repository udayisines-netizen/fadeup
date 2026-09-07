import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSession } from '@/shared/hooks/useSession'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { OTPInput } from '@/shared/ui/OTPInput'
import { QRScanner, type QRScanError } from '@/shared/ui/QRScanner'
import { Sheet } from '@/shared/ui/Sheet'
import { IconInfo, IconQr } from '@/shared/ui/icons'
import { useJoinQueue, QueueJoinRefusedError, type JoinQueueResult, type PublicQueueFile } from '@/features/queue/api/publicQueue'
import { requestQueueOtp, verifyQueueOtp } from '@/features/queue/api/lightAuth'
import { parseQueueLink } from '@/shared/lib/queueLink'
import { refusalIsRetryable, refusalMessageKey, type QueueRefusalCode } from '@/features/queue/lib/refusals'

/**
 * Rejoindre la file — le QR donne le jeton, le navigateur donne la position,
 * LE SERVEUR tranche (géofence + jeton, mesurés en base, B1).
 *
 * Règles tenues ici :
 * - la géolocalisation n'est demandée QU'AU geste « Rejoindre », jamais à
 *   l'ouverture (MASTER_SPEC §8, F1 §5) ;
 * - les huit refus nommés produisent huit messages distincts et actionnables ;
 * - l'inscription est ultra-légère et OPTIONNELLE : un e-mail → code à six
 *   chiffres (B2 a rendu l'envoi opérationnel) ; sans e-mail, l'entrée est
 *   anonyme, exactement ce que `join_public_queue` prévoit (mode kiosque) ;
 * - aucun optimisme : l'entrée n'existe que quand la base l'a acceptée.
 */

type JoinStep = 'details' | 'scan' | 'otp'

/** Échecs LOCAUX (avant le serveur) — distincts des huit refus de la base. */
type LocalIssue = 'geo-denied' | 'geo-unavailable' | 'scan-failed' | 'otp-failed' | 'email-send-failed'

interface JoinQueueSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  slug: string
  locationId: string
  /** Jeton lu dans l'URL quand l'écran vient du QR ; sinon scan en séance. */
  initialToken: string | null
  /** File visée (F1b) — null ou barber_id null = « premier disponible ». */
  targetQueue: PublicQueueFile | null
  onJoined: (entry: JoinQueueResult, authenticated: boolean) => void
}

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 30_000,
    })
  })
}

export function JoinQueueSheet({ open, onOpenChange, slug, locationId, initialToken, targetQueue, onJoined }: JoinQueueSheetProps) {
  const { t } = useTranslation('v2')
  const { session } = useSession()
  const join = useJoinQueue()

  const [step, setStep] = useState<JoinStep>('details')
  const [token, setToken] = useState<string | null>(initialToken)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [refusal, setRefusal] = useState<QueueRefusalCode | null>(null)
  const [localIssue, setLocalIssue] = useState<LocalIssue | null>(null)
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)

  const resetFeedback = () => {
    setRefusal(null)
    setLocalIssue(null)
  }

  /** Géolocalise PUIS envoie — l'ordre visible par le client est celui du contrat. */
  const locateAndJoin = async (activeToken: string | null) => {
    setBusy(true)
    resetFeedback()
    let latitude: number | null = null
    let longitude: number | null = null
    if ('geolocation' in navigator) {
      try {
        const position = await getPosition()
        latitude = position.coords.latitude
        longitude = position.coords.longitude
      } catch (geoError) {
        setBusy(false)
        // PERMISSION_DENIED = 1 (constante de la spec Geolocation) ; le test
        // par code évite un instanceof fragile selon les navigateurs.
        const code = typeof geoError === 'object' && geoError !== null ? (geoError as { code?: number }).code : undefined
        setLocalIssue(code === 1 ? 'geo-denied' : 'geo-unavailable')
        return
      }
    }
    try {
      const entry = await join.mutateAsync({
        slug,
        locationId,
        customerName: name.trim(),
        barberId: targetQueue?.barber_id ?? null,
        checkInToken: activeToken,
        latitude,
        longitude,
      })
      onJoined(entry, Boolean(session))
      onOpenChange(false)
    } catch (error) {
      if (error instanceof QueueJoinRefusedError) {
        setRefusal(error.code)
        if (error.code === 'invalid_check_in_token') setToken(null)
      } else {
        setLocalIssue('geo-unavailable')
      }
    } finally {
      setBusy(false)
    }
  }

  const submitDetails = async () => {
    if (name.trim() === '') {
      setNameError(t('queue.join.nameRequired'))
      return
    }
    setNameError(undefined)
    resetFeedback()

    // Inscription légère : un e-mail fourni → code à usage unique, l'entrée
    // sera rattachée au compte et suivie par get_my_queue_status.
    if (!session && email.trim() !== '') {
      setBusy(true)
      const { ok: sent } = await requestQueueOtp(email.trim())
      setBusy(false)
      if (!sent) {
        setLocalIssue('email-send-failed')
        return
      }
      setStep('otp')
      return
    }

    if (!token) {
      setStep('scan')
      return
    }
    await locateAndJoin(token)
  }

  const submitOtp = async (code: string) => {
    setBusy(true)
    resetFeedback()
    const { ok: verified } = await verifyQueueOtp(email.trim(), code)
    setBusy(false)
    if (!verified) {
      setLocalIssue('otp-failed')
      setOtpCode('')
      return
    }
    if (!token) {
      setStep('scan')
      return
    }
    await locateAndJoin(token)
  }

  const handleScan = (value: string) => {
    const parsed = parseQueueLink(value)
    if (parsed?.checkInToken && (!parsed.locationId || parsed.locationId === locationId)) {
      setToken(parsed.checkInToken)
      setStep('details')
      void locateAndJoin(parsed.checkInToken)
      return
    }
    setLocalIssue('scan-failed')
  }

  const handleScanError = (_error: QRScanError) => {
    setLocalIssue('scan-failed')
    setStep('details')
  }

  const feedback = refusal
    ? { message: t(refusalMessageKey(refusal)), retryable: refusalIsRetryable(refusal) }
    : localIssue
      ? { message: t(`queue.join.issue.${localIssue}`), retryable: localIssue !== 'email-send-failed' }
      : null

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setStep('details')
          setOtpCode('')
          resetFeedback()
        }
      }}
      title={t('queue.join.title')}
      description={step === 'scan' ? t('queue.join.scanHint') : t('queue.join.presenceHint')}
    >
      {step === 'scan' ? (
        <div className="flex flex-col gap-4">
          <QRScanner active={open && step === 'scan'} onScan={handleScan} onError={handleScanError} className="w-full" />
          {feedback && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {feedback.message}
            </p>
          )}
          <Button variant="tertiary" onClick={() => setStep('details')}>
            {t('common.action.back')}
          </Button>
        </div>
      ) : step === 'otp' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (otpCode.length === 6) void submitOtp(otpCode)
          }}
        >
          <p className="text-fu-sm text-[var(--fu-text-secondary)]">{t('queue.join.otpSent', { email: email.trim() })}</p>
          <OTPInput
            label={t('queue.join.otpLabel')}
            value={otpCode}
            onValueChange={setOtpCode}
            onComplete={(code) => void submitOtp(code)}
            error={localIssue === 'otp-failed' ? t('queue.join.issue.otp-failed') : undefined}
            disabled={busy}
            autoFocus
          />
          {refusal && (
            <p role="alert" className="text-fu-sm text-[var(--fu-text-primary)]">
              {t(refusalMessageKey(refusal))}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy} disabled={otpCode.length !== 6}>
            {t('queue.join.confirmCode')}
          </Button>
          <Button variant="tertiary" onClick={() => setStep('details')} disabled={busy}>
            {t('common.action.back')}
          </Button>
        </form>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submitDetails()
          }}
        >
          {targetQueue && targetQueue.barber_id !== null && (
            <p className="text-fu-sm font-medium text-[var(--fu-text-primary)]" data-testid="queue-join-target">
              {t('queue.join.queueLabel', { name: targetQueue.display_name ?? '' })}
            </p>
          )}
          <Input
            label={t('queue.join.nameLabel')}
            hint={t('queue.join.nameHint')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={nameError}
            autoComplete="given-name"
            required
          />
          {!session && (
            <Input
              type="email"
              label={t('queue.join.emailLabel')}
              hint={t('queue.join.emailHint')}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          )}
          {feedback && (
            <p role="alert" className="flex items-start gap-2 text-fu-sm text-[var(--fu-text-primary)]" data-testid="queue-join-feedback">
              <IconInfo aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {feedback.message}
            </p>
          )}
          <Button type="submit" variant="primary" loading={busy}>
            {token ? t('queue.join.submit') : t('queue.join.scanCta')}
          </Button>
          {!token && (
            <p className="flex items-start gap-2 text-fu-xs text-[var(--fu-text-secondary)]">
              <IconQr aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {t('queue.join.tokenExplainer')}
            </p>
          )}
        </form>
      )}
    </Sheet>
  )
}
