/**
 * Generates the client-side invitation token. `public.invitations.token` is
 * NOT database-generated (see db/migrations/20260809110000_invitations.sql) —
 * the client must produce 32 random bytes, hex-encoded, before inserting.
 */
export function generateInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
