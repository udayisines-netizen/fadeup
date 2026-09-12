import { describe, expect, it } from 'vitest'

import { eraseAccount } from '@/features/account/api/account'

/**
 * B5 — L'ORDRE de l'effacement, et rien d'autre.
 *
 * Le défaut que ce test interdit de revenir : purger le stockage AVANT
 * d'appeler la RPC. La RPC refuse tant qu'il reste une photo
 * (`media_not_purged`), et la tentation est donc de purger d'abord. Mais elle
 * refuse AUSSI pour d'autres raisons — compte professionnel, file en cours —
 * et dans ce cas les photos du Passport seraient déjà détruites
 * DÉFINITIVEMENT alors que le compte, lui, existerait toujours. La
 * précondition serveur, conçue pour FERMER cet échec, se retrouverait ouverte
 * par le client.
 *
 * Ces trois cas sont écrits pour ÉCHOUER sur l'ancien ordre : le premier
 * compte les appels, les deux autres vérifient qu'aucun `remove` n'a eu lieu
 * quand le serveur refuse pour autre chose.
 */

type Call = string

function fakeSupabase(refusals: (string | null)[], files: string[] = ['a.jpg']) {
  const calls: Call[] = []
  let attempt = 0

  return {
    calls,
    client: {
      rpc: async (_fn: string) => {
        const refusal = refusals[attempt] ?? null
        attempt += 1
        calls.push(refusal ? `rpc:refus:${refusal}` : 'rpc:ok')
        if (refusal) {
          return { data: null, error: { message: `fadeup_erasure_refusal=${refusal}` } }
        }
        return { data: [{ erasure_id: 'reçu-1', erased_at: 'maintenant', scope: {} }], error: null }
      },
      storage: {
        from: (bucket: string) => ({
          list: async (_prefix: string, opts: { offset: number }) => {
            calls.push(`list:${bucket}`)
            return { data: opts.offset === 0 ? files.map((name) => ({ id: name, name })) : [], error: null }
          },
          remove: async (paths: string[]) => {
            calls.push(`remove:${bucket}:${paths.length}`)
            return { error: null }
          },
        }),
      },
    },
  }
}

describe('eraseAccount — l’ordre est la protection', () => {
  it('appelle la RPC AVANT de toucher au stockage', async () => {
    // Le serveur refuse pour média, on purge, on rappelle : ça passe.
    const { client, calls } = fakeSupabase(['media_not_purged', null])

    const receipt = await eraseAccount(client as never, 'user-1')

    expect(receipt.erasure_id).toBe('reçu-1')
    // LA propriété : le tout premier appel est la RPC, pas un list/remove.
    expect(calls[0]).toBe('rpc:refus:media_not_purged')
    expect(calls.filter((c) => c.startsWith('remove:'))).toHaveLength(3)
    expect(calls[calls.length - 1]).toBe('rpc:ok')
  })

  it('ne détruit AUCUNE photo quand le refus est « compte professionnel »', async () => {
    const { client, calls } = fakeSupabase(['business_account'])

    await expect(eraseAccount(client as never, 'user-1')).rejects.toThrow(/business_account/)

    expect(calls).toEqual(['rpc:refus:business_account'])
    expect(calls.some((c) => c.startsWith('remove:'))).toBe(false)
  })

  it('ne détruit AUCUNE photo quand le refus est « file en cours »', async () => {
    const { client, calls } = fakeSupabase(['active_commitments'])

    await expect(eraseAccount(client as never, 'user-1')).rejects.toThrow(/active_commitments/)

    expect(calls.some((c) => c.startsWith('remove:'))).toBe(false)
  })

  it('purge les trois seaux, et seulement après le refus média', async () => {
    const { client, calls } = fakeSupabase(['media_not_purged', null])

    await eraseAccount(client as never, 'user-1')

    expect(calls).toContain('remove:passport-photos:1')
    expect(calls).toContain('remove:review-photos:1')
    expect(calls).toContain('remove:post-media:1')
    expect(calls.indexOf('list:passport-photos')).toBeGreaterThan(0)
  })
})
