import { describe, expect, it } from 'vitest'

import {
  decidePermissionMoment,
  markAlreadyAsked,
  PERMISSION_ASKED_STORAGE_KEY,
  readAlreadyAsked,
  type KeyValueStore,
} from '@/features/notifications/lib/permissionMoment'

/**
 * La règle du lot : JAMAIS à l'ouverture, juste après avoir rejoint une file,
 * et une seule fois — sur iOS un refus est définitif.
 */
describe('decidePermissionMoment', () => {
  it("ne demande RIEN à l'ouverture, même si tout le reste est favorable", () => {
    expect(
      decidePermissionMoment({ system: 'undetermined', alreadyAsked: false, justJoinedQueue: false }),
    ).toEqual({ ask: false, reason: 'not_the_moment' })
  })

  it('demande juste après avoir rejoint une file', () => {
    expect(
      decidePermissionMoment({ system: 'undetermined', alreadyAsked: false, justJoinedQueue: true }),
    ).toEqual({ ask: true })
  })

  it('ne repose pas la question une seconde fois', () => {
    expect(
      decidePermissionMoment({ system: 'undetermined', alreadyAsked: true, justJoinedQueue: true }),
    ).toEqual({ ask: false, reason: 'already_asked' })
  })

  it('ne demande rien après un refus système — il est définitif', () => {
    expect(
      decidePermissionMoment({ system: 'denied', alreadyAsked: false, justJoinedQueue: true }),
    ).toEqual({ ask: false, reason: 'system_denied' })
  })

  it('ne demande rien quand la permission est déjà accordée', () => {
    expect(
      decidePermissionMoment({ system: 'granted', alreadyAsked: false, justJoinedQueue: true }),
    ).toEqual({ ask: false, reason: 'already_granted' })
  })

  it("l'état système prime sur la mémoire de l'application", () => {
    // Une application réinstallée a oublié qu'elle avait demandé ; le système,
    // lui, se souvient. C'est lui qui doit gagner.
    expect(
      decidePermissionMoment({ system: 'denied', alreadyAsked: false, justJoinedQueue: true }).ask,
    ).toBe(false)
  })
})

function store(initial: Record<string, string> = {}, fail = false): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    async getItem(key) {
      if (fail) throw new Error('stockage indisponible')
      return data[key] ?? null
    },
    async setItem(key, value) {
      if (fail) throw new Error('stockage indisponible')
      data[key] = value
    },
  }
}

describe('mémoire de la question posée', () => {
  it("relit ce qui a été écrit", async () => {
    const s = store()
    expect(await readAlreadyAsked(s)).toBe(false)
    expect(await markAlreadyAsked(s)).toBe(true)
    expect(s.data[PERMISSION_ASKED_STORAGE_KEY]).toBe('1')
    expect(await readAlreadyAsked(s)).toBe(true)
  })

  it("un stockage en panne ne fait pas croire à un refus", async () => {
    const s = store({}, true)
    expect(await readAlreadyAsked(s)).toBe(false)
    expect(await markAlreadyAsked(s)).toBe(false)
  })

  it("une valeur illisible vaut « jamais demandé »", async () => {
    expect(await readAlreadyAsked(store({ [PERMISSION_ASKED_STORAGE_KEY]: 'peut-être' }))).toBe(false)
  })
})
