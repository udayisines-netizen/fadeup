import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert } from '@/components/ui/alert'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/cn'
import { getErrorMessage } from '@/lib/get-error-message'
import { startOAuth, type AuthIntent, type OAuthProvider } from '@/lib/oauth'

/**
 * "Continue with Google" / "Continue with Apple", identical on all five auth
 * surfaces — /login, /register, /pro/login, /pro/register and
 * /platform/login.
 *
 * It is the same component on the platform door on purpose. Platform staff
 * are FadeUp people with ordinary Google or Apple accounts; making them keep
 * a separate password just to sign in buys no security, because the thing
 * that makes them staff is a platform_members row and nothing else. Pressing
 * this button on /platform/login authenticates them and then hands off to
 * the callback, which checks the database and refuses /platform to anyone
 * who is not in that table — whichever provider they used.
 *
 * `intent` travels to the callback as a routing preference only. Passing
 * intent="platform" grants nothing; see resolveDestination().
 */

const PROVIDER_ORDER: OAuthProvider[] = ['google', 'apple']

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="h-[18px] w-[18px]" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.96H.96a9 9 0 0 0 0 8.08l3.01-2.32Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.96l3.01 2.32C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  )
}

function AppleMark() {
  return (
    <svg viewBox="0 0 16 20" className="h-[18px] w-[18px]" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M13.36 10.6c-.02-2.13 1.74-3.15 1.82-3.2-.99-1.45-2.54-1.65-3.09-1.67-1.31-.14-2.57.77-3.24.77-.67 0-1.7-.75-2.8-.73-1.44.02-2.77.84-3.51 2.13-1.5 2.6-.38 6.44 1.07 8.55.71 1.03 1.56 2.19 2.67 2.15 1.07-.04 1.48-.69 2.78-.69 1.3 0 1.66.69 2.8.67 1.16-.02 1.89-1.05 2.6-2.09.82-1.2 1.16-2.36 1.18-2.42-.03-.01-2.26-.87-2.28-3.47ZM11.24 4.4c.59-.72.99-1.71.88-2.7-.85.03-1.88.57-2.49 1.28-.55.63-1.03 1.64-.9 2.61.95.07 1.92-.48 2.51-1.19Z"
      />
    </svg>
  )
}

const PROVIDER_MARKS: Record<OAuthProvider, () => React.JSX.Element> = {
  google: GoogleMark,
  apple: AppleMark,
}

export function SocialAuthButtons({
  intent,
  next,
  className,
}: {
  intent: AuthIntent
  /** Internal path to return to; validated before it leaves the browser. */
  next?: string | null
  className?: string
}) {
  const { t } = useTranslation('auth')
  const [pending, setPending] = useState<OAuthProvider | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick(provider: OAuthProvider) {
    setError(null)
    setPending(provider)
    try {
      await startOAuth({ provider, intent, next })
      // On success the browser is already navigating to the provider, so
      // `pending` is deliberately left set — releasing it would flash the
      // button back to its resting state mid-redirect.
    } catch (cause) {
      // The common real-world case is a provider that is not configured on
      // this deployment yet. Say so plainly instead of showing a raw
      // "Unsupported provider" from GoTrue.
      setError(getErrorMessage(cause) ?? t('social.genericError'))
      setPending(null)
    }
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {error ? <Alert variant="error">{error}</Alert> : null}

      {PROVIDER_ORDER.map((provider) => {
        const Mark = PROVIDER_MARKS[provider]
        const isPending = pending === provider
        return (
          <button
            key={provider}
            type="button"
            onClick={() => handleClick(provider)}
            disabled={pending !== null}
            className={cn(
              'inline-flex min-h-11 w-full items-center justify-center gap-3 rounded-md border border-border-strong',
              'bg-paper-0 px-4 py-2 text-sm font-medium text-ink-950 transition-colors',
              'hover:bg-paper-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-700',
              'disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            {isPending ? <Spinner className="h-[18px] w-[18px]" /> : <Mark />}
            <span>{t(`social.continueWith`, { provider: t(`social.provider.${provider}`) })}</span>
          </button>
        )
      })}
    </div>
  )
}

/** "or" rule between the social buttons and the email/password form. */
export function AuthDivider() {
  const { t } = useTranslation('auth')
  return (
    <div className="my-5 flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      <span className="text-xs font-medium uppercase tracking-wide text-ink-500">{t('social.or')}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}
