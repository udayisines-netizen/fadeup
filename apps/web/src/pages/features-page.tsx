import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  AnalyticsPreview,
  BarberPassportPreview,
  BookingPreview,
  ChairModePreview,
  CustomerTimelinePreview,
  LiveQueuePreview,
  MembershipPreview,
  MultiLocationPreview,
  WalkInPreview,
} from '@/components/marketing/product-previews'

interface FeatureSectionData {
  eyebrow: string
  title: string
  description: string
  bullets: string[]
  preview: ReactNode
}

const FEATURES: FeatureSectionData[] = [
  {
    eyebrow: 'Booking',
    title: 'A booking flow customers actually finish',
    description:
      'Service, barber, time, confirmation — the fewest steps between "I need a haircut" and a confirmed spot on the schedule.',
    bullets: [
      'Service → barber → time → confirmation in a handful of taps',
      'No forced account creation before a customer commits',
      'Confirmation up front reduces no-shows and double-bookings',
    ],
    preview: <BookingPreview />,
  },
  {
    eyebrow: 'Live Queue',
    title: 'Realtime position, not a guess',
    description:
      'Customers and staff see the same live queue update in realtime — position and wait estimate, without anyone hitting refresh.',
    bullets: [
      'Realtime position and wait-estimate updates for every customer in line',
      'Staff see queue changes the moment they happen, not on the next refresh',
      'Designed to stay understandable during a genuinely busy Saturday',
    ],
    preview: <LiveQueuePreview />,
  },
  {
    eyebrow: 'Walk-ins',
    title: 'Walk-ins and bookings, one queue',
    description:
      'Walk-in customers join the exact same live queue as booked appointments, ordered the way your shop actually works — not a second, disconnected list.',
    bullets: [
      'One queue for walk-ins and booked appointments, not two systems to reconcile',
      'Fast intake designed for a front-desk or barber to run in seconds',
      'Position updates in realtime as chairs open up',
    ],
    preview: <WalkInPreview />,
  },
  {
    eyebrow: 'Chair Mode',
    title: 'Built for a barber mid-service',
    description:
      'A barber-facing screen designed for one-handed, on-the-floor use — the actions that matter are always one large tap away.',
    bullets: [
      'Start service, finish service and next customer as large, immediate actions',
      'Large touch targets sized for tablet and phone use while working',
      'Status updates the live queue for everyone else in realtime',
    ],
    preview: <ChairModePreview />,
  },
  {
    eyebrow: 'Barber Passport',
    title: 'Preferences that travel with the customer',
    description:
      'A reusable record of how a customer likes to be groomed — fade length, part, notes — so a returning customer never has to re-explain their cut.',
    bullets: [
      'Grooming preferences and notes attached to the customer, not a single visit',
      'Available to any barber the customer sees, visit to visit',
      'Built to reduce miscommunication, not replace a barber’s judgment',
    ],
    preview: <BarberPassportPreview />,
  },
  {
    eyebrow: 'Customer CRM',
    title: 'Every visit, in one timeline',
    description:
      'A running history of visits, notes and preferences per customer — not scattered across notebooks, sticky notes and text threads.',
    bullets: [
      'Visit history and notes in one place, per customer',
      'Shared across the shop, not siloed to one barber’s memory',
      'Tenant-isolated per organization by design — never shared across shops',
    ],
    preview: <CustomerTimelinePreview />,
  },
  {
    eyebrow: 'Memberships & loyalty',
    title: 'Give customers a reason to come back on your schedule',
    description:
      'Recurring membership plans and loyalty balances, tracked alongside the rest of the customer relationship — not a separate punch card.',
    bullets: [
      'Recurring membership plans tied to the customer record',
      'Loyalty balances that update automatically as visits happen',
      'Designed to encourage repeat visits, not just track them after the fact',
    ],
    preview: <MembershipPreview />,
  },
  {
    eyebrow: 'Multi-location',
    title: 'One account, every location',
    description:
      'Run every chair at every location from a single organization, with clean, enforced ownership boundaries per shop.',
    bullets: [
      'Manage multiple locations under one organization',
      'Per-location queues, chairs and schedules stay distinct',
      'Team roles and permissions scoped correctly across locations',
    ],
    preview: <MultiLocationPreview />,
  },
  {
    eyebrow: 'Analytics',
    title: 'See how the shop is actually running',
    description:
      'Wait times, chair utilization and repeat-visit trends, in the product — no exporting to a spreadsheet to understand your own shop.',
    bullets: [
      'Wait-time and chair-utilization trends without manual tracking',
      'Repeat-visit and retention signals per customer and per location',
      'Built to answer real operating questions, not decorate a dashboard',
    ],
    preview: <AnalyticsPreview />,
  },
]

function FeatureSection({ data, reverse }: { data: FeatureSectionData; reverse: boolean }) {
  return (
    <section className={cn('border-t border-border py-14 sm:py-16', reverse && 'bg-paper-50')}>
      <Container size="xl" className="grid items-center gap-10 lg:grid-cols-2">
        <div className={reverse ? 'lg:order-2' : undefined}>
          <p className="text-sm font-medium text-accent-600">{data.eyebrow}</p>
          <h2 className="mt-2 text-2xl font-semibold text-balance text-ink-950 sm:text-3xl">{data.title}</h2>
          <p className="mt-3 text-ink-500">{data.description}</p>
          <ul className="mt-5 flex flex-col gap-2">
            {data.bullets.map((bullet) => (
              <li key={bullet} className="flex items-start gap-2 text-sm text-ink-700">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" aria-hidden="true" />
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={reverse ? 'lg:order-1' : undefined}>{data.preview}</div>
      </Container>
    </section>
  )
}

export function FeaturesPage() {
  useDocumentMeta({
    title: 'Features — FadeUp',
    description:
      'Booking, live queue, walk-ins, Chair Mode, Barber Passport, customer CRM, memberships, multi-location support and analytics — how FadeUp connects a barbershop’s day.',
  })

  return (
    <main>
      <section className="border-b border-border bg-paper-50">
        <Container size="xl" className="py-16 text-center sm:py-20">
          <Badge variant="accent">Product</Badge>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold text-balance text-ink-950 sm:text-5xl">
            Everything a barbershop runs on, connected.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-500">
            FadeUp is being built as one connected system for booking, the live queue, chair
            operations, customer relationships, memberships and multi-location reporting. The
            previews on this page are built from FadeUp&apos;s own design system to describe that
            direction — not screenshots of a finished, shipped product.
          </p>
        </Container>
      </section>

      {FEATURES.map((feature, index) => (
        <FeatureSection key={feature.title} data={feature} reverse={index % 2 === 1} />
      ))}

      <section className="border-t border-border">
        <Container size="xl" className="flex flex-col items-center gap-4 py-16 text-center sm:py-20">
          <h2 className="text-3xl font-semibold text-balance text-ink-950">See the plan structure</h2>
          <p className="max-w-xl text-ink-500">Compare tiers by location count and feature set.</p>
          <Link to="/pricing" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            View pricing
          </Link>
        </Container>
      </section>
    </main>
  )
}
