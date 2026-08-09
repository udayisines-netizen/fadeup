import { cn } from '@/lib/cn'

interface SpinnerProps {
  className?: string
  label?: string
}

/** Small inline loading indicator. Always exposes an accessible label. */
export function Spinner({ className, label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center gap-2">
      <svg
        className={cn('h-4 w-4 animate-spin text-current', className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4Z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Full-height centered loading state, used while a page's primary data is not yet ready. */
export function PageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-svh items-center justify-center">
      <Spinner className="h-6 w-6 text-neutral-400" label={label} />
    </div>
  )
}
