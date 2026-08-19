import { useMemo } from 'react'
import { useOrgBarbers } from '@/lib/queries/barbers'
import { useOrgStaffProfiles } from '@/lib/queries/staff-profiles'

/**
 * "Who can appear as a column on the calendar."
 *
 * A bookable professional is a `barbers` row joined to the `staff_profiles`
 * row that carries their name and location. Every calendar surface needs that
 * pair, and each one resolving it with `.find()` per appointment is the
 * quadratic pattern that makes a month view crawl — so the join happens once,
 * here, into a Map.
 */

export interface CalendarProfessional {
  barberId: string
  staffProfileId: string
  /** Who this professional IS, so a barber's own chair can be recognised. */
  userId: string
  displayName: string
  locationId: string | null
  isBookable: boolean
  isActive: boolean
}

export function useCalendarProfessionals(organizationId: string | undefined) {
  const barbersQuery = useOrgBarbers(organizationId)
  const staffQuery = useOrgStaffProfiles(organizationId)

  const professionals = useMemo<CalendarProfessional[]>(() => {
    const barbers = barbersQuery.data ?? []
    const staff = staffQuery.data ?? []
    if (barbers.length === 0 || staff.length === 0) return []

    const staffById = new Map(staff.map((profile) => [profile.id, profile]))

    return barbers
      .map((barber) => {
        const profile = staffById.get(barber.staffProfileId)
        if (!profile) return null
        return {
          barberId: barber.id,
          staffProfileId: profile.id,
          userId: profile.userId,
          displayName: profile.displayName,
          locationId: profile.locationId,
          isBookable: barber.isBookable,
          isActive: profile.isActive,
        }
      })
      .filter((value): value is CalendarProfessional => value !== null)
      // Stable, human order — the calendar's columns must not reshuffle
      // between renders or after a refetch.
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [barbersQuery.data, staffQuery.data])

  const byBarberId = useMemo(
    () => new Map(professionals.map((professional) => [professional.barberId, professional])),
    [professionals],
  )

  return {
    professionals,
    byBarberId,
    isPending: barbersQuery.isPending || staffQuery.isPending,
    isError: barbersQuery.isError || staffQuery.isError,
  }
}

/** Only those a customer could actually be booked with — the calendar's default columns. */
export function bookableProfessionals(professionals: CalendarProfessional[]): CalendarProfessional[] {
  return professionals.filter((professional) => professional.isBookable && professional.isActive)
}
