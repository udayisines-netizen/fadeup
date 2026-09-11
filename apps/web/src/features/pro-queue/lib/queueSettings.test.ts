import { describe, expect, it } from 'vitest'
import {
  canManageQueueSettings,
  changedThresholds,
  parseQueueSettingsRefusal,
  parseThreshold,
  refusalTarget,
  thresholdErrors,
  toThresholdDraft,
  type Thresholds,
} from '@/features/pro-queue/lib/queueSettings'

/** Une base valide et NON par défaut : les tests ne doivent jamais tenir par hasard. */
const INITIAL: Thresholds = { capacity: 18, grace: 7, geofence: 220 }
const VALID = toThresholdDraft(INITIAL)

describe('parseThreshold — un entier, rien d’autre', () => {
  it('accepte un entier, avec ou sans espaces autour', () => {
    expect(parseThreshold('12')).toBe(12)
    expect(parseThreshold('  12  ')).toBe(12)
    expect(parseThreshold('0')).toBe(0)
  })

  it('refuse le vide, le décimal et le non numérique (Number("") vaut 0 : le piège)', () => {
    expect(parseThreshold('')).toBeNull()
    expect(parseThreshold('   ')).toBeNull()
    expect(parseThreshold('12.5')).toBeNull()
    expect(parseThreshold('12,5')).toBeNull()
    expect(parseThreshold('abc')).toBeNull()
    expect(parseThreshold('1e3')).toBeNull()
    expect(parseThreshold('12px')).toBeNull()
  })

  it('lit le signe : un négatif est un nombre, c’est la borne qui le rejettera', () => {
    expect(parseThreshold('-5')).toBe(-5)
  })
})

describe('thresholdErrors — les bornes de la contrainte SQL, champ par champ', () => {
  it('ne signale rien sur des valeurs valides', () => {
    expect(thresholdErrors(VALID)).toEqual({})
  })

  it('capacité : 1 et 200 passent, 0 et 201 non', () => {
    expect(thresholdErrors({ ...VALID, capacity: '1' }).capacity).toBeUndefined()
    expect(thresholdErrors({ ...VALID, capacity: '200' }).capacity).toBeUndefined()
    expect(thresholdErrors({ ...VALID, capacity: '0' }).capacity).toBe('queue.settings.errors.capacityRange')
    expect(thresholdErrors({ ...VALID, capacity: '201' }).capacity).toBe('queue.settings.errors.capacityRange')
  })

  it('grâce : 0 est une valeur LÉGITIME (pas de délai), 121 non', () => {
    expect(thresholdErrors({ ...VALID, grace: '0' }).grace).toBeUndefined()
    expect(thresholdErrors({ ...VALID, grace: '120' }).grace).toBeUndefined()
    expect(thresholdErrors({ ...VALID, grace: '121' }).grace).toBe('queue.settings.errors.graceRange')
    expect(thresholdErrors({ ...VALID, grace: '-1' }).grace).toBe('queue.settings.errors.graceRange')
  })

  it('géofence : 25 et 2000 passent, 24 et 2001 non', () => {
    expect(thresholdErrors({ ...VALID, geofence: '25' }).geofence).toBeUndefined()
    expect(thresholdErrors({ ...VALID, geofence: '2000' }).geofence).toBeUndefined()
    expect(thresholdErrors({ ...VALID, geofence: '24' }).geofence).toBe('queue.settings.errors.geofenceRange')
    expect(thresholdErrors({ ...VALID, geofence: '2001' }).geofence).toBe('queue.settings.errors.geofenceRange')
  })

  it('vide, décimal et non numérique sont des erreurs — jamais un envoi silencieux', () => {
    const errors = thresholdErrors({ capacity: '', grace: '7.5', geofence: 'loin' })
    expect(errors).toEqual({
      capacity: 'queue.settings.errors.capacityRange',
      grace: 'queue.settings.errors.graceRange',
      geofence: 'queue.settings.errors.geofenceRange',
    })
  })

  it('signale les trois champs à la fois : l’utilisateur corrige en une passe', () => {
    expect(Object.keys(thresholdErrors({ capacity: '-1', grace: '999', geofence: '0' }))).toHaveLength(3)
  })
})

