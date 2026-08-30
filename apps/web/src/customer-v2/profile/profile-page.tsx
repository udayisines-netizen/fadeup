import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronDown } from 'lucide-react'
import { getSupabaseClient } from '@/lib/supabase'
import { useAuth } from '@/lib/auth-context'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  LOCALE_LABELS,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  setExplicitLocale,
  type SupportedLocale,
} from '@/lib/locale'
import { changeLocale } from '@/i18n'
import { useOwnProfile, useUpdateProfilePreferences } from '@/lib/queries/profile'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import {
  useMarkAllNotificationsRead,
  useNotifications,
  type AppNotification,
} from '@/lib/queries/notifications'
import { useMyFollowedProfessionals } from '@/lib/queries/follows'
import { useMyFollowedOrganizations } from '@/lib/queries/organization-follows'
import { IdentityTile } from '@/customer-v2/home/identity-tile'
import { Notice } from '@/customer-v2/ui/notice'
import { V2_ROUTES } from '@/customer-v2/routes'

/**
 * The customer's own profile — identity, activity, relationships, settings.
 *
 * ============================================================================
 * WHAT "WHERE SUPPORTED" RESOLVES TO, HONESTLY
 * ============================================================================
 *
 * The blueprint's customer profile lists followers, verification, "Cuts here /
 * Gets cut by", and OFF / FRIENDS ONLY / PUBLIC privacy modes. None of those
 * has a backend contract yet: `profiles` is self-read-only with a full name,
 * `customer_profiles` carries preferences and no visibility column, no
 * contract counts a CUSTOMER's followers, and no table stores a customer↔
 * barber relationship a privacy mode could govern. Privacy must be enforced by
 * RLS, not painted in a client — so this page renders none of it, and the gap
 * is recorded for the roadmap instead of being imitated with dead toggles.
 *
 * What IS real, and rendered: identity (customer display name over account
 * name over email), the customer's own following (professionals with their
 * real identities; organizations as a count, because
 * `list_my_followed_organizations` returns ids and dates, not names), the
 * ACTIVITY feed (the notifications contract: booking lifecycle + invitations,
 * with mark-all-read), and the two account settings the shell deliberately
 * moved here in R5R.1A — language, persisted through the existing three-layer
 * chain (explicit localStorage → i18n runtime → profile row), and sign-out.
 */
