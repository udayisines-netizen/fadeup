import { useMutation, useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/shared/lib/supabase'
import { legalKeys } from '@/shared/data/keys'

/**
 * X2 — la couche d'accès de la page d'information RGPD.
 *
 * Trois contrats, tous anon-callables :
 *  - la résolution handle-ou-uuid vers l'identité publique (B1), pour que le
 *    formulaire de retrait sache DE QUELLE fiche on parle ;
 *  - `submit_marketplace_withdrawal_request` (X2) : ENREGISTRE une demande de
 *    retrait dans le circuit opérateur B2 — rien n'est dépublié depuis le
 *    navigateur, l'opérateur vérifie l'identité puis exécute sous 72 h ;
 *  - `unsubscribe_prospect_outreach` (B2) : le désabonnement par jeton, qui
 *    répond toujours vrai (anti-énumération) et pose do_not_contact.
 */

export interface PublicProfessionalRef {
  id: string
  handle: string | null
  display_name: string
  claim_state: 'unclaimed' | 'claimed'
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Accepte ce qu'un professionnel collera vraisemblablement : l'URL complète
 * de sa fiche, `@handle`, le handle nu, ou l'uuid porté par l'e-mail
 * d'information quand la fiche n'a pas de handle.
 */
export function parseProfessionalRef(raw: string): string | null {
  let value = raw.trim()
  if (value === '') return null
  const proPath = /\/pro\/([^/?#\s]+)/.exec(value)
  if (proPath?.[1]) value = proPath[1]
  const proParam = /[?&]pro=([^&#\s]+)/.exec(value)
  if (proParam?.[1]) value = proParam[1]
  value = value.replace(/^@/, '')
  try {
    value = decodeURIComponent(value)
  } catch {
    // Une séquence % invalide n'est pas un motif d'échec : on garde le brut.
  }
  return value === '' ? null : value
}

export async function fetchProfessionalRef(ref: string): Promise<PublicProfessionalRef | null> {
  const supabase = getSupabase()
  if (UUID_PATTERN.test(ref)) {
    const { data, error } = await supabase.rpc('get_public_professional', {
      p_professional_id: ref,
    })
    if (error) throw error
    return (data?.[0] as PublicProfessionalRef | undefined) ?? null
  }
  const { data, error } = await supabase.rpc('get_public_professional_by_handle', {
    p_handle: ref,
  })
  if (error) throw error
  return (data?.[0] as PublicProfessionalRef | undefined) ?? null
}

export function useProfessionalRef(ref: string | null) {
  return useQuery({
    queryKey: legalKeys.professionalRef(ref ?? ''),
    enabled: Boolean(ref),
    staleTime: 60_000,
    queryFn: () => fetchProfessionalRef(ref ?? ''),
  })
}

export const WITHDRAWAL_REFUSAL_CODES = [
  'professional_is_claimed',
  'profile_not_published',
  'invalid_email',
] as const

export type WithdrawalRefusalCode = (typeof WITHDRAWAL_REFUSAL_CODES)[number]

const WITHDRAWAL_PATTERN = /fadeup_withdrawal_refusal=([a-z_]+)/

export class WithdrawalRefusedError extends Error {
  readonly code: WithdrawalRefusalCode

  constructor(code: WithdrawalRefusalCode) {
    super(`withdrawal refused: ${code}`)
    this.name = 'WithdrawalRefusedError'
    this.code = code
  }
}

export function parseWithdrawalRefusal(raw: unknown): WithdrawalRefusalCode | null {
  if (typeof raw !== 'object' || raw === null) return null
  const details = (raw as { details?: unknown }).details
  if (typeof details !== 'string') return null
  const match = WITHDRAWAL_PATTERN.exec(details)
  if (!match?.[1]) return null
  return (WITHDRAWAL_REFUSAL_CODES as readonly string[]).includes(match[1])
    ? (match[1] as WithdrawalRefusalCode)
    : null
}

export function withdrawalRefusalMessageKey(code: WithdrawalRefusalCode): string {
  return `legal.withdrawal.refusal.${code}`
}

export interface WithdrawalResult {
  request_id: string
  deadline_at: string
  already_pending: boolean
}

export function useSubmitWithdrawal() {
  return useMutation({
    mutationFn: async (input: {
      professionalId: string
      requesterEmail?: string
      requesterNote?: string
      token?: string
    }): Promise<WithdrawalResult> => {
      const { data, error } = await getSupabase().rpc('submit_marketplace_withdrawal_request', {
        p_professional_id: input.professionalId,
        p_requester_email: input.requesterEmail || undefined,
        p_requester_note: input.requesterNote || undefined,
        p_token: input.token || undefined,
      })
      if (error) {
        const code = parseWithdrawalRefusal(error)
        if (code) throw new WithdrawalRefusedError(code)
        throw error
      }
      const row = data?.[0] as WithdrawalResult | undefined
      if (!row) throw new Error('empty withdrawal response')
      return row
    },
  })
}

export function useUnsubscribe() {
  return useMutation({
    mutationFn: async (token: string): Promise<void> => {
      // Répond toujours `unsubscribed: true` (anti-énumération, B2) : le seul
      // échec possible est une panne réseau/serveur, remontée telle quelle.
      const { error } = await getSupabase().rpc('unsubscribe_prospect_outreach', {
        p_token: token,
      })
      if (error) throw error
    },
  })
}
