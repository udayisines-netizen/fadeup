import { useState } from 'react'
import { Platform, StyleSheet, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import * as Location from 'expo-location'

import {
  QueueJoinRefusedError,
  useJoinQueue,
  type JoinQueueResult,
  type PublicQueueFile,
} from '@/features/queue/api/publicQueue'
import { requestQueueOtp, verifyQueueOtp } from '@/features/queue/api/lightAuth'
import { refusalMessageKey, type QueueRefusalCode } from '@/features/queue/lib/refusals'
import { QrScanner } from '@/features/queue/components/QrScanner'
import { QueueFileList } from '@/features/queue/components/QueueFileList'
import { useSession } from '@/shared/data/auth'
import { parseQueueLink } from '@/shared/lib/queueLink'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { FuText } from '@/shared/ui/Text'

/**
 * Rejoindre la file — le QR donne le jeton, l'APPAREIL donne la position,
 * LE SERVEUR tranche (géofence + jeton, mesurés en base). Transposition de
 * apps/web JoinQueueSheet.tsx ; les règles sont inchangées :
 *
 *  - la géolocalisation n'est demandée QU'AU geste « Rejoindre », jamais à
 *    l'ouverture de l'écran (MASTER_SPEC §8, F1 §5) — et les coordonnées
 *    partent BRUTES, jamais un verdict de distance calculé ici ;
 *  - les refus nommés produisent des messages distincts et actionnables, lus
 *    sur le CODE renvoyé (jamais sur le texte, jamais sur le statut HTTP) ;
 *  - l'inscription est ultra-légère et OPTIONNELLE : un e-mail → code à six
 *    chiffres ; sans e-mail l'entrée est anonyme, exactement ce que
 *    `join_public_queue` prévoit ;
 *  - aucun optimisme : l'entrée n'existe que quand la base l'a acceptée.
 */

type JoinStep = 'details' | 'scan' | 'otp'

/** Échecs LOCAUX (avant le serveur) — distincts des refus nommés de la base. */
type LocalIssue = 'geo-denied' | 'geo-unavailable' | 'scan-failed' | 'otp-failed' | 'email-send-failed'

/** Le web laisse 15 s au navigateur ; expo-location n'a pas d'option de
 *  délai, on la pose nous-mêmes (au-delà : « position indéterminable »). */
const GEO_TIMEOUT_MS = 15_000

export interface JoinQueueSheetProps {
  open: boolean
  onClose: () => void
  slug: string
  locationId: string
  /** Jeton lu dans le lien quand l'écran vient du QR ; sinon scan en séance. */
  initialToken: string | null
  /** File visée à l'ouverture (F1b) — null ou barber_id null = « premier
   *  disponible ». Le client peut encore en changer ICI, sans refermer. */
  targetQueue: PublicQueueFile | null
  /** Toutes les files du lieu — le choix reste possible dans la feuille. */
  queues: PublicQueueFile[]
  onJoined: (entry: JoinQueueResult, authenticated: boolean) => void
}

type GeoResult =
  | { ok: true; latitude: number; longitude: number }
  | { ok: false; issue: 'geo-denied' | 'geo-unavailable' }

async function locateNow(): Promise<GeoResult> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync()
    if (!permission.granted) return { ok: false, issue: 'geo-denied' }
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), GEO_TIMEOUT_MS)),
    ])
    if (!position) return { ok: false, issue: 'geo-unavailable' }
    return { ok: true, latitude: position.coords.latitude, longitude: position.coords.longitude }
  } catch {
    return { ok: false, issue: 'geo-unavailable' }
  }
}

