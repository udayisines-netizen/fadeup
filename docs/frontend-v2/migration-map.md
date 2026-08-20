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
| `/app` | `app-home-page` | `useCalendarRange`, `useBookingRequests`, `useCalendarProfessionals`, `useOrgLocations`, `useCompleteAppointment` | appointments + time_blocks | all members; barber sees own chair | `pro/dashboard-page` | ✅ DONE — V1 deleted |
| `/app/calendar` | `app-calendar-page` | `useCalendarRange`, `useCalendarProfessionals` | appointments + time_blocks | all members | rebuilt in place | ✅ DONE |
| `/app/queue` | `app-queue-page` | `useOrgQueue`, status mutations | queue_entries | all members | rebuilt in place + `pro/queue-entry-card` | ✅ DONE |
| `/app/requests` | `app-requests-page` | `useBookingRequests`, confirm/decline | appointments | front-of-house | reshelled | ✅ DONE |
| `/app/appointments` | `app-appointments-page` | `useOrgAppointmentsForDate`, `useAvailableSlots`, `useCreateAppointment` | — | manage roles write | reshelled | ✅ DONE |
| `/app/waitlist` | `app-waitlist-page` | `useOrgWaitlist` | — | all members | reshelled | ✅ DONE |
| `/app/customers` | `app-customers-page` | `useOrgCustomers` | — | all members | reshelled | ✅ DONE |
| `/app/services` | `app-services-page` | `useOrgServices`, categories, service_locations, barber_services | — | owner/manager write | reshelled | ✅ DONE |
| `/app/team` | `app-team-page` | `useOrgMemberships`, `useOrgStaffProfiles`, invitations | — | owner/manager | reshelled | ✅ DONE |
| `/app/availability` | `app-availability-page` | location_hours, barber_working_hours, exceptions | — | owner/manager | reshelled | ✅ DONE |
| `/app/locations` | `app-locations-page` | `useOrgLocations` | — | owner/manager | reshelled | ✅ DONE |
| `/app/chairs` | `app-chairs-page` | `useOrgChairs` | — | owner/manager | reshelled | ✅ DONE |
| `/app/memberships` | `app-memberships-page` | membership plans + customer memberships | — | owner/manager | reshelled | ✅ DONE |
| `/app/settings` | *(does not exist)* | — | — | — | — | ⛔ NOT BUILT — see below |
| shell | `routes/app-layout` — 12 horizontal nav links | `useCurrentOrg`, `useBookingRequests` | — | role gating | `routes/pro-shell` (sidebar + top bar + mobile tab bar) | ✅ DONE — V1 deleted |

### Professional changes beyond the shell

- **The shell owns the measure.** Every page wrapped itself in its own
  `Container` at its own size — `lg` here, `md` there, `xl` on the calendar —
  producing a different text column, a different left edge and doubled padding
  at 375px on each screen. That is most of why V1 read as a set of screens.
- **The queue stopped being a table.** Six columns do not fit 375px, and every
  status change cost two taps through a menu of six options. It is now cards
  split by position in the line, with the one obvious next move as a button.
- **`/app/settings` was scoped but not built.** Rather than ship a half-page,
  it is recorded as not built. Profile, preferences and organization settings
  remain reachable where they already were.

## Customer — `/app/customer/*` and public

