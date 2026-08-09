/** Best-effort guess of the browser's IANA timezone, falling back to UTC. Shared by onboarding and location forms. */
export function guessTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}
