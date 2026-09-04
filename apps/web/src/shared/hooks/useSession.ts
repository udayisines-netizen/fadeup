import { useEffect, useState } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getSupabase } from '@/shared/lib/supabase'

export interface SessionState {
  session: Session | null
  user: User | null
  /** True until the initial session lookup has resolved. */
  loading: boolean
}

/**
 * The V2 session hook. Reads the SAME GoTrue state as the legacy
 * auth-context (one shared client — see shared/lib/supabase.ts), so a
 * session opened on /platform/login is immediately visible here and
 * vice versa. Token refresh is automatic (supabase-js `autoRefreshToken`
 * default); on expiry GoTrue emits SIGNED_OUT and `session` becomes null,
 * which the guards translate into a clean redirect with an explicit message.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, user: null, loading: true })

  useEffect(() => {
    const supabase = getSupabase()
    let mounted = true

    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return
        setState({ session: data.session, user: data.session?.user ?? null, loading: false })
      })
      .catch(() => {
        if (!mounted) return
        setState({ session: null, user: null, loading: false })
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setState({ session, user: session?.user ?? null, loading: false })
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [])

  return state
}
