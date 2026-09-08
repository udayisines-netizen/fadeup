/**
 * M1b — LA feuille d'auth légère. Elle remplace la feuille « la connexion
 * arrive » de M1a, partout où une action exige une session (suivre, aimer,
 * mes réservations, compte).
 *
 * Le contrat produit : l'inscription se déclenche À L'ACTION, jamais à
 * l'ouverture — et le parcours REPREND EXACTEMENT où il était. C'est
 * structurel ici : la feuille se pose PAR-DESSUS l'écran courant, la session
 * arrive sans aucune navigation, `onAuthed` rejoue l'intention.
 *
 * Deux chemins : code e-mail à six chiffres (le motif F1b/F4) et Google
 * (navigateur système). Apple est M1c — aucune fondation posée.
 */
import { useState } from 'react'
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from 'react-native'
import { useTranslation } from 'react-i18next'

import { authErrorKey, requestEmailOtp, signInWithGoogle, verifyEmailOtp } from '@/shared/data/auth'
import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { Sheet } from '@/shared/ui/Sheet'
import { FuText } from '@/shared/ui/Text'

export type AuthContext = 'follow' | 'like' | 'bookings' | 'account' | 'generic'

const CONTEXT_KEY: Record<AuthContext, string | null> = {
  follow: 'mobile.auth.contextFollow',
  like: 'mobile.auth.contextLike',
  bookings: 'mobile.auth.contextBookings',
  account: 'mobile.auth.contextAccount',
  generic: null,
}

export interface AuthSheetProps {
  open: boolean
  context?: AuthContext
  onClose: () => void
  /** Appelé une fois la session posée — l'appelant rejoue l'intention. */
  onAuthed?: () => void
}

export function AuthSheet({ open, context = 'generic', onClose, onAuthed }: AuthSheetProps) {
  const { t } = useTranslation('v2')
  const [phase, setPhase] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [errorKey, setErrorKey] = useState<string | null>(null)

  const reset = () => {
    setPhase('email')
    setCode('')
    setBusy(false)
    setErrorKey(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const succeed = () => {
    reset()
    onClose()
    onAuthed?.()
  }

  const sendCode = async () => {
    if (busy || email.trim().length === 0) return
    setBusy(true)
    setErrorKey(null)
    try {
      await requestEmailOtp(email.trim())
      setPhase('code')
    } catch (error) {
      setErrorKey(authErrorKey(error))
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async () => {
    if (busy || code.trim().length < 6) return
    setBusy(true)
    setErrorKey(null)
    try {
      await verifyEmailOtp(email.trim(), code.trim())
      succeed()
    } catch (error) {
      setErrorKey(authErrorKey(error))
      setBusy(false)
    }
  }

  const google = async () => {
    if (busy) return
    setBusy(true)
    setErrorKey(null)
    try {
      const { ok } = await signInWithGoogle()
      if (ok) {
        succeed()
        return
      }
      setErrorKey('mobile.auth.googleFailed')
    } catch {
      setErrorKey('mobile.auth.googleFailed')
    } finally {
      setBusy(false)
    }
  }

  const contextKey = CONTEXT_KEY[context]

  return (
    <Sheet open={open} onClose={close} title={t('mobile.auth.title')}>
      <View style={styles.body}>
        {contextKey ? (
          <FuText variant="bodyMedium">{t(contextKey)}</FuText>
        ) : null}

        {phase === 'email' ? (
          <>
            <FuText variant="sm" tone="secondary">
              {t('mobile.auth.body')}
            </FuText>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder={t('mobile.auth.emailLabel')}
              placeholderTextColor={color.textTertiary}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              returnKeyType="send"
              onSubmitEditing={() => void sendCode()}
              accessibilityLabel={t('mobile.auth.emailLabel')}
              style={styles.input}
            />
            <Button
              label={t('mobile.auth.sendCode')}
              size="lg"
              fullWidth
              loading={busy}
              disabled={email.trim().length === 0}
              onPress={() => void sendCode()}
            />
            <View style={styles.orRow} accessibilityElementsHidden>
              <View style={styles.orLine} />
              <FuText variant="sm" tone="tertiary">
                {t('mobile.auth.or')}
              </FuText>
              <View style={styles.orLine} />
            </View>
            <Button
              label={t('mobile.auth.google')}
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => void google()}
            />
          </>
        ) : (
          <>
            <FuText variant="sm" tone="secondary">
              {t('auth.otp.subtitle', { email: email.trim() })}
            </FuText>
            <TextInput
              value={code}
              onChangeText={(value) => setCode(value.replace(/[^0-9]/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={color.textTertiary}
              autoFocus
              keyboardType="number-pad"
              inputMode="numeric"
              textContentType="oneTimeCode"
              autoComplete={Platform.OS === 'ios' ? 'one-time-code' : 'sms-otp'}
              returnKeyType="done"
              onSubmitEditing={() => void submitCode()}
              accessibilityLabel={t('auth.otp.code')}
              style={[styles.input, styles.codeInput]}
            />
            <Button
              label={t('auth.otp.submit')}
              size="lg"
              fullWidth
              loading={busy}
              disabled={code.trim().length < 6}
              onPress={() => void submitCode()}
            />
            <View style={styles.secondaryRow}>
              <Button label={t('auth.otp.resend')} variant="ghost" onPress={() => void sendCode()} />
              <Button
                label={t('auth.otp.changeEmail')}
                variant="ghost"
                onPress={() => {
                  setPhase('email')
                  setCode('')
                  setErrorKey(null)
                }}
              />
            </View>
          </>
        )}

        {errorKey ? (
          <FuText variant="sm" tone="danger" accessibilityRole="alert">
            {t(errorKey)}
          </FuText>
        ) : null}
        {busy && phase === 'email' ? <ActivityIndicator color={color.accentText} /> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: {
    gap: spacing(3),
    paddingBottom: spacing(2),
  },
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
  codeInput: {
    letterSpacing: 8,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(3),
  },
  orLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: color.border,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
})
