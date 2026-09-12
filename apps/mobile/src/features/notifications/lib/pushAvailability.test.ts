import { describe, expect, it } from 'vitest'

import {
  classifyPushFailure,
  pushUnavailableMessageKey,
} from '@/features/notifications/lib/pushAvailability'

describe('classifyPushFailure', () => {
  it("reconnaît l'absence d'identifiant de projet Expo par son CODE", () => {
    expect(classifyPushFailure({ code: 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID' })).toBe('no_project_id')
  })

  it("la reconnaît aussi par le message, si le code manque", () => {
    expect(classifyPushFailure({ message: 'No "projectId" found.' })).toBe('no_project_id')
  })

  it('reconnaît Expo Go', () => {
    expect(
      classifyPushFailure({ message: 'removed from Expo Go with the release of SDK 53' }),
    ).toBe('expo_go')
  })

  it('reconnaît le simulateur', () => {
    expect(classifyPushFailure({ code: 'ERR_UNAVAILABLE' })).toBe('not_a_device')
    expect(classifyPushFailure({ message: 'Must use physical device for push' })).toBe('not_a_device')
  })

  it('reconnaît le réseau, y compris la borne de temps', () => {
    expect(classifyPushFailure({ message: 'Network request failed' })).toBe('network')
    expect(classifyPushFailure({ code: 'ERR_TIMEOUT' })).toBe('network')
  })

  it("ne devine pas : tout le reste est « inconnu »", () => {
    expect(classifyPushFailure(null)).toBe('unknown')
    expect(classifyPushFailure('boom')).toBe('unknown')
    expect(classifyPushFailure({ message: 'quelque chose' })).toBe('unknown')
  })
})

describe('pushUnavailableMessageKey', () => {
  it("ne dit rien au client quand la cause est TECHNIQUE — c'est notre problème", () => {
    expect(pushUnavailableMessageKey('expo_go')).toBeNull()
    expect(pushUnavailableMessageKey('no_project_id')).toBeNull()
    expect(pushUnavailableMessageKey('not_a_device')).toBeNull()
    expect(pushUnavailableMessageKey('unknown')).toBeNull()
  })

  it('lui parle quand il peut agir', () => {
    expect(pushUnavailableMessageKey('permission_denied')).toBe('mobile.push.deniedHint')
    expect(pushUnavailableMessageKey('network')).toBe('mobile.push.networkHint')
  })
})
