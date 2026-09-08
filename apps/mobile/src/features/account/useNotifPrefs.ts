import AsyncStorage from '@react-native-async-storage/async-storage'
import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_NOTIF_PREFS,
  readNotifPrefs,
  setNotifPref,
  writeNotifPrefs,
  type NotifPrefKey,
  type NotifPrefs,
} from '@/features/account/prefs'

/**
 * Le liant natif du module pur `prefs.ts` — la SEULE pièce qui connaît
 * AsyncStorage. `null` tant que la lecture n'a pas répondu : on n'affirme
 * pas un état d'interrupteur avant de l'avoir lu (null n'est pas false).
 */
export function useNotifPrefs() {
  const [prefs, setPrefs] = useState<NotifPrefs | null>(null)

  useEffect(() => {
    let alive = true
    void readNotifPrefs(AsyncStorage).then((stored) => {
      if (alive) setPrefs(stored)
    })
    return () => {
      alive = false
    }
  }, [])

  const toggle = useCallback(
    (key: NotifPrefKey, value: boolean) => {
      const next = setNotifPref(prefs ?? DEFAULT_NOTIF_PREFS, key, value)
      setPrefs(next)
      void writeNotifPrefs(AsyncStorage, next)
    },
    [prefs],
  )

  return { prefs, toggle }
}
