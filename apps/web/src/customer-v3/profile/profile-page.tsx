/**
 * FadeUp V3 — customer Profile: social identity first, settings second.
 *
 * Identity header → the Fade Passport as a MINIATURE PASS (never a text
 * row) → Following (real counts only) → Activity (real notifications, mark
 * all read) → settings (language, sign out). Privacy toggles stay absent —
 * no contract exists, and UI must not invent one.
 */
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { useAuth } from '@/lib/auth-context'
import { getSupabaseClient } from '@/lib/supabase'
import { useMyCustomerProfile } from '@/lib/queries/customer-profile'
import { useNotifications, useMarkAllNotificationsRead } from '@/lib/queries/notifications'
import { useMyFollowedProfessionals } from '@/lib/queries/follows'
import { useMyFollowedOrganizations } from '@/lib/queries/organization-follows'
import { useDateTime } from '@/lib/intl/use-intl'
import { useDocumentMeta } from '@/lib/use-document-meta'
import { changeLocale } from '@/i18n'
import { SUPPORTED_LOCALES, LOCALE_LABELS, isSupportedLocale } from '@/lib/locale'
import { V3_ROUTES } from '@/customer-v3/routes'

export function CustomerV3ProfilePage() {
  const { t, i18n } = useTranslation('v3')
  useDocumentMeta({ title: t('account.metaTitle'), description: t('account.metaDescription'), noIndex: true })

  const { user, loading } = useAuth()
  const profile = useMyCustomerProfile(user?.id)
  const notifications = useNotifications(user?.id)
  const markAllRead = useMarkAllNotificationsRead(user?.id)
  const followedPros = useMyFollowedProfessionals(Boolean(user))
  const followedOrgs = useMyFollowedOrganizations(Boolean(user))
  const dt = useDateTime()

  const displayName = profile.data?.displayName ?? user?.email ?? ''
  const initials = useMemo(
    () =>
      displayName
        .split(/\s+/)
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join('')
        .toUpperCase(),
    [displayName],
  )

  const followingCount = (followedPros.data?.length ?? 0) + (followedOrgs.data?.length ?? 0)
  const recentNotifications = (notifications.data ?? []).slice(0, 6)

  const languagePicker = (
    <label className="v3pr-item">
      <span>{t('landing.nav.language')}</span>
      <select
        value={i18n.language}
        aria-label={t('landing.nav.language')}
        onChange={(event) => {
          const next = event.target.value
          if (isSupportedLocale(next)) void changeLocale(next)
        }}
        style={{ font: 'inherit', border: 0, background: 'transparent', color: 'var(--v3-green-ink)', fontWeight: 600, minBlockSize: 44 }}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale}>
            {LOCALE_LABELS[locale]}
          </option>
        ))}
      </select>
    </label>
  )

  if (!loading && !user) {
    return (
      <div className="v3pr-page">
        <div className="v3a-empty">
          <h1 className="v3a-empty-title">{t('account.signedOutTitle')}</h1>
          <p className="v3-meta">{t('account.signedOutBody')}</p>
          <Link to="/login" className="v3-btn v3-btn--primary-ink v3-press">
            {t('landing.nav.signIn')}
          </Link>
        </div>
        <div className="v3a-results v3pr-list">{languagePicker}</div>
      </div>
    )
  }

  return (
    <div className="v3pr-page">
      <header className="v3pr-identity">
        <span className="v3pr-avatar" aria-hidden="true">
          {initials || '•'}
        </span>
        <div style={{ minInlineSize: 0 }}>
          <h1 className="v3-h1">
            <bdi>{displayName}</bdi>
          </h1>
          {user?.email && user.email !== displayName ? <p className="v3-meta">{user.email}</p> : null}
        </div>
      </header>

      {/* The Passport entry is a miniature of the pass itself. */}
      <Link to={`${V3_ROUTES.profile}/passport`} className="v3pr-pass-mini v3-press">
        <span className="v3pr-pass-mini-label">{t('landing.passport.cardLabel')}</span>
        <span className="v3pr-pass-mini-name">
          <bdi>{displayName}</bdi>
        </span>
        <span className="v3-meta" style={{ color: 'var(--v3-on-graphite-dim)' }}>
          {t('account.passportOpen')}
        </span>
      </Link>

      {followingCount > 0 ? (
        <section aria-labelledby="v3pr-following">
          <div className="v3a-section-head">
            <h2 id="v3pr-following" className="v3a-section-title">
              {t('account.following')}
            </h2>
          </div>
          <div className="v3a-results v3pr-list">
            {(followedPros.data ?? []).map((pro) => (
              <span key={pro.id} className="v3pr-item" style={{ cursor: 'default' }}>
                <bdi>{pro.displayName}</bdi>
                {pro.handle ? <span className="v3-meta">@{pro.handle}</span> : null}
              </span>
            ))}
            {/* The org-follow contract carries ids only (no public names) —
                count-only, never an invented label per name row. */}
            {(followedOrgs.data ?? []).length > 0 ? (
              <span className="v3pr-item" style={{ cursor: 'default' }}>
                <span>{t('account.followedShops', { count: followedOrgs.data?.length ?? 0 })}</span>
              </span>
            ) : null}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="v3pr-activity">
        <div className="v3a-section-head">
          <h2 id="v3pr-activity" className="v3a-section-title">
            {t('account.activity')}
          </h2>
          {notifications.unreadCount > 0 ? (
            <button
              type="button"
              className="v3a-section-link v3-press"
              style={{ border: 0, background: 'transparent', cursor: 'pointer', font: 'inherit' }}
              onClick={() => markAllRead.mutate()}
            >
              {t('account.markAllRead')}
            </button>
          ) : null}
        </div>
        {notifications.isError ? (
          <p role="alert" className="v3a-error">
            {t('app.errors.load')}
          </p>
        ) : recentNotifications.length === 0 ? (
          <p className="v3-meta">{t('account.noActivity')}</p>
        ) : (
          <div className="v3a-results v3pr-list">
            {recentNotifications.map((notification) => (
              <div key={notification.id} className="v3pr-note" data-unread={notification.readAt === null}>
                <span style={{ fontWeight: 600, fontSize: '0.9063rem' }}>{notification.title}</span>
                {notification.body ? <span className="v3-meta">{notification.body}</span> : null}
                <span className="v3-meta" style={{ fontSize: '0.75rem' }}>
                  {dt.dateTime(notification.createdAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="v3pr-settings">
        <div className="v3a-section-head">
          <h2 id="v3pr-settings" className="v3a-section-title">
            {t('account.settings')}
          </h2>
        </div>
        <div className="v3a-results v3pr-list">
          {languagePicker}
          <button
            type="button"
            className="v3pr-item v3-press"
            onClick={() => {
              void getSupabaseClient()
                .auth.signOut()
                .then(() => {
                  window.location.assign(V3_ROUTES.landing)
                })
            }}
          >
            <span style={{ color: 'var(--v3-alert)', fontWeight: 600 }}>{t('account.signOut')}</span>
          </button>
        </div>
      </section>
    </div>
  )
}
