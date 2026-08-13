import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getSupabaseClient } from '@/lib/supabase'

/**
 * The customer's own Fade Passport — see customer_passports /
 * customer_passport_photos / customer_passport_shares
 * (db/migrations/20260813140000_fade_passport.sql). Passport rows use
 * owner-only direct RLS; shares go through SECURITY DEFINER RPCs because
 * only the RPC may generate/hash the token.
 */

export interface Passport {
  id: string
  userId: string
  usualHaircut: string | null
  fadeType: string | null
  sideLength: string | null
  topLength: string | null
  beardPreferences: string | null
  preferencesNotes: string | null
}

interface PassportRow {
  id: string
  user_id: string
  usual_haircut: string | null
  fade_type: string | null
  side_length: string | null
  top_length: string | null
  beard_preferences: string | null
  preferences_notes: string | null
}

const PASSPORT_COLUMNS = 'id, user_id, usual_haircut, fade_type, side_length, top_length, beard_preferences, preferences_notes'

function mapPassport(row: PassportRow): Passport {
  return {
    id: row.id,
    userId: row.user_id,
    usualHaircut: row.usual_haircut,
    fadeType: row.fade_type,
    sideLength: row.side_length,
    topLength: row.top_length,
    beardPreferences: row.beard_preferences,
    preferencesNotes: row.preferences_notes,
  }
}

const passportKey = (userId: string | undefined) => ['passport', userId] as const

/** `null` once resolved if the customer hasn't created a Passport yet — a legitimate first-use state. */
export function useMyPassport(userId: string | undefined) {
  return useQuery({
    queryKey: passportKey(userId),
    queryFn: async (): Promise<Passport | null> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.from('customer_passports').select(PASSPORT_COLUMNS).eq('user_id', userId).maybeSingle()
      if (error) throw error
      return data ? mapPassport(data as PassportRow) : null
    },
    enabled: Boolean(userId),
  })
}

export interface PassportInput {
  userId: string
  usualHaircut?: string | null
  fadeType?: string | null
  sideLength?: string | null
  topLength?: string | null
  beardPreferences?: string | null
  preferencesNotes?: string | null
}

export function useUpsertMyPassport() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: PassportInput): Promise<Passport> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('customer_passports')
        .upsert(
          {
            user_id: input.userId,
            usual_haircut: input.usualHaircut ?? null,
            fade_type: input.fadeType ?? null,
            side_length: input.sideLength ?? null,
            top_length: input.topLength ?? null,
            beard_preferences: input.beardPreferences ?? null,
            preferences_notes: input.preferencesNotes ?? null,
          },
          { onConflict: 'user_id' },
        )
        .select(PASSPORT_COLUMNS)
        .single()
      if (error) throw error
      return mapPassport(data as PassportRow)
    },
    onSuccess: (passport) => {
      queryClient.setQueryData(passportKey(passport.userId), passport)
    },
  })
}

export interface PassportPhoto {
  id: string
  storagePath: string
  caption: string | null
  createdAt: string
}

const photosKey = (userId: string | undefined) => ['passport-photos', userId] as const

/** Photo rows plus a short-lived signed URL for each (the bucket is private — no public URLs exist). */
export function useMyPassportPhotos(userId: string | undefined) {
  return useQuery({
    queryKey: photosKey(userId),
    queryFn: async (): Promise<(PassportPhoto & { signedUrl: string | null })[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('customer_passport_photos')
        .select('id, storage_path, caption, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
      if (error) throw error

      const rows = (data ?? []) as { id: string; storage_path: string; caption: string | null; created_at: string }[]
      return Promise.all(
        rows.map(async (row) => {
          const { data: signed } = await supabase.storage.from('passport-photos').createSignedUrl(row.storage_path, 3600)
          return {
            id: row.id,
            storagePath: row.storage_path,
            caption: row.caption,
            createdAt: row.created_at,
            signedUrl: signed?.signedUrl ?? null,
          }
        }),
      )
    },
    enabled: Boolean(userId),
  })
}

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_PHOTO_BYTES = 5 * 1024 * 1024

export function useUploadPassportPhoto() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, file }: { userId: string; file: File }): Promise<void> => {
      // Client-side checks are for a fast, clear error message only — the
      // bucket's own allowed_mime_types/file_size_limit are the real
      // enforcement, applied server-side against the actual upload.
      if (!ALLOWED_PHOTO_TYPES.has(file.type)) {
        throw new Error('Please choose a JPEG, PNG or WebP image.')
      }
      if (file.size > MAX_PHOTO_BYTES) {
        throw new Error('That image is larger than 5 MB — please choose a smaller one.')
      }

      const supabase = getSupabaseClient()
      const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
      // Path must start with the user's own id — that prefix is exactly
      // what the storage.objects policies check.
      const storagePath = `${userId}/${crypto.randomUUID()}.${extension}`

      const { error: uploadError } = await supabase.storage.from('passport-photos').upload(storagePath, file, { contentType: file.type })
      if (uploadError) throw uploadError

      const { error: insertError } = await supabase.from('customer_passport_photos').insert({ user_id: userId, storage_path: storagePath })
      if (insertError) {
        // Don't leave an orphaned object behind if the row insert fails.
        await supabase.storage.from('passport-photos').remove([storagePath])
        throw insertError
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: photosKey(variables.userId) })
    },
  })
}

