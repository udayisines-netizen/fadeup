# Frontend V2 — migration map

Every product route, what renders it today, what it depends on, and what
replaces it. The dependency columns are the point of this document: they are
the contract the rebuild must not break.

Nothing is deleted until its replacement is proven. `RETAIN` means the file
survives V2 unchanged; `REPLACE` means the composition is rebuilt and the old
file is removed; `RESHELL` means the page keeps its logic but is recomposed.

---

## Professional — `/app/*`

| Route | V1 page | Data hooks / RPC | Realtime | RBAC | V2 | Status |
|---|---|---|---|---|---|---|
| `/app` | `app-home-page` | `useCalendarRange`, `useBookingRequests`, `useCalendarProfessionals`, `useOrgLocations`, `useCompleteAppointment` | appointments + time_blocks | all members; barber sees own chair | `pro/dashboard-page` | REPLACE |
| `/app/calendar` | `app-calendar-page` | `useCalendarRange`, `useCalendarProfessionals` | appointments + time_blocks | all members | `pro/calendar-page` | RESHELL |
| `/app/appointments` | `app-appointments-page` | `useOrgAppointmentsForDate`, `useAvailableSlots`, `useCreateAppointment` | — | manage roles write | folded into calendar + booking drawer | REPLACE |
| `/app/requests` | `app-requests-page` | `useBookingRequests`, confirm/decline | appointments | front-of-house | `pro/requests-page` | RESHELL |
| `/app/queue` | `app-queue-page` | `useOrgQueue`, status mutations | queue_entries | all members | `pro/queue-page` | REPLACE |
| `/app/waitlist` | `app-waitlist-page` | `useOrgWaitlist` | — | all members | `pro/waitlist-page` | RESHELL |
| `/app/customers` | `app-customers-page` | `useOrgCustomers` | — | all members | `pro/customers-page` | REPLACE |
| `/app/services` | `app-services-page` | `useOrgServices`, categories, service_locations, barber_services | — | owner/manager write | `pro/services-page` | RESHELL |
| `/app/team` | `app-team-page` | `useOrgMemberships`, `useOrgStaffProfiles`, invitations | — | owner/manager | `pro/team-page` | RESHELL |
| `/app/availability` | `app-availability-page` | location_hours, barber_working_hours, exceptions | — | owner/manager | `pro/availability-page` | RESHELL |
| `/app/locations` | `app-locations-page` | `useOrgLocations` | — | owner/manager | `pro/locations-page` | REPLACE |
| `/app/chairs` | `app-chairs-page` | `useOrgChairs` | — | owner/manager | folded into Locations | REPLACE |
| `/app/memberships` | `app-memberships-page` | membership plans + customer memberships | — | owner/manager | `pro/memberships-page` | RESHELL |
| `/app/settings` | *(did not exist)* | profile, preferences, org | — | self / owner | `pro/settings-page` | NEW |
| shell | `routes/app-layout` — 12 horizontal nav links | `useCurrentOrg`, `useBookingRequests` | — | role gating | `pro/pro-shell` (sidebar + top bar + mobile tab bar) | REPLACE |

## Customer — `/app/customer/*` and public

| Route | V1 page | Data hooks | V2 | Status |
|---|---|---|---|---|
| `/search` | `marketplace-search-page` | `useSearchPublicProfessionals`, `usePublicCurrencies` | `customer/discover-page` | REPLACE |
| `/app/customer` | `customer-home-page` | `useMyAppointments`, favourites | RESHELL under new customer shell | RESHELL |
| `/app/customer/appointments` | `customer-appointments-page` | `useMyAppointments`, cancel, reschedule | `customer/appointments-page` | RESHELL |
| `/app/customer/favorites` | `customer-favorites-page` | favourites | RESHELL | RESHELL |
| `/app/customer/profile` | `customer-profile-page` | `useOwnProfilePreferences` | RESHELL | RESHELL |
| `/s/:slug/profile` | `shop-profile-page` | `usePublicOrganization`, services, barbers | `customer/business-profile-page` | REPLACE |
| `/s/:slug/barbers/:id` | `public-barber-page` | `usePublicBarber`, `usePublicBarberServices` | `customer/professional-profile-page` | REPLACE |
| `/s/:slug` | `public-booking-page` | `usePublicServices/Locations/Barbers/AvailableSlots`, `useBookPublicAppointment` | `booking/booking-page` + step components | REPLACE |
| shell | `customer-app-layout` | — | `customer/customer-shell` (bottom tabs + desktop header) | REPLACE |

## Retained wholesale (logic, not composition)

`lib/queries/*` · `lib/calendar/{time,layout,professionals,ics}` · `lib/intl/*`
· `lib/realtime` · `lib/locale` · `i18n/*` · `lib/current-org-context` ·
`lib/auth-context` · every RPC wrapper.

**The rebuild adds no query and changes no RPC signature.**

## Primitives: keep, absorb, retire

| V1 primitive | V2 |
|---|---|
| `button`, `badge`, `card`, `dialog`, `drawer`, `toast`, `tooltip`, `tabs`, `skeleton`, `switch`, `text-field`, `textarea`, `select-field`, `dropdown-menu`, `spinner`, `container`, `alert` | KEEP — extended with V2 variants |
| `navbar`, `nav-link` | RETIRE once both shells ship |
| `empty-state`, `error-state` | KEEP — restyled |
| `table` | KEEP for Platform only; the product stops using it |
| `marketplace/professional-result-card` | REPLACE by `BusinessListingCard` |
| `booking/booking-status` | KEEP — legacy pending is still a real state |

## Deliberately out of scope

Platform (`/platform/*`) and every acquisition surface: Worker V2 is frozen and
the brief scopes this rebuild to the *product* experience. Marketing pages
(`/`, `/for-business`, `/features`, `/pricing`) keep their current design —
they are the operator's in-progress work.
