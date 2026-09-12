/**
 * M1c-a — LE liant natif du push : la seule pièce qui parle à
 * `expo-notifications`. Tout ce qui est décidable sans le natif vit dans
 * `lib/permissionMoment.ts` et `lib/pushAvailability.ts`, testés sous Node.
 *
 * CE QU'IL NE FAIT PAS
 *
 * Il ne demande RIEN à l'ouverture. `ensureRegistered()` n'agit que si le
 * système a DÉJÀ accordé la permission ; `requestAndRegister()` n'est appelé
 * que depuis la feuille de permission, qui n'apparaît qu'après avoir rejoint
 * une file (prompt §3).
 *
 * CE QU'IL NE PEUT PAS FAIRE AUJOURD'HUI
 *
 * Obtenir un jeton. Deux verrous, tous deux déclarés au rapport :
 *  - Expo Go n'embarque plus le push distant depuis le SDK 53 : il faut un
 *    build de développement, donc une signature, donc la licence Apple ;
 *  - `getExpoPushTokenAsync` exige `extra.eas.projectId`, qui n'existe pas
 *    encore (compte Expo gratuit, indépendant d'Apple).
 *
 * L'échec est donc le chemin NORMAL en l'état, et il est traité comme tel :
 * classé, jamais présenté comme un succès, et sans rien casser autour.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Platform } from 'react-native'
import { useTranslation } from 'react-i18next'

import { registerPushDevice, revokePushDevice } from '@/features/notifications/api/devices'
import type { PushPlatform } from '@/features/notifications/api/pushClient'
import {
  classifyPushFailure,
  type PushUnavailableReason,
} from '@/features/notifications/lib/pushAvailability'
import {
  markAlreadyAsked,
  readAlreadyAsked,
  type SystemPermissionStatus,
} from '@/features/notifications/lib/permissionMoment'

/** Le dernier jeton enregistré, pour pouvoir le révoquer à la déconnexion. */
const TOKEN_STORAGE_KEY = 'fu.pushToken.v1'

export interface PushAttempt {
  granted: boolean
  registered: boolean
  reason?: PushUnavailableReason
}

function nativePlatform(): PushPlatform {
  return Platform.OS === 'android' ? 'android' : 'ios'
}

function toStatus(status: Notifications.PermissionStatus): SystemPermissionStatus {
  if (status === 'granted') return 'granted'
  if (status === 'denied') return 'denied'
  return 'undetermined'
}

async function readSystemStatus(): Promise<SystemPermissionStatus> {
  try {
    const settings = await Notifications.getPermissionsAsync()
    // iOS : une autorisation « provisoire » compte comme accordée — les
    // notifications arrivent, discrètement, et le canal existe.
    if (settings.granted || settings.ios?.status === 3 /* provisional */) return 'granted'
    return toStatus(settings.status)
  } catch {
    return 'undetermined'
  }
}

/**
 * `getExpoPushTokenAsync` fait un APPEL RÉSEAU aux serveurs d'Expo, et la
 * documentation le dit : il peut échouer, et il peut TRAÎNER. Sans borne, un
 * réseau qui répond mal laisse le geste du client sans réponse — constaté au
 * harnais de QA, où l'écran ne rendait plus la main. Dix secondes, puis on
 * classe l'échec comme un problème réseau et on le dit.
 */
const TOKEN_TIMEOUT_MS = 10_000

async function acquireExpoToken(): Promise<string> {
  if (!Device.isDevice) {
    throw Object.assign(new Error('push requires a physical device'), { code: 'ERR_UNAVAILABLE' })
  }
  const projectId =
    Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? undefined

  const token = Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(
      () => reject(Object.assign(new Error('push token request timed out'), { code: 'ERR_TIMEOUT' })),
      TOKEN_TIMEOUT_MS,
    )
  })
  const { data } = await Promise.race([token, timeout])
  return data
}

export function usePushDevice() {
  const { i18n } = useTranslation('v2')
  const [status, setStatus] = useState<SystemPermissionStatus | null>(null)
  const [alreadyAsked, setAlreadyAsked] = useState<boolean | null>(null)
  const [lastReason, setLastReason] = useState<PushUnavailableReason | null>(null)
  /** Évite deux enregistrements concurrents au même montage. */
  const busy = useRef(false)

  useEffect(() => {
    let alive = true
    void readSystemStatus().then((value) => {
      if (alive) setStatus(value)
    })
    void readAlreadyAsked(AsyncStorage).then((value) => {
      if (alive) setAlreadyAsked(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const locale = i18n.language === 'en' ? 'en' : 'fr'

  const register = useCallback(
    async (queueEntryId: string | null): Promise<PushAttempt> => {
      if (busy.current) return { granted: true, registered: false, reason: 'unknown' }
      busy.current = true
      try {
        const token = await acquireExpoToken()
        await registerPushDevice({
          token,
          platform: nativePlatform(),
          locale,
          queueEntryId,
        })
        try {
          await AsyncStorage.setItem(TOKEN_STORAGE_KEY, token)
        } catch {
          /* stockage indisponible : le jeton vit côté serveur, c'est l'essentiel */
        }
        setLastReason(null)
        return { granted: true, registered: true }
      } catch (error) {
        const reason = classifyPushFailure(error)
        setLastReason(reason)
        return { granted: true, registered: false, reason }
      } finally {
        busy.current = false
      }
    },
    [locale],
  )

  /**
   * Demande la permission PUIS enregistre. Appelé uniquement depuis la
   * feuille, elle-même ouverte après avoir rejoint une file.
   */
  const requestAndRegister = useCallback(
    async (queueEntryId: string | null): Promise<PushAttempt> => {
      // Marqué demandé AVANT l'appel système : si l'application est tuée
      // pendant l'invite, la question ne doit pas se reposer — le système,
      // lui, l'a bien posée.
      void markAlreadyAsked(AsyncStorage)
      setAlreadyAsked(true)

      let granted = false
      try {
        const result = await Notifications.requestPermissionsAsync()
        granted = result.granted || result.ios?.status === 3
        setStatus(granted ? 'granted' : toStatus(result.status))
      } catch (error) {
        setLastReason(classifyPushFailure(error))
        setStatus(await readSystemStatus())
        return { granted: false, registered: false, reason: classifyPushFailure(error) }
      }

      if (!granted) return { granted: false, registered: false, reason: 'permission_denied' }
      return register(queueEntryId)
    },
    [register],
  )

  /**
   * Enregistre SANS rien demander, si la permission existe déjà. C'est ce qui
   * rattache un appareil à un compte après connexion, et ce qui rafraîchit un
   * jeton que le système a fait tourner.
   */
  const ensureRegistered = useCallback(
    async (queueEntryId: string | null = null): Promise<PushAttempt | null> => {
      const current = await readSystemStatus()
      setStatus(current)
      if (current !== 'granted') return null
      return register(queueEntryId)
    },
    [register],
  )

  return { status, alreadyAsked, lastReason, requestAndRegister, ensureRegistered }
}

/** Retire cet appareil des destinataires (déconnexion). Silencieux. */
export async function revokeThisDevice(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(TOKEN_STORAGE_KEY)
    if (!token) return
    await revokePushDevice(token)
    await AsyncStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* hors ligne ou jeton déjà retiré : rien à dire au client */
  }
}
