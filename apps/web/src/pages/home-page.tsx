import { Link } from 'react-router-dom'
import {
  Armchair,
  BarChart3,
  CalendarClock,
  Gift,
  IdCard,
  MapPin,
  Radio,
  UserPlus,
  Users,
} from 'lucide-react'
import { Container } from '@/components/ui/container'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDocumentMeta } from '@/lib/use-document-meta'
import {
  BookingPreview,
  ChairModePreview,
  LiveQueuePreview,
  MultiLocationPreview,
} from '@/components/marketing/product-previews'

const PILLARS = [
  {
    icon: CalendarClock,
    title: 'Booking',
    description: 'A fast service → barber → time → confirm flow customers can complete in under a minute.',
  },
  {
    icon: Radio,
    title: 'Live Queue',
    description: 'Realtime position and wait estimates for everyone waiting — no app download, no guessing.',
  },
  {
    icon: UserPlus,
    title: 'Walk-ins',
    description: 'Walk-ins join the same live queue as booked appointments, in the order your shop actually works.',
  },
  {
    icon: Armchair,
    title: 'Chair Mode',
    description: 'A barber-facing screen built for mid-service use: start, finish, next customer, one tap each.',
  },
  {
    icon: IdCard,
    title: 'Barber Passport',
    description: 'Reusable grooming preferences and notes that travel with the customer, visit to visit.',
  },
  {
    icon: Users,
    title: 'Customer CRM',
    description: 'Every visit, note and preference in one timeline — not scattered across notebooks and texts.',
  },
  {
    icon: Gift,
    title: 'Memberships & loyalty',
    description: 'Recurring plans and loyalty balances that keep customers coming back on your schedule.',
  },
  {
    icon: MapPin,
    title: 'Multi-location',
    description: 'Run every chair at every location from one account, with clean ownership per shop.',
  },
  {
    icon: BarChart3,
    title: 'Analytics',
    description: 'Wait times, chair utilization and repeat-visit trends, without exporting a spreadsheet.',
  },
]

export function HomePage() {
  useDocumentMeta({
    title: 'FadeUp — the operating system for modern barbershops',
    description:
      'FadeUp connects booking, live queue, walk-ins, Chair Mode, Barber Passport, customer relationships, memberships and multi-location reporting for barbershops in one system.',
  })

  return (
    <main>
      {/* Hero */}
      <section className="border-b border-border bg-paper-50">
        <Container size="xl" className="grid gap-10 py-16 sm:py-20 lg:grid-cols-2 lg:items-center lg:py-24">
          <div>
            <Badge variant="accent">For modern barbershops</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance text-ink-950 sm:text-5xl">
              The operating system for modern barbershops.
            </h1>
            <p className="mt-4 max-w-xl text-lg text-ink-500">
              Not just appointment software. FadeUp connects booking, the live queue, walk-ins,
              chair operations, customer relationships and multi-location reporting in one
              place — built for how a real shop actually runs, on a real Saturday.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/signup" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Start free
              </Link>
              <Link to="/features" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
                See how it works
              </Link>
            </div>
          </div>
          <LiveQueuePreview />
        </Container>
      </section>

      {/* Pillars grid */}
      <section>
        <Container size="xl" className="py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold text-balance text-ink-950">
              Built for how barbershops actually run
            </h2>
            <p className="mt-3 text-ink-500">
              Every part of a shop&apos;s day, in one connected system — from the moment a
              customer books to the moment their loyalty points update.
            </p>
          </div>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PILLARS.map((pillar) => (
              <Card key={pillar.title}>
                <CardHeader>
                  <pillar.icon className="h-5 w-5 text-accent-600" aria-hidden="true" />
                  <CardTitle className="text-base">{pillar.title}</CardTitle>
                  <CardDescription>{pillar.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </Container>
      </section>

      {/* Role tabs */}
      <section className="border-t border-border bg-paper-50">
        <Container size="xl" className="py-16 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold text-balance text-ink-950">
              One system, built for every role in the shop
            </h2>
            <p className="mt-3 text-ink-500">
              Owners, barbers and customers each need something different — FadeUp is designed
              role by role, not as one generic dashboard stretched across everyone.
            </p>
          </div>

          <Tabs defaultValue="owner" className="mt-8">
            <TabsList>
              <TabsTrigger value="owner">Owner / manager</TabsTrigger>
              <TabsTrigger value="barber">Barber</TabsTrigger>
              <TabsTrigger value="customer">Customer</TabsTrigger>
            </TabsList>

            <TabsContent value="owner" className="grid gap-8 pt-8 lg:grid-cols-2 lg:items-center">
              <div>
                <h3 className="text-xl font-semibold text-ink-950">Run every location from one place</h3>
                <p className="mt-2 text-ink-500">
                  See every chair, every queue and every location&apos;s performance without
                  chasing down separate notebooks or spreadsheets — with clean ownership per shop.
                </p>
              </div>
              <MultiLocationPreview />
            </TabsContent>

            <TabsContent value="barber" className="grid gap-8 pt-8 lg:grid-cols-2 lg:items-center">
              <div>
                <h3 className="text-xl font-semibold text-ink-950">Built for speed, mid-service</h3>
                <p className="mt-2 text-ink-500">
                  Chair Mode keeps the actions a barber actually needs — start, finish, next
                  customer — one tap away, with large touch targets designed for one-handed,
                  on-the-floor use.
                </p>
              </div>
              <ChairModePreview />
            </TabsContent>

            <TabsContent value="customer" className="grid gap-8 pt-8 lg:grid-cols-2 lg:items-center">
              <div>
                <h3 className="text-xl font-semibold text-ink-950">Book in under a minute</h3>
                <p className="mt-2 text-ink-500">
                  Service, barber, time, confirmation — no forced account creation before a
                  customer commits, and no guessing how long the wait will be.
                </p>
              </div>
              <BookingPreview />
            </TabsContent>
          </Tabs>
        </Container>
      </section>

      {/* Final CTA */}
      <section className="border-t border-border">
        <Container size="xl" className="flex flex-col items-center gap-4 py-16 text-center sm:py-20">
          <h2 className="text-3xl font-semibold text-balance text-ink-950">
            Ready to run your shop on FadeUp?
          </h2>
          <p className="max-w-xl text-ink-500">
            Set up your organization and start taking bookings today.
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <Link to="/signup" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Start free
            </Link>
            <Link to="/pricing" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
              View pricing
            </Link>
          </div>
        </Container>
      </section>
    </main>
  )
}
