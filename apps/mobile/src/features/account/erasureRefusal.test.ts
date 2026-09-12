import { describe, expect, it } from 'vitest'

import { erasureRefusalOf } from '@/features/account/api/account'

/**
 * B5 — la garde du motif de refus. Même mécanisme que refusals.ts (F1/F1b) :
 * le motif se lit sur le CODE porté par le message, JAMAIS sur un statut
 * HTTP — un 42501 devient 401 en anonyme, et brancher l'interface dessus
 * ferait dire n'importe quoi à l'écran.
 *
 * La liste testée est celle que public.delete_my_account() émet réellement
 * (migration 20260911160200 §7). Un code ajouté en base sans son message ici
 * retombe sur `unknown`, qui a son propre texte : jamais un écran muet, et
 * jamais le message brut du serveur.
 */
describe('erasureRefusalOf', () => {
  it('reconnaît les quatre codes émis par la RPC', () => {
    expect(erasureRefusalOf('fadeup_erasure_refusal=not_authenticated')).toBe('not_authenticated')
    expect(erasureRefusalOf('fadeup_erasure_refusal=business_account')).toBe('business_account')
    expect(erasureRefusalOf('fadeup_erasure_refusal=active_commitments')).toBe('active_commitments')
    expect(erasureRefusalOf('fadeup_erasure_refusal=media_not_purged')).toBe('media_not_purged')
  })

  it('trouve le code au milieu du message complet du serveur', () => {
    expect(
      erasureRefusalOf('ERROR: fadeup_erasure_refusal=business_account (SQLSTATE 42501)'),
    ).toBe('business_account')
  })

  it('retombe sur unknown — jamais sur le texte brut — hors contrat', () => {
    expect(erasureRefusalOf('fadeup_erasure_refusal=quelque_chose_de_neuf')).toBe('unknown')
    expect(erasureRefusalOf('Failed to fetch')).toBe('unknown')
    expect(erasureRefusalOf('')).toBe('unknown')
    expect(erasureRefusalOf(null)).toBe('unknown')
    expect(erasureRefusalOf(undefined)).toBe('unknown')
  })

  it('ne confond pas un refus de FILE avec un refus d\'EFFACEMENT', () => {
    expect(erasureRefusalOf('fadeup_queue_refusal=entry_not_found')).toBe('unknown')
  })
})