export function CustomerV2ProfilePage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { user, loading } = useAuth()

  const ownName = useOwnProfile(user?.id)
  const customerProfile = useMyCustomerProfile(user?.id)
  const notifications = useNotifications(user?.id)
  const markAllRead = useMarkAllNotificationsRead(user?.id)
  const followedPros = useMyFollowedProfessionals(Boolean(user))
  const followedOrgs = useMyFollowedOrganizations(Boolean(user))
  const updatePreferences = useUpdateProfilePreferences(user?.id)

  useDocumentMeta({
    title: t('customer-app:v2.profilePage.documentTitle'),
    description: t('customer-app:v2.profilePage.documentDescription'),
    noIndex: true,
  })

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-[30rem]">
        <h1 className="mb-4 text-v2-lead font-semibold tracking-[-0.02em] text-v2-ink">
          {t('customer-app:v2.nav.profile')}
        </h1>
        <Notice
          tone="empty"
          title={t('customer-app:v2.profilePage.signInTitle')}
          body={t('customer-app:v2.profilePage.signInBody')}
          actionLabel={null}
          onAction={null}
        />
        <Link
          to={`/login?redirect=${encodeURIComponent(V2_ROUTES.profile)}`}
          className="v2-press mt-3 inline-flex h-11 w-full items-center justify-center rounded-v2-2 bg-v2-ink px-4 text-v2-meta font-semibold text-v2-paper hover:bg-v2-ink/90"
        >
          {t('customer-app:v2.appointments.signInAction')}
        </Link>
      </div>
    )
  }

  if (loading || !user) return <div className="min-h-64" />

  const displayName = customerProfile.data?.displayName ?? ownName.data ?? user.email ?? ''

  const activeLocale: SupportedLocale = isSupportedLocale(i18n.language) ? i18n.language : 'en'

  const changeLanguage = async (locale: SupportedLocale) => {
    // The existing three-layer persistence, in its existing order: explicit
    // choice outranks detection forever; the profile row makes it roam.
    setExplicitLocale(locale)
    await changeLocale(locale)
    updatePreferences.mutate({ locale })
  }

  const signOut = async () => {
    await getSupabaseClient().auth.signOut()
    navigate('/login', { replace: true })
  }

  const unread = (notifications.data ?? []).filter((entry) => !entry.readAt)

  return (
    <div className="mx-auto flex max-w-[36rem] flex-col gap-4">
      <h1 className="sr-only">{t('customer-app:v2.nav.profile')}</h1>

      {/* ── Identity ─────────────────────────────────────────────────────── */}
      <section className="v2-plate flex items-center gap-4 p-5">
        <IdentityTile src={null} alt="" kind="barber" className="h-16 w-16 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-v2-lead font-semibold text-v2-ink">
            <bdi>{displayName}</bdi>
          </p>
          {user.email && user.email !== displayName ? (
            <p className="truncate text-v2-meta text-v2-ink-soft">{user.email}</p>
          ) : null}
        </div>
      </section>

      {/* ── Activity ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-profile-activity" className="v2-plate overflow-hidden">
        <div className="flex items-baseline justify-between gap-3 px-4 py-3 md:px-5">
          <h2 id="v2-profile-activity" className="text-v2-title font-semibold text-v2-ink">
            {t('customer-app:v2.profilePage.activity')}
          </h2>
          {unread.length > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="v2-press shrink-0 text-v2-meta font-semibold text-v2-green hover:underline"
            >
              {t('customer-app:v2.profilePage.markAllRead')}
            </button>
          ) : null}
        </div>

        {(notifications.data ?? []).length > 0 ? (
          <ul>
            {(notifications.data ?? []).slice(0, 12).map((entry) => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.profilePage.noActivity')}
          </p>
        )}
      </section>

      {/* ── Following ────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-profile-following" className="v2-plate overflow-hidden">
        <h2
          id="v2-profile-following"
          className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5"
        >
          {t('customer-app:v2.profilePage.following')}
        </h2>

        {(followedPros.data ?? []).length > 0 ? (
          <ul>
            {(followedPros.data ?? []).map((professional) => (
              <li
                key={professional.id}
                className="flex items-center gap-3 border-t border-v2-hairline px-4 py-3 md:px-5"
              >
                <IdentityTile
                  src={professional.avatarUrl}
                  alt=""
                  kind="barber"
                  className="h-11 w-11 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-v2-body font-medium text-v2-ink">
                    <bdi>{professional.displayName}</bdi>
                  </p>
                  {professional.handle ? (
                    <p className="truncate text-v2-meta text-v2-ink-soft">@{professional.handle}</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="border-t border-v2-hairline px-4 py-4 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.profilePage.noFollowing')}
          </p>
        )}

        {(followedOrgs.data ?? []).length > 0 ? (
          <p className="border-t border-v2-hairline px-4 py-3 text-v2-meta text-v2-ink-soft md:px-5">
            {t('customer-app:v2.profilePage.followedShops', {
              count: (followedOrgs.data ?? []).length,
            })}
          </p>
        ) : null}
      </section>

      {/* ── Fade Passport ────────────────────────────────────────────────── */}
      <Link
        to={`${V2_ROUTES.profile}/passport`}
        className="v2-press v2-plate flex items-center justify-between gap-3 px-4 py-3.5 text-v2-body font-semibold text-v2-ink hover:bg-v2-ground md:px-5"
      >
        {t('customer-app:v2.passport.title')}
        <span aria-hidden="true" className="text-v2-ink-mute">→</span>
      </Link>

      {/* ── Settings ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="v2-profile-settings" className="v2-plate overflow-hidden">
        <h2
          id="v2-profile-settings"
          className="px-4 py-3 text-v2-title font-semibold text-v2-ink md:px-5"
        >
          {t('customer-app:v2.profilePage.settings')}
        </h2>

        <div className="flex items-center justify-between gap-3 border-t border-v2-hairline px-4 py-3 md:px-5">
          <p className="text-v2-body text-v2-ink">{t('customer-app:v2.profilePage.language')}</p>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger className="v2-press inline-flex h-11 items-center rounded-v2-2">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-v2-2 border border-v2-hairline bg-v2-paper px-2.5 text-v2-meta font-medium text-v2-ink">
                {LOCALE_LABELS[activeLocale]}
                <ChevronDown
                  className="h-3.5 w-3.5 text-v2-ink-mute"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </span>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                data-fu-v2
                align="end"
                sideOffset={6}
                className="v2-plate z-40 max-h-80 min-w-[12rem] overflow-y-auto py-1 text-v2-ink"
              >
                <DropdownMenu.RadioGroup
                  value={activeLocale}
                  onValueChange={(value) => void changeLanguage(value as SupportedLocale)}
                >
                  {SUPPORTED_LOCALES.map((locale) => (
                    <DropdownMenu.RadioItem
                      key={locale}
                      value={locale}
                      className="flex min-h-11 cursor-pointer select-none items-center gap-2.5 px-3 py-2 text-v2-meta outline-none data-[highlighted]:bg-v2-fill"
                    >
                      <span className="flex-1">{LOCALE_LABELS[locale]}</span>
                      <DropdownMenu.ItemIndicator>
                        <Check
                          className="h-4 w-4 shrink-0 text-v2-green"
                          strokeWidth={2.2}
                          aria-hidden="true"
                        />
                      </DropdownMenu.ItemIndicator>
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>

        <div className="border-t border-v2-hairline px-4 py-3 md:px-5">
          <button
            type="button"
            onClick={() => void signOut()}
            className="v2-press inline-flex h-11 w-full items-center justify-center rounded-v2-2 border border-v2-edge bg-v2-paper px-4 text-v2-meta font-semibold text-v2-ink hover:bg-v2-fill"
          >
            {t('customer-app:v2.profilePage.signOut')}
          </button>
        </div>
      </section>
    </div>
  )
}

function ActivityRow({ entry }: { entry: AppNotification }) {
  const { i18n } = useTranslation()

  const when = new Intl.DateTimeFormat(i18n.language, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(entry.createdAt))

  return (
    <li className="flex items-start gap-3 border-t border-v2-hairline px-4 py-3 md:px-5">
      {/* The unread marker is a real state, not decoration. */}
      <span
        aria-hidden="true"
        className={
          entry.readAt
            ? 'mt-2 h-2 w-2 shrink-0 rounded-full bg-v2-hairline'
            : 'mt-2 h-2 w-2 shrink-0 rounded-full bg-v2-green'
        }
      />
      <div className="min-w-0 flex-1">
        <p className="text-v2-body font-medium text-v2-ink">{entry.title}</p>
        {entry.body ? <p className="mt-0.5 text-v2-meta text-v2-ink-soft">{entry.body}</p> : null}
        <p className="mt-0.5 text-v2-caption text-v2-ink-mute">{when}</p>
      </div>
    </li>
  )
}
