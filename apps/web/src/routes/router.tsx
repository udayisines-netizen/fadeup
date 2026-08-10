import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from '@/routes/root-layout'
import { RequireAuth } from '@/routes/require-auth'
import { AppLayout } from '@/routes/app-layout'
import { OnboardingRoute } from '@/routes/onboarding-route'
import { WorkspaceSelectorRoute } from '@/routes/workspace-selector-route'
import { AppCustomerRoute } from '@/routes/app-customer-route'
import { MarketingLayout } from '@/routes/marketing-layout'
import { PublicBookingLayout } from '@/routes/public-booking-layout'
import { PlatformLayout } from '@/routes/platform-layout'
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
        // Compatibility redirect to /pro/login — see src/pages/login-page.tsx.
        path: 'login',
        lazy: async () => {
          const { LoginPage } = await import('@/pages/login-page')
          return { Component: LoginPage }
        },
      },
      {
        // Compatibility redirect to /pro/signup — see src/pages/signup-page.tsx.
        path: 'signup',
        lazy: async () => {
          const { SignupPage } = await import('@/pages/signup-page')
          return { Component: SignupPage }
        },
      },
      {
        path: 'pro/login',
        lazy: async () => {
          const { ProLoginPage } = await import('@/pages/pro-login-page')
          return { Component: ProLoginPage }
        },
      },
      {
        path: 'pro/signup',
        lazy: async () => {
          const { ProSignupPage } = await import('@/pages/pro-signup-page')
          return { Component: ProSignupPage }
        },
      },
      {
        path: 'customer/login',
        lazy: async () => {
          const { CustomerLoginPage } = await import('@/pages/customer-login-page')
          return { Component: CustomerLoginPage }
        },
      },
      {
        path: 'customer/signup',
        lazy: async () => {
          const { CustomerSignupPage } = await import('@/pages/customer-signup-page')
          return { Component: CustomerSignupPage }
        },
      },
      {
        // Central post-login landing every login/signup form (except
        // /platform/login) redirects to by default — see
        // workspace-selector-page.tsx.
        path: 'workspace',
        element: (
          <RequireAuth>
            <WorkspaceSelectorRoute />
          </RequireAuth>
        ),
      },
      {
        path: 'app/customer',
        element: (
          <RequireAuth loginPath="/customer/login">
            <AppCustomerRoute />
          </RequireAuth>
        ),
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
        // Not part of public marketing navigation/sitemap — see
        // src/pages/platform-login-page.tsx.
        path: 'platform/login',
        lazy: async () => {
          const { PlatformLoginPage } = await import('@/pages/platform-login-page')
          return { Component: PlatformLoginPage }
        },
      },
      {
        // Deliberately unguessable, single-use — see
        // src/pages/platform-claim-page.tsx.
        path: 'platform/claim/:token',
        lazy: async () => {
          const { PlatformClaimPage } = await import('@/pages/platform-claim-page')
          return { Component: PlatformClaimPage }
        },
      },
      {
        path: 'platform/invite/:token',
        lazy: async () => {
          const { PlatformInvitePage } = await import('@/pages/platform-invite-page')
          return { Component: PlatformInvitePage }
        },
      },
      {
        path: 'platform',
        element: <PlatformLayout />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { PlatformOverviewPage } = await import('@/pages/platform-overview-page')
              return { Component: PlatformOverviewPage }
            },
          },
          {
            path: 'organizations',
            lazy: async () => {
              const { PlatformOrganizationsPage } = await import('@/pages/platform-organizations-page')
              return { Component: PlatformOrganizationsPage }
            },
          },
          {
            path: 'organizations/:organizationId',
            lazy: async () => {
              const { PlatformOrganizationDetailPage } = await import('@/pages/platform-organization-detail-page')
              return { Component: PlatformOrganizationDetailPage }
            },
          },
          {
            path: 'organizations/:organizationId/barbers/:barberId',
            lazy: async () => {
              const { PlatformBarberWorkspacePage } = await import('@/pages/platform-barber-workspace-page')
              return { Component: PlatformBarberWorkspacePage }
            },
          },
          {
            path: 'team',
            lazy: async () => {
              const { PlatformTeamPage } = await import('@/pages/platform-team-page')
              return { Component: PlatformTeamPage }
            },
          },
          {
            path: 'audit',
            lazy: async () => {
              const { PlatformAuditLogPage } = await import('@/pages/platform-audit-log-page')
              return { Component: PlatformAuditLogPage }
            },
          },
        ],
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
            path: 'team/:staffProfileId/workspace',
            lazy: async () => {
              const { AppBarberWorkspacePage } = await import('@/pages/app-barber-workspace-page')
              return { Component: AppBarberWorkspacePage }
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
