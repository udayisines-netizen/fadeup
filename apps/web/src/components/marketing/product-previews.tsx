import type { ReactNode } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

/**
 * Illustrative product mockups for the marketing site — built entirely from
 * FadeUp's own design-system primitives (`Card`/`Badge`), never a
 * screenshot. Booking, the live queue, Chair Mode, etc. are still under
 * active development (only auth/onboarding is built past this lot), so
 * every preview here is purely decorative: it's `aria-hidden`, and each is
 * labeled "Illustrative preview" in real, visible (non-hidden) text so
 * nobody mistakes it for a shipped, clickable feature. The actual
 * explanatory content lives in the surrounding page copy, not in these
 * mockups — screen reader users lose nothing by these being hidden.
 */
function PreviewFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        Illustrative preview — {label}
      </p>
      <Card elevated aria-hidden="true" className="overflow-hidden">
        <div className="p-4">{children}</div>
      </Card>
    </div>
  )
}

export function BookingPreview() {
  const steps = ['Service', 'Barber', 'Time', 'Confirm']

  return (
    <PreviewFrame label="Booking">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {steps.map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                index === 0 ? 'bg-accent-600 text-paper-0' : 'border border-border-strong text-ink-500',
              )}
            >
              {index + 1}
            </span>
            <span className="text-sm text-ink-700">{step}</span>
            {index < steps.length - 1 ? <span className="text-ink-300">&rarr;</span> : null}
          </li>
        ))}
      </ol>
    </PreviewFrame>
  )
}

export function LiveQueuePreview() {
  const entries = [
    { name: 'Alex M.', service: 'Skin fade + beard', status: 'In chair', variant: 'accent' as const, note: 'Started 4 min ago' },
    { name: 'Jordan P.', service: 'Buzz cut', status: 'Waiting', variant: 'warning' as const, note: '~8 min wait' },
    { name: 'Sam R.', service: 'Fade + line up', status: 'Waiting', variant: 'warning' as const, note: '~15 min wait' },
  ]

  return (
    <PreviewFrame label="Live Queue">
      <ul className="flex flex-col gap-2">
        {entries.map((entry) => (
          <li
            key={entry.name}
            className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink-950">{entry.name}</p>
              <p className="truncate text-xs text-ink-500">
                {entry.service} &middot; {entry.note}
              </p>
            </div>
            <Badge variant={entry.variant}>{entry.status}</Badge>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  )
}

export function WalkInPreview() {
  return (
    <PreviewFrame label="Walk-ins">
      <div className="flex items-center justify-between rounded-md border border-dashed border-border-strong px-3 py-2">
        <p className="text-sm text-ink-700">Add walk-in</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink-950 text-sm font-semibold text-paper-0">
          +
        </span>
      </div>
      <p className="mt-3 text-xs text-ink-500">
        Joins the same live queue as booked appointments, in the order your shop actually works.
      </p>
    </PreviewFrame>
  )
}

export function ChairModePreview() {
  return (
    <PreviewFrame label="Chair Mode">
      <div className="flex flex-col gap-3">
        <div className="rounded-md border border-border bg-paper-50 px-3 py-2">
          <p className="text-sm font-medium text-ink-950">Now serving &mdash; Jordan P.</p>
          <p className="text-xs text-ink-500">Buzz cut &middot; Chair 2</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <span className="flex min-h-11 items-center justify-center rounded-md bg-ink-950 px-3 text-center text-sm font-medium text-paper-0">
            Finish service
          </span>
          <span className="flex min-h-11 items-center justify-center rounded-md border border-border-strong px-3 text-center text-sm font-medium text-ink-800">
            Next customer
          </span>
        </div>
      </div>
    </PreviewFrame>
  )
}

export function BarberPassportPreview() {
  return (
    <PreviewFrame label="Barber Passport">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-medium text-ink-950">Alex M.</p>
          <p className="text-xs text-ink-500">Regular &middot; 12 visits</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="neutral">Skin fade, #2 sides</Badge>
          <Badge variant="neutral">Beard line-up</Badge>
          <Badge variant="neutral">Quiet chair, please</Badge>
        </div>
      </div>
    </PreviewFrame>
  )
}

export function CustomerTimelinePreview() {
  const visits = [
    { date: 'Aug 2', note: 'Skin fade + beard trim' },
    { date: 'Jul 5', note: 'Buzz cut' },
    { date: 'Jun 8', note: 'Skin fade' },
  ]

  return (
    <PreviewFrame label="Customer timeline">
      <ol className="flex flex-col gap-2.5 border-l border-border pl-4">
        {visits.map((visit) => (
          <li key={visit.date} className="relative text-sm text-ink-700">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-accent-600" />
            <span className="font-medium text-ink-950">{visit.date}</span> &mdash; {visit.note}
          </li>
        ))}
      </ol>
    </PreviewFrame>
  )
}

export function MembershipPreview() {
  return (
    <PreviewFrame label="Memberships & loyalty">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <div>
            <p className="text-sm font-medium text-ink-950">Monthly Unlimited</p>
            <p className="text-xs text-ink-500">Renews in 12 days</p>
          </div>
          <Badge variant="success">Active</Badge>
        </div>
        <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
          <p className="text-sm text-ink-700">Loyalty points</p>
          <span className="text-sm font-semibold text-ink-950">240 pts</span>
        </div>
      </div>
    </PreviewFrame>
  )
}

export function MultiLocationPreview() {
  const locations = [
    { name: 'Downtown', chairs: '6 chairs', status: 'Open' as const },
    { name: 'Uptown', chairs: '4 chairs', status: 'Open' as const },
    { name: 'Riverside', chairs: '3 chairs', status: 'Closed' as const },
  ]

  return (
    <PreviewFrame label="Multi-location">
      <ul className="flex flex-col gap-2">
        {locations.map((location) => (
          <li
            key={location.name}
            className="flex items-center justify-between rounded-md border border-border px-3 py-2"
          >
            <div>
              <p className="text-sm font-medium text-ink-950">{location.name}</p>
              <p className="text-xs text-ink-500">{location.chairs}</p>
            </div>
            <Badge variant={location.status === 'Open' ? 'success' : 'neutral'}>{location.status}</Badge>
          </li>
        ))}
      </ul>
    </PreviewFrame>
  )
}

export function AnalyticsPreview() {
  const stats = [
    { label: 'Avg. wait time', value: '9 min' },
    { label: 'Chair utilization', value: '78%' },
    { label: 'Repeat rate', value: '64%' },
  ]

  return (
    <PreviewFrame label="Analytics">
      <div className="grid grid-cols-3 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-md border border-border px-2 py-2.5 text-center">
            <p className="text-base font-semibold text-ink-950 sm:text-lg">{stat.value}</p>
            <p className="text-[11px] text-ink-500 sm:text-xs">{stat.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-500">Sample data for illustration.</p>
    </PreviewFrame>
  )
}
