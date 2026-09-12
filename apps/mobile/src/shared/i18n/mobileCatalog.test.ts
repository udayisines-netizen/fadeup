import { describe, expect, it } from 'vitest'

import en from '@/shared/i18n/locales/en/mobile.json'
import fr from '@/shared/i18n/locales/fr/mobile.json'

/**
 * M1c-a — le garde-fou contre la clé i18n BRUTE.
 *
 * Un `t('mobile.push.permission.title')` dont la clé n'existe pas ne casse
 * rien : i18next rend la clé elle-même. À l'écran, cela donne
 * « mobile.push.permission.title » — invisible en revue de code, visible par
 * le premier client. Ce fichier compare les deux catalogues feuille à feuille
 * et exige que les clés du lot existent des deux côtés.
 */
function leaves(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key),
  )
}

const frKeys = leaves(fr).sort()
const enKeys = leaves(en).sort()

describe('catalogue mobile fr/en', () => {
  it('porte exactement les mêmes clés dans les deux langues', () => {
    expect(frKeys.filter((key) => !enKeys.includes(key))).toEqual([])
    expect(enKeys.filter((key) => !frKeys.includes(key))).toEqual([])
  })

  it('ne contient aucune valeur vide', () => {
    const empty = (catalog: object, label: string) =>
      leaves(catalog)
        .filter((key) => {
          const value = key
            .split('.')
            .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], catalog)
          return typeof value !== 'string' || value.trim().length === 0
        })
        .map((key) => `${label}:${key}`)
    expect([...empty(fr, 'fr'), ...empty(en, 'en')]).toEqual([])
  })

  it('porte les clés que M1c-a introduit', () => {
    for (const key of [
      'push.permission.title',
      'push.permission.body',
      'push.permission.reassurance',
      'push.permission.accept',
      'push.permission.later',
      'push.deniedHint',
      'push.networkHint',
      'push.openSettings',
      'offline.bookingsStale',
      'offline.bookingsStaleUnknown',
      'account.notifQueue',
      'account.notifQueueHint',
      'account.notifBooking',
      'account.notifBookingHint',
      'account.notifReminder',
      'account.notifReminderHint',
      'account.notifSocial',
      'account.notifSocialHint',
    ]) {
      expect(frKeys, `fr manque ${key}`).toContain(key)
      expect(enKeys, `en manque ${key}`).toContain(key)
    }
  })
})