describe('changedThresholds — on n’envoie QUE ce qu’on a touché', () => {
  it('rend null quand rien n’a bougé', () => {
    expect(changedThresholds(INITIAL, VALID)).toBeNull()
  })

  it('rend null quand le texte diffère mais pas la valeur (« 18 » vs «  18  »)', () => {
    expect(changedThresholds(INITIAL, { ...VALID, capacity: '  18  ' })).toBeNull()
  })

  it('n’inclut que le champ modifié — un seuil non touché n’est jamais réécrit', () => {
    expect(changedThresholds(INITIAL, { ...VALID, grace: '10' })).toEqual({ grace: 10 })
  })

  it('inclut les trois quand les trois changent', () => {
    expect(changedThresholds(INITIAL, { capacity: '30', grace: '0', geofence: '150' })).toEqual({
      capacity: 30,
      grace: 0,
      geofence: 150,
    })
  })

  it('ignore un champ invalide : un brouillon cassé n’écrase rien', () => {
    expect(changedThresholds(INITIAL, { ...VALID, capacity: '' })).toBeNull()
    expect(changedThresholds(INITIAL, { capacity: 'abc', grace: '10', geofence: '' })).toEqual({ grace: 10 })
  })

  it('passer la grâce à 0 est un vrai changement (0 n’est pas « absent »)', () => {
    expect(changedThresholds({ ...INITIAL, grace: 5 }, { ...VALID, grace: '0' })).toEqual({ grace: 0 })
  })
})

describe('canManageQueueSettings — miroir de has_org_role([owner, manager])', () => {
  it('autorise owner et manager', () => {
    expect(canManageQueueSettings('owner')).toBe(true)
    expect(canManageQueueSettings('manager')).toBe(true)
  })

  it('refuse réceptionniste, barber et l’absence de rôle', () => {
    expect(canManageQueueSettings('receptionist')).toBe(false)
    expect(canManageQueueSettings('barber')).toBe(false)
    expect(canManageQueueSettings(null)).toBe(false)
    expect(canManageQueueSettings(undefined)).toBe(false)
  })
})

describe('refus nommés — on branche sur le CODE, jamais sur le texte', () => {
  it('extrait le code du DETAIL PostgREST', () => {
    expect(parseQueueSettingsRefusal({ details: 'fadeup_queue_refusal=not_authorized' })).toBe('not_authorized')
    expect(parseQueueSettingsRefusal({ details: 'fadeup_queue_refusal=geofence_out_of_range' })).toBe(
      'geofence_out_of_range',
    )
  })

  it('rend null sur un code inconnu, un détail absent ou une erreur non objet', () => {
    expect(parseQueueSettingsRefusal({ details: 'fadeup_queue_refusal=xyz' })).toBeNull()
    expect(parseQueueSettingsRefusal({ details: 'fadeup_booking_refusal=slot_conflict' })).toBeNull()
    expect(parseQueueSettingsRefusal({ message: 'not authorized' })).toBeNull()
    expect(parseQueueSettingsRefusal(null)).toBeNull()
    expect(parseQueueSettingsRefusal('boom')).toBeNull()
  })

  it('ramène chaque borne serveur sur SON champ, et les refus globaux sur aucun', () => {
    expect(refusalTarget('capacity_out_of_range')).toEqual({
      field: 'capacity',
      messageKey: 'queue.settings.errors.capacityRange',
    })
    expect(refusalTarget('grace_out_of_range').field).toBe('grace')
    expect(refusalTarget('geofence_out_of_range').field).toBe('geofence')
    expect(refusalTarget('no_change')).toEqual({ field: null, messageKey: 'queue.settings.errors.noChange' })
    expect(refusalTarget('not_authorized')).toEqual({
      field: null,
      messageKey: 'queue.settings.errors.notAuthorized',
    })
  })
})
