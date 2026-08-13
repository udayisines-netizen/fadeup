import { useEffect, useRef } from 'react'
import { useAuth } from '@/lib/auth-context'
import { useToast } from '@/components/ui/toast'
import { takePendingClaimToken, useRedeemAppointmentClaim } from '@/lib/queries/customer-profile'

/**
 * Closes the booking -> account loop.
 *
 * A customer who booked anonymously leaves the booking page holding a
 * single-use claim token (stashed in sessionStorage). The moment they land
 * in the customer app with a session — whether they signed up on the spot
 * or logged into an account they already had — this redeems that token so
 * the appointment they just made is actually theirs.
 *
 * Deliberately quiet on failure: an expired or already-spent token is a
 * normal, uninteresting outcome (e.g. the customer opened the app again in
 * the same session), and the customer never asked for this to happen. Only
 * a genuine success is worth interrupting them for.
 *
 * The token is consumed from storage on the first run regardless of the
 * outcome, so a failed redemption can never turn into a retry loop.
 */
export function usePendingClaimRedemption() {
  const { user } = useAuth()
  const { toast } = useToast()
  const redeem = useRedeemAppointmentClaim()
  const attemptedRef = useRef(false)

  // redeem/toast are recreated per render; the ref is what actually
  // guarantees this runs at most once, so they stay out of the dep list.
  const redeemRef = useRef(redeem)
  redeemRef.current = redeem
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    if (!user || attemptedRef.current) return
    attemptedRef.current = true

    const token = takePendingClaimToken()
    if (!token) return

    redeemRef.current
      .mutateAsync(token)
      .then((result) => {
        if (!result.claimed) return
        toastRef.current({
          variant: 'success',
          title: 'Appointment added to your account',
          description: result.organizationName ? `Your booking at ${result.organizationName} is now in My Appointments.` : undefined,
        })
      })
      .catch(() => {
        // Non-fatal by design — see the note above.
      })
  }, [user])
}