| Route | V1 page | Data hooks | V2 | Status |
|---|---|---|---|---|
| `/search` | `marketplace-search-page` | `useSearchPublicProfessionals`, `usePublicCurrencies` | same page, now a thin wrapper around `customer/discovery-search` | ✅ DONE |
| `/app/customer` | `customer-home-page` | `useMyAppointments`, `useMyQueueStatus`, `useMyCustomerProfile` | `customer/discover-page` — context row + the same `discovery-search` | ✅ DONE — V1 deleted |
| `/app/customer/appointments` | `customer-appointments-page` | `useMyAppointments`, cancel, reschedule | same page, reshelled; times now in the SHOP's timezone | ✅ DONE |
| `/app/customer/favorites` | `customer-favorites-page` | favourites | same page, reshelled | ✅ DONE |
| `/app/customer/profile` | `customer-profile-page` | `useMyCustomerProfile` | same page, reshelled | ✅ DONE |
| `/app/customer/passport` | `customer-passport-page` | passport + shares | reshelled (padding only) | ✅ DONE |
| `/app/customer/onboarding` | `customer-onboarding-page` | `useUpsertMyCustomerProfile` | reshelled (padding only) | ✅ DONE |
| `/s/:slug/profile` | `shop-profile-page` | `usePublicOrganization`, locations, barbers | rebuilt in place | ✅ DONE |
| `/s/:slug/barbers/:id` | `public-barber-page` | `usePublicBarber`, `usePublicBarberServices` | rebuilt in place | ✅ DONE |
| `/s/:slug` | `public-booking-page` | `usePublicServices/Locations/Barbers/AvailableSlots`, `useBookPublicAppointment` | rebuilt in place + `booking/booking-steps`, `ui/date-strip`, `ui/time-slot-grid` | ✅ DONE |
| shell | `customer-app-layout` | — | `routes/customer-shell` (4 tabs + desktop header) | ✅ DONE — V1 deleted |
| public shell | `routes/public-booking-layout` | — | same file, + language switcher and shop link | ✅ DONE |

### Customer IA changes

- **Home and Discover merged.** V1 had both as tabs, where Home's discovery
  section was a card containing a button to Discover. The signed-in home now
  IS the search; the tab that existed to reach it is gone. Five tabs → four.
- **One shared search.** `components/customer/discovery-search` powers both
  `/search` and `/app/customer`. Two implementations of the same search was the
  largest source of drift in V1 — filters, empty states and cards differed
  depending on whether you were signed in.
- **Category chips are real filters.** They send `p_service_query`,
  `p_entity_type` and `p_open_now_only` to `search_public_professionals`. There
  is no cross-shop service taxonomy, so a chip's translated label IS the query —
  which is correct: a French shop names the service "Dégradé".
- **GeoIP country is a visible, removable filter**, never a silent one.
- Favorites stays inside Profile and Queue stays contextual — both were right
  in V1 and neither changed.

### Deleted (replacements proven by tests first)

`pages/customer-home-page.tsx` · `pages/customer-home-page.test.tsx` ·
`routes/customer-app-layout.tsx` · `components/marketplace/search-form.tsx` ·
`components/marketplace/professional-result-card.tsx` (+ test — its assertions
were ported into `components/customer/business-listing-card.test.tsx`, including
the one-tap "Book" route it proved).

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
| `marketplace/professional-result-card` | ✅ REPLACED by `BusinessListingCard`, then deleted |
| `marketplace/search-form` | ✅ REPLACED by `customer/discovery-search`, then deleted |
| `booking/booking-status` | KEEP — legacy pending is still a real state |
| `ui/tooltip` | KEPT but currently unused — a working primitive, not a superseded composition |
| `ui/table` | still used by Platform and by three pro pages that are genuinely tabular |

## Gates added by this rebuild

These exist because each failure is invisible in review and each one had
already happened:

| Gate | Catches |
|---|---|
| `i18n/no-hardcoded-strings.test.ts` | untranslated text in JSX (LOT E) |
| `i18n/terminology.test.ts` | "barbier" in French, brand-name drift (LOT E) |
| `i18n/direction.test.ts` | `<html lang>`/`<html dir>` not following the language (LOT E) |
| `i18n/no-browser-locale.test.ts` | `toLocale*`/`new Intl.*Format` with `undefined` — the browser's locale instead of the app's; and appointment times formatted with no timezone |
| `i18n/no-untranslated-status-maps.test.ts` | user-facing prose inside a `Record<…, string>` constant, which cannot be translated |
| `i18n/logical-properties.test.ts` | physical direction utilities (`ml-`, `right-4`, `text-left`) that do not mirror under `dir="rtl"` |
| `components/ui/direction.test.tsx` | `translateX` motion that does not carry `--fu-dir`, so it slides the wrong way in Arabic |

## Deliberately out of scope

Platform (`/platform/*`) and every acquisition surface: Worker V2 is frozen and
the brief scopes this rebuild to the *product* experience. Marketing pages
(`/`, `/for-business`, `/features`, `/pricing`) keep their current design —
they are the operator's in-progress work.