export function useDeletePassportPhoto() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, photoId, storagePath }: { userId: string; photoId: string; storagePath: string }): Promise<void> => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.from('customer_passport_photos').delete().eq('id', photoId)
      if (error) throw error
      await supabase.storage.from('passport-photos').remove([storagePath])
      void userId
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: photosKey(variables.userId) })
    },
  })
}

export interface PassportShare {
  id: string
  label: string | null
  expiresAt: string
  revokedAt: string | null
  createdAt: string
  lastAccessedAt: string | null
}

const sharesKey = ['passport-shares'] as const

export function useMyPassportShares(enabled: boolean) {
  return useQuery({
    queryKey: sharesKey,
    queryFn: async (): Promise<PassportShare[]> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase
        .from('customer_passport_shares')
        .select('id, label, expires_at, revoked_at, created_at, last_accessed_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return ((data ?? []) as { id: string; label: string | null; expires_at: string; revoked_at: string | null; created_at: string; last_accessed_at: string | null }[]).map(
        (row) => ({
          id: row.id,
          label: row.label,
          expiresAt: row.expires_at,
          revokedAt: row.revoked_at,
          createdAt: row.created_at,
          lastAccessedAt: row.last_accessed_at,
        }),
      )
    },
    enabled,
  })
}

/** Returns the raw token exactly once — it is never retrievable again (only its hash is stored). */
export function useCreatePassportShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ label, ttlHours }: { label?: string | null; ttlHours?: number }): Promise<{ shareId: string; token: string; expiresAt: string }> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('create_passport_share', { p_label: label ?? null, p_ttl_hours: ttlHours ?? 168 })
      if (error) throw error
      const row = (data as { share_id: string; token: string; expires_at: string }[])[0]
      if (!row) throw new Error('Share could not be created')
      return { shareId: row.share_id, token: row.token, expiresAt: row.expires_at }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharesKey })
    },
  })
}

export function useRevokePassportShare() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (shareId: string): Promise<void> => {
      const supabase = getSupabaseClient()
      const { error } = await supabase.rpc('revoke_passport_share', { p_share_id: shareId })
      if (error) throw error
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharesKey })
    },
  })
}

export type SharedPassportStatus = 'active' | 'expired' | 'revoked' | 'not_found'

export interface SharedPassport {
  status: SharedPassportStatus
  displayName: string | null
  usualHaircut: string | null
  fadeType: string | null
  sideLength: string | null
  topLength: string | null
  beardPreferences: string | null
  preferencesNotes: string | null
}

/** Anon-callable read of a shared Passport by token — see get_shared_passport. */
export function useSharedPassport(token: string | undefined) {
  return useQuery({
    queryKey: ['shared-passport', token],
    queryFn: async (): Promise<SharedPassport> => {
      const supabase = getSupabaseClient()
      const { data, error } = await supabase.rpc('get_shared_passport', { p_token: token })
      if (error) throw error
      const row = (data as Record<string, string | null>[])[0]
      if (!row) return { status: 'not_found', displayName: null, usualHaircut: null, fadeType: null, sideLength: null, topLength: null, beardPreferences: null, preferencesNotes: null }
      return {
        status: (row.status as SharedPassportStatus) ?? 'not_found',
        displayName: row.display_name,
        usualHaircut: row.usual_haircut,
        fadeType: row.fade_type,
        sideLength: row.side_length,
        topLength: row.top_length,
        beardPreferences: row.beard_preferences,
        preferencesNotes: row.preferences_notes,
      }
    },
    enabled: Boolean(token),
  })
}