export function JoinQueueSheet({
  open,
  onClose,
  slug,
  locationId,
  initialToken,
  targetQueue,
  queues,
  onJoined,
}: JoinQueueSheetProps) {
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
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /** Choix de file FAIT DANS LA FEUILLE — il prime sur la cible d'ouverture
   *  et retombe à la fermeture (pas d'état dérivé recopié dans un effet). */
  const [pickedOverride, setPickedOverride] = useState<PublicQueueFile | null>(null)
  const pickedQueue = pickedOverride ?? targetQueue

  const resetFeedback = () => {
    setRefusal(null)
    setLocalIssue(null)
  }

  const close = () => {
    setStep('details')
    setPickedOverride(null)
    setOtpCode('')
    setBusy(false)
    resetFeedback()
    onClose()
  }

  /** Géolocalise PUIS envoie — l'ordre visible par le client est le contrat. */
  const locateAndJoin = async (activeToken: string | null) => {
    setBusy(true)
    resetFeedback()
    const position = await locateNow()
    if (!position.ok) {
      setBusy(false)
      setLocalIssue(position.issue)
      return
    }
    try {
      const entry = await join.mutateAsync({
        slug,
        locationId,
        customerName: name.trim(),
        barberId: pickedQueue?.barber_id ?? null,
        checkInToken: activeToken,
        latitude: position.latitude,
        longitude: position.longitude,
      })
      setBusy(false)
      onJoined(entry, Boolean(session))
      close()
      return
    } catch (error) {
      if (error instanceof QueueJoinRefusedError) {
        setRefusal(error.code)
        // Jeton périmé/faux : on le purge et on repropose le scan.
        if (error.code === 'invalid_check_in_token') {
          setToken(null)
          setStep('scan')
        }
      } else {
        setLocalIssue('geo-unavailable')
      }
    }
    setBusy(false)
  }

  const submitDetails = async () => {
    if (name.trim() === '') {
      setNameError(t('queue.join.nameRequired'))
      return
    }
    setNameError(null)
    resetFeedback()

    // Inscription légère : un e-mail fourni → code à usage unique, l'entrée
    // sera rattachée au compte et retrouvée par get_my_queue_status.
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

  /** Un QR d'un AUTRE lieu est refusé LOCALEMENT, avant tout appel. */
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

  /* Un refus nommé prime sur un échec local ; le message est TOUJOURS lu sur
     le code, jamais sur le texte brut renvoyé par la base. */
  const feedbackMessage = refusal
    ? t(refusalMessageKey(refusal))
    : localIssue
      ? t(`queue.join.issue.${localIssue}`)
      : null

  return (
    <Sheet open={open} onClose={close} title={t('queue.join.title')}>
      <View style={styles.body}>
        <FuText variant="title">{t('queue.join.title')}</FuText>
        <FuText variant="sm" tone="secondary">
          {step === 'scan' ? t('queue.join.scanHint') : t('queue.join.presenceHint')}
        </FuText>

        {step === 'scan' ? (
          <>
            <QrScanner onScan={handleScan} />
            {feedbackMessage ? <Feedback message={feedbackMessage} /> : null}
            <Button
              label={t('common.action.back')}
              variant="secondary"
              fullWidth
              onPress={() => {
                resetFeedback()
                setStep('details')
              }}
            />
          </>
        ) : step === 'otp' ? (
          <>
            <FuText variant="sm" tone="secondary">
              {t('queue.join.otpSent', { email: email.trim() })}
            </FuText>
            <TextInput
              value={otpCode}
              onChangeText={(value) => setOtpCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={color.textTertiary}
              autoFocus
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType="oneTimeCode"
              autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
              returnKeyType="done"
              editable={!busy}
              onSubmitEditing={() => {
                if (otpCode.length === 6) void submitOtp(otpCode)
              }}
              accessibilityLabel={t('queue.join.otpLabel')}
              style={[styles.input, styles.codeInput]}
            />
            {feedbackMessage ? <Feedback message={feedbackMessage} /> : null}
            <Button
              label={t('queue.join.confirmCode')}
              size="lg"
              fullWidth
              loading={busy}
              disabled={otpCode.length !== 6}
              onPress={() => void submitOtp(otpCode)}
            />
            <Button
              label={t('common.action.back')}
              variant="secondary"
              fullWidth
              disabled={busy}
              onPress={() => {
                resetFeedback()
                setStep('details')
              }}
            />
          </>
        ) : (
          <>
            {/* Plusieurs files : le choix du barber reste offert ICI —
                « premier disponible » en tête, sélectionné par défaut. */}
            {queues.length > 1 ? (
              <View style={styles.field}>
                <FuText variant="smMedium">{t('queue.public.queuesLabel')}</FuText>
                <QueueFileList
                  queues={queues}
                  selectedBarberId={pickedQueue ? pickedQueue.barber_id : null}
                  onPick={setPickedOverride}
                />
              </View>
            ) : pickedQueue && pickedQueue.barber_id !== null ? (
              <FuText variant="bodyMedium">
                {t('queue.join.queueLabel', { name: pickedQueue.display_name ?? '' })}
              </FuText>
            ) : null}

            <View style={styles.field}>
              <FuText variant="smMedium">{t('queue.join.nameLabel')}</FuText>
              <TextInput
                value={name}
                onChangeText={(value) => {
                  setName(value)
                  if (nameError) setNameError(null)
                }}
                placeholder={t('queue.join.nameLabel')}
                placeholderTextColor={color.textTertiary}
                autoComplete="given-name"
                autoCapitalize="words"
                returnKeyType="next"
                editable={!busy}
                accessibilityLabel={t('queue.join.nameLabel')}
                style={[styles.input, nameError ? styles.inputError : null]}
              />
              <FuText variant="sm" tone="tertiary">
                {t('queue.join.nameHint')}
              </FuText>
              {nameError ? (
                <FuText variant="sm" tone="danger" accessibilityRole="alert">
                  {nameError}
                </FuText>
              ) : null}
            </View>

            {!session ? (
              <View style={styles.field}>
                <FuText variant="smMedium">{t('queue.join.emailLabel')}</FuText>
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder={t('queue.join.emailLabel')}
                  placeholderTextColor={color.textTertiary}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  inputMode="email"
                  returnKeyType="done"
                  editable={!busy}
                  accessibilityLabel={t('queue.join.emailLabel')}
                  style={styles.input}
                />
                <FuText variant="sm" tone="tertiary">
                  {t('queue.join.emailHint')}
                </FuText>
              </View>
            ) : null}

            {feedbackMessage ? <Feedback message={feedbackMessage} /> : null}

            <Button
              label={token ? t('queue.join.submit') : t('queue.join.scanCta')}
              size="lg"
              fullWidth
              loading={busy}
              onPress={() => void submitDetails()}
            />
            {!token ? (
              <View style={styles.hintRow}>
                <Ionicons name="qr-code-outline" size={16} color={color.textSecondary} />
                <FuText variant="sm" tone="secondary" style={styles.hintText}>
                  {t('queue.join.tokenExplainer')}
                </FuText>
              </View>
            ) : null}
          </>
        )}
      </View>
    </Sheet>
  )
}

function Feedback({ message }: { message: string }) {
  return (
    <View style={styles.feedback} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Ionicons name="information-circle-outline" size={18} color={color.textPrimary} />
      <FuText variant="sm" style={styles.hintText}>
        {message}
      </FuText>
    </View>
  )
}

const styles = StyleSheet.create({
  body: { gap: spacing(3), paddingBottom: spacing(2) },
  field: { gap: spacing(1) },
  input: {
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing(4),
    borderRadius: radius.control,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    fontSize: 16,
    color: color.textPrimary,
  },
  inputError: { borderColor: color.danger },
  codeInput: { letterSpacing: 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
  feedback: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(2),
    padding: spacing(3),
    borderRadius: radius.control,
    backgroundColor: color.surfaceSubtle,
  },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2) },
  hintText: { flex: 1 },
})
