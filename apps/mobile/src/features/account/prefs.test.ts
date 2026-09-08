import { describe, expect, it } from 'vitest'

import {
  DEFAULT_NOTIF_PREFS,
  NOTIF_PREFS_STORAGE_KEY,
  NOTIF_PREF_KEYS,
  parseNotifPrefs,
  readNotifPrefs,
  serializeNotifPrefs,
  setNotifPref,
  writeNotifPrefs,
  type KeyValueStore,
  type NotifPrefs,
} from '@/features/account/prefs'

/** Stockage de test — c'est toute la raison de l'injection. */
function fakeStore(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  return {
    store: {
      getItem: async (key: string) => map.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        map.set(key, value)
      },
    } satisfies KeyValueStore,
    map,
  }
}

function brokenStore(): KeyValueStore {
  return {
    getItem: () => Promise.reject(new Error('stockage indisponible')),
    setItem: () => Promise.reject(new Error('stockage indisponible')),
  }
}

describe('préférences de notification — validation pure', () => {
  it('absence de valeur → les défauts (transactionnel activé, social opté)', () => {
    expect(parseNotifPrefs(null)).toEqual({ queue: true, booking: true, social: false })
    expect(parseNotifPrefs(undefined)).toEqual(DEFAULT_NOTIF_PREFS)
    expect(parseNotifPrefs('')).toEqual(DEFAULT_NOTIF_PREFS)
  })

  it('JSON illisible ou de mauvaise forme → les défauts, jamais une panne', () => {
    expect(parseNotifPrefs('{pas du json')).toEqual(DEFAULT_NOTIF_PREFS)
    expect(parseNotifPrefs('null')).toEqual(DEFAULT_NOTIF_PREFS)
    expect(parseNotifPrefs('[true,false]')).toEqual(DEFAULT_NOTIF_PREFS)
    expect(parseNotifPrefs('"queue"')).toEqual(DEFAULT_NOTIF_PREFS)
  })

  it('lit les booléens connus et ignore le reste', () => {
    expect(parseNotifPrefs('{"queue":false,"social":true,"inconnu":true,"booking":"oui"}')).toEqual({
      queue: false,
      booking: true,
      social: true,
    })
  })

  it('écriture normalisée : seulement les trois clés du contrat', () => {
    const written = JSON.parse(
      serializeNotifPrefs({ queue: false, booking: false, social: true } satisfies NotifPrefs),
    ) as Record<string, unknown>
    expect(Object.keys(written).sort()).toEqual([...NOTIF_PREF_KEYS].sort())
    expect(written).toEqual({ queue: false, booking: false, social: true })
  })

  it('aller-retour : ce qui est écrit est relu à l’identique', () => {
    const prefs: NotifPrefs = { queue: false, booking: true, social: true }
    expect(parseNotifPrefs(serializeNotifPrefs(prefs))).toEqual(prefs)
  })

  it('setNotifPref ne mute pas l’objet d’origine', () => {
    const before: NotifPrefs = { ...DEFAULT_NOTIF_PREFS }
    const after = setNotifPref(before, 'social', true)
    expect(before.social).toBe(false)
    expect(after).toEqual({ queue: true, booking: true, social: true })
  })
})

describe('préférences de notification — stockage injecté', () => {
  it('écrit puis relit sous la clé fu.notifPrefs.v1', async () => {
    const { store, map } = fakeStore()
    const prefs: NotifPrefs = { queue: true, booking: false, social: true }

    expect(await writeNotifPrefs(store, prefs)).toBe(true)
    expect(map.has(NOTIF_PREFS_STORAGE_KEY)).toBe(true)
    expect(await readNotifPrefs(store)).toEqual(prefs)
  })

  it('stockage vide → les défauts', async () => {
    const { store } = fakeStore()
    expect(await readNotifPrefs(store)).toEqual(DEFAULT_NOTIF_PREFS)
  })

  it('stockage en panne : la lecture rend les défauts, l’écriture rend false', async () => {
    const store = brokenStore()
    expect(await readNotifPrefs(store)).toEqual(DEFAULT_NOTIF_PREFS)
    expect(await writeNotifPrefs(store, DEFAULT_NOTIF_PREFS)).toBe(false)
  })

  it('valeur corrompue en stockage → les défauts', async () => {
    const { store } = fakeStore({ [NOTIF_PREFS_STORAGE_KEY]: '{oups' })
    expect(await readNotifPrefs(store)).toEqual(DEFAULT_NOTIF_PREFS)
  })
})
