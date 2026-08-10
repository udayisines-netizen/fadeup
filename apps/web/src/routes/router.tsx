import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from '@/routes/root-layout'
import { RequireAuth } from '@/routes/require-auth'
import { AppLayout } from '@/routes/app-layout'
import { OnboardingRoute } from '@/routes/onboarding-route'
import { MarketingLayout } from '@/routes/marketing-layout'
import { PublicBookingLayout } from '@/routes/public-booking-layout'
import { NotFoundPage } from '@/pages/not-found-page'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    children: [
      {
        // Shared nav/footer chrome for the public marketing site — kept
        // separate from the auth and /app routes below.
        element: <MarketingLayout />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { HomePage } = await import('@/pages/home-page')
              return { Component: HomePage }
            },
          },
          {
            path: 'features',
            lazy: async () => {
              const { FeaturesPage } = await import('@/pages/features-page')
              return { Component: FeaturesPage }
            },
          },
          {
            path: 'pricing',
            lazy: async () => {
              const { PricingPage } = await import('@/pages/pricing-page')
              return { Component: PricingPage }
            },
          },
        ],
      },
      {
        path: 'login',
        lazy: async () => {
          const { LoginPage } = await import('@/pages/login-page')
          return { Component: LoginPage }
        },
      },
      {
        path: 'signup',
        lazy: async () => {
          const { SignupPage } = await import('@/pages/signup-page')
          return { Component: SignupPage }
        },
      },
      {
        path: 'forgot-password',
        lazy: async () => {
          const { ForgotPasswordPage } = await import('@/pages/forgot-password-page')
          return { Component: ForgotPasswordPage }
        },
      },
      {
        path: 'reset-password',
        lazy: async () => {
          const { ResetPasswordPage } = await import('@/pages/reset-password-page')
          return { Component: ResetPasswordPage }
        },
      },
      {
        path: 'invite/:token',
        lazy: async () => {
          const { InvitePage } = await import('@/pages/invite-page')
          return { Component: InvitePage }
        },
      },
      {
        path: 'onboarding',
        element: (
          <RequireAuth>
            <OnboardingRoute />
          </RequireAuth>
        ),
      },
      {
        // Public, anonymous booking flow — deliberately its own layout, not
        // nested inside MarketingLayout or the authenticated /app tree. A
        // customer lands here directly from a shared link to complete one
        // focused task, not to browse the marketing site or a dashboard.
        path: 's/:slug',
        element: <PublicBookingLayout />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { PublicBookingPage } = await import('@/pages/public-booking-page')
              return { Component: PublicBookingPage }
            },
          },
          {
            path: 'walk-in',
            lazy: async () => {
              const { PublicWalkinPage } = await import('@/pages/public-walkin-page')
              return { Component: PublicWalkinPage }
            },
          },
          {
            path: 'display',
            lazy: async () => {
              const { PublicQueueDisplayPage } = await import('@/pages/public-queue-display-page')
              return { Component: PublicQueueDisplayPage }
            },
          },
          {
            path: 'barbers/:barberId',
            lazy: async () => {
              const { PublicBarberPage } = await import('@/pages/public-barber-page')
              return { Component: PublicBarberPage }
            },
          },
        ],
      },
      {
        path: 'app',
        element: (
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        ),
        children: [
          {
            index: true,
            lazy: async () => {
              const { AppHomePage } = await import('@/pages/app-home-page')
              return { Component: AppHomePage }
            },
          },
          {
            path: 'team',
            lazy: async () => {
              const { AppTeamPage } = await import('@/pages/app-team-page')
              return { Component: AppTeamPage }
            },
          },
          {
            path: 'locations',
            lazy: async () => {
              const { AppLocationsPage } = await import('@/pages/app-locations-page')
              return { Component: AppLocationsPage }
            },
          },
          {
            path: 'chairs',
            lazy: async () => {
              const { AppChairsPage } = await import('@/pages/app-chairs-page')
              return { Component: AppChairsPage }
            },
          },
          {
            path: 'services',
            lazy: async () => {
              const { AppServicesPage } = await import('@/pages/app-services-page')
              return { Component: AppServicesPage }
            },
          },
          {
            path: 'availability',
            lazy: async () => {
              const { AppAvailabilityPage } = await import('@/pages/app-availability-page')
              return { Component: AppAvailabilityPage }
            },
          },
          {
            path: 'appointments',
            lazy: async () => {
              const { AppAppointmentsPage } = await import('@/pages/app-appointments-page')
              return { Component: AppAppointmentsPage }
            },
          },
          {
            path: 'queue',
            lazy: async () => {
              const { AppQueuePage } = await import('@/pages/app-queue-page')
              return { Component: AppQueuePage }
            },
          },
          {
            path: 'customers',
            lazy: async () => {
              const { AppCustomersPage } = await import('@/pages/app-customers-page')
              return { Component: AppCustomersPage }
            },
          },
          {
            path: 'waitlist',
            lazy: async () => {
              const { AppWaitlistPage } = await import('@/pages/app-waitlist-page')
              return { Component: AppWaitlistPage }
            },
          },
          {
            path: 'memberships',
            lazy: async () => {
              const { AppMembershipsPage } = await import('@/pages/app-memberships-page')
              return { Component: AppMembershipsPage }
            },
          },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
