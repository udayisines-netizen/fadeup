import {
  CalendarDays,
  Clock3,
  Home,
  Inbox,
  MapPin,
  Scissors,
  Settings,
  Users,
  UserSquare2,
  Sparkles,
  ListOrdered,
  CreditCard,
} from 'lucide-react'
import type { ComponentType } from 'react'
import type { MembershipRole } from '@/lib/types'

/**
 * The Professional navigation, as data.
 *
 * V1 put twelve equal links in one horizontal row. Twelve is past the point
 * where a person scans — they read, every time, and the row told them nothing
 * about which four they actually use. Grouping is the fix, and grouping only
 * works if the groups mean something operationally:
 *
 *   FLOOR     what is happening right now. Opened constantly, all day.
 *   BUSINESS  what the shop IS. Configured occasionally, then left alone.
 *   SYSTEM    account and preferences.
 *
 * ORDERING IS ROLE-AWARE, VISIBILITY IS NOT. A barber and an owner see the
 * same destinations in a different order, because their days differ. What a
 * role may DO is decided server-side by RLS and by the RPCs, exactly as
 * before — this file never gates access, and hiding a link has never been
 * FadeUp's authorization model.
 *
 * There is no "Caisse", "Marketing" or "Avis & Réputation" here, though the
 * reference shows all three: FadeUp has no payments, no campaigns and no
 * reviews. A navigation item that leads nowhere is worse than a missing one.
 */

export interface ProNavItem {
  to: string
  /** i18n key, resolved at render. Never a literal. */
  labelKey: string
  icon: ComponentType<{ className?: string }>
  end?: boolean
  /** Which live count, if any, belongs on this item. */
  badge?: 'requests' | 'queue'
}

export interface ProNavGroup {
  titleKey: string
  items: ProNavItem[]
}

const FLOOR: ProNavItem[] = [
  { to: '/app', labelKey: 'app:nav.home', icon: Home, end: true },
  { to: '/app/calendar', labelKey: 'app:nav.calendar', icon: CalendarDays },
  { to: '/app/queue', labelKey: 'app:nav.queue', icon: ListOrdered, badge: 'queue' },
  { to: '/app/waitlist', labelKey: 'app:nav.waitlist', icon: Clock3 },
  { to: '/app/customers', labelKey: 'app:nav.customers', icon: Users },
]

const BUSINESS: ProNavItem[] = [
  { to: '/app/services', labelKey: 'app:nav.services', icon: Scissors },
  { to: '/app/team', labelKey: 'app:nav.team', icon: UserSquare2 },
  { to: '/app/availability', labelKey: 'app:nav.availability', icon: Sparkles },
  { to: '/app/locations', labelKey: 'app:nav.locations', icon: MapPin },
  { to: '/app/memberships', labelKey: 'app:nav.memberships', icon: CreditCard },
]

const SYSTEM: ProNavItem[] = [{ to: '/app/settings', labelKey: 'app:nav.settings', icon: Settings }]

/** Legacy pending only — surfaced when something is genuinely waiting. */
export const REQUESTS_ITEM: ProNavItem = {
  to: '/app/requests',
  labelKey: 'app:nav.requests',
  icon: Inbox,
  badge: 'requests',
}

/**
 * A barber's day is the floor and nothing else; front-of-house lives in the
 * calendar and the queue; an owner starts at the overview. Same set, different
 * first item — which is all "role-aware" should mean for navigation.
 */
export function proNavGroups(role: MembershipRole, pendingRequests: number): ProNavGroup[] {
  const floor = [...FLOOR]

  if (role === 'receptionist') {
    // Reception opens the calendar far more than the overview.
    const [home, calendar, ...rest] = floor
    floor.splice(0, floor.length, calendar, home, ...rest)
  }

  if (pendingRequests > 0) floor.splice(1, 0, REQUESTS_ITEM)

  const groups: ProNavGroup[] = [{ titleKey: 'app:nav.groupFloor', items: floor }]

  // A barber configures nothing; showing them a Business group they cannot use
  // would be five dead ends. Everyone else gets it.
  if (role !== 'barber') {
    groups.push({ titleKey: 'app:nav.groupBusiness', items: BUSINESS })
  }

  groups.push({ titleKey: 'app:nav.groupSystem', items: SYSTEM })
  return groups
}
