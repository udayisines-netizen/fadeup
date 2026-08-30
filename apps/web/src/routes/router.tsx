import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from '@/routes/root-layout'
import { RequireAuth } from '@/routes/require-auth'
import { ProShell } from '@/routes/pro-shell'
import { OnboardingRoute } from '@/routes/onboarding-route'
import { WorkspaceSelectorRoute } from '@/routes/workspace-selector-route'
import { CustomerShell } from '@/routes/customer-shell'
import { RequireProAccess } from '@/routes/require-pro-access'
import { ProApplicationRoute } from '@/routes/pro-application-route'
import { MarketingLayout } from '@/routes/marketing-layout'
import { PublicBookingLayout } from '@/routes/public-booking-layout'
import { PlatformLayout } from '@/routes/platform-layout'
import { NotFoundPage } from '@/pages/not-found-page'
import { RouteErrorBoundary } from '@/routes/route-error-boundary'
import { V2_ROUTE_PATH } from '@/customer-v2/routes'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    /*
      Without this, a render error anywhere in the tree below reaches React
      Router's built-in developer screen ("Unexpected Application Error! Hey
      developer…") — which is what production visitors saw when /onboarding
      threw. The ErrorBoundary in App.tsx cannot help: it sits ABOVE
      <RouterProvider>, and the router catches route errors before they can
      bubble that far.

      Placed on the root route so it covers every branch, including the lazy
      ones (a chunk that fails to load surfaces here too). Nested routes may
      add their own errorElement to keep their chrome; none needs to today.
    */
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        // Shared nav/footer chrome for the public marketing site — kept
        // separate from the auth and /app routes below.
        element: <MarketingLayout />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { ConsumerLandingPage } = await import('@/pages/consumer-landing-page')
              return { Component: ConsumerLandingPage }
            },
          },
          {
            path: 'search',
            lazy: async () => {
              const { MarketplaceSearchPage } = await import('@/pages/marketplace-search-page')
              return { Component: MarketplaceSearchPage }
            },
          },
          {
            path: 'for-business',
            lazy: async () => {
              const { BusinessLandingPage } = await import('@/pages/business-landing-page')
              return { Component: BusinessLandingPage }
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
        // Canonical CUSTOMER sign-in. Professionals use /pro/login.
        path: 'login',
        lazy: async () => {
          const { CustomerLoginPage } = await import('@/pages/customer-login-page')
          return { Component: CustomerLoginPage }
        },
      },
      {
        // Canonical CUSTOMER sign-up — never creates a professional
        // application. Professionals apply at /pro/register.
        path: 'register',
        lazy: async () => {
          const { CustomerRegisterPage } = await import('@/pages/customer-register-page')
          return { Component: CustomerRegisterPage }
        },
      },
      {
        // Compatibility redirect to /register — see src/pages/signup-page.tsx.
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
        // The professional APPLICATION. Submitting grants nothing until a
        // platform reviewer approves it.
        path: 'pro/register',
        lazy: async () => {
          const { ProRegisterPage } = await import('@/pages/pro-register-page')
          return { Component: ProRegisterPage }
        },
      },
      {
        // Compatibility redirect to /pro/register.
        path: 'pro/signup',
        lazy: async () => {
          const { ProSignupPage } = await import('@/pages/pro-signup-page')
          return { Component: ProSignupPage }
        },
      },
      {
        // Where an applicant lives between submitting and being decided on,
        // and where a refused applicant is sent instead of a bare
        // authorization error.
        path: 'pro/application',
        element: (
          <RequireAuth loginPath="/pro/login">
            <ProApplicationRoute />
          </RequireAuth>
        ),
      },
      {
        // The ONE place every Google/Apple sign-in returns to, whichever
        // door it started at (/login, /register, /pro/login, /pro/register,
        // /platform/login). Three callbacks would mean three implementations
        // of "who is this and where do they belong" — which is exactly how
        // a platform door ends up with a weaker check than a customer one.
        path: 'auth/callback',
        lazy: async () => {
          const { AuthCallbackPage } = await import('@/pages/auth-callback-page')
          return { Component: AuthCallbackPage }
        },
      },
      {
        // Compatibility redirects: the canonical customer routes are now
        // /login and /register. Kept so existing links (FavoriteButton,
        // RequireAuth's loginPath, bookmarks) keep working.
        path: 'customer/login',
        lazy: async () => {
          const { CustomerLoginRedirect } = await import('@/pages/customer-login-redirect')
          return { Component: CustomerLoginRedirect }
        },
      },
      {
        path: 'customer/signup',
        lazy: async () => {
          const { CustomerSignupRedirect } = await import('@/pages/customer-login-redirect')
          return { Component: CustomerSignupRedirect }
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
          <RequireAuth loginPath="/login">
            <CustomerShell />
          </RequireAuth>
        ),
        children: [
          {
            index: true,
            lazy: async () => {
              const { CustomerDiscoverPage } = await import('@/pages/customer/discover-page')
              return { Component: CustomerDiscoverPage }
            },
          },
          {
            // Search is its own destination again. It shares `DiscoverySearch`
            // with the public `/search`, so there is still exactly one search
            // implementation — what differs is the shell around it.
            path: 'search',
            lazy: async () => {
              const { CustomerSearchPage } = await import('@/pages/customer/search-page')
              return { Component: CustomerSearchPage }
            },
          },
          {
            path: 'onboarding',
            lazy: async () => {
              const { CustomerOnboardingPage } = await import('@/pages/customer-onboarding-page')
              return { Component: CustomerOnboardingPage }
            },
          },
          {
            path: 'profile',
            lazy: async () => {
              const { CustomerProfilePage } = await import('@/pages/customer-profile-page')
              return { Component: CustomerProfilePage }
            },
          },
          {
            path: 'appointments',
            lazy: async () => {
              const { CustomerAppointmentsPage } = await import('@/pages/customer-appointments-page')
              return { Component: CustomerAppointmentsPage }
            },
          },
          {
            path: 'favorites',
            lazy: async () => {
              const { CustomerFavoritesPage } = await import('@/pages/customer-favorites-page')
              return { Component: CustomerFavoritesPage }
            },
          },
          {
            path: 'passport',
            lazy: async () => {
              const { CustomerPassportPage } = await import('@/pages/customer-passport-page')
              return { Component: CustomerPassportPage }
            },
          },
        ],
      },
      {
        /*
          R5R GREENFIELD PREVIEW — not the canonical customer product.

          The rebuilt customer shell and Home mount here, beside `/app/customer`
          rather than over it, until the product owner approves the visual
          direction. CLAUDE.md's legacy-safety rule is explicit that a working
          surface is not removed before its replacement is verified, and
          GREENFIELD_RULES.md §14 is explicit that a green test suite is not
          that verification.

          Deliberately NOT wrapped in RequireAuth: Home reads
          `search_public_professionals`, which `anon` may execute, and gating a
          public marketplace behind a login would also make the surface
          unreviewable in a browser — the R5R.0 audit lost every one of its
          `/app/customer` probes to exactly that redirect. Auth-dependent parts
          degrade instead: the notification count queries nothing without a user.

          Every page inside sets `noIndex`, so a preview never becomes
          indexable content. See src/customer-v2/routes.ts for the paths.
        */
        path: V2_ROUTE_PATH,
        lazy: async () => {
          const { CustomerV2Shell } = await import('@/customer-v2/shell/customer-v2-shell')
          return { Component: CustomerV2Shell }
        },
        children: [
          {
            index: true,
            lazy: async () => {
              const { CustomerV2HomePage } = await import('@/customer-v2/home/home-page')
              return { Component: CustomerV2HomePage }
            },
          },
          {
            path: 'marketplace',
            lazy: async () => {
              const { CustomerV2MarketplacePage } = await import(
                '@/customer-v2/marketplace/marketplace-page'
              )
              return { Component: CustomerV2MarketplacePage }
            },
          },
          {
            path: 's/:slug',
            lazy: async () => {
              const { CustomerV2ShopProfilePage } = await import(
                '@/customer-v2/profiles/shop-profile-page'
              )
              return { Component: CustomerV2ShopProfilePage }
            },
          },
          {
            path: 's/:slug/book',
            lazy: async () => {
              const { CustomerV2BookingPage } = await import('@/customer-v2/booking/booking-page')
              return { Component: CustomerV2BookingPage }
            },
          },
          {
            path: 's/:slug/b/:barberId',
            lazy: async () => {
              const { CustomerV2BarberProfilePage } = await import(
                '@/customer-v2/profiles/barber-profile-page'
              )
              return { Component: CustomerV2BarberProfilePage }
            },
          },
          {
            path: 'book',
            lazy: async () => {
              const { V2PlaceholderPage } = await import('@/customer-v2/pages/v2-placeholder-page')
              return { Component: () => <V2PlaceholderPage surface="book" lot="R5R.1E" /> }
            },
          },
          {
            path: 'appointments',
            lazy: async () => {
              const { V2PlaceholderPage } = await import('@/customer-v2/pages/v2-placeholder-page')
              return { Component: () => <V2PlaceholderPage surface="appointments" lot="R5R.1F" /> }
            },
          },
          {
            path: 'profile',
            lazy: async () => {
              const { V2PlaceholderPage } = await import('@/customer-v2/pages/v2-placeholder-page')
              return { Component: () => <V2PlaceholderPage surface="profile" lot="R5R.1H" /> }
            },
          },
        ],
      },
      {
        // Public, unauthenticated read-only view of a shared Fade Passport.
        // The token in the URL is itself the authorization (verified
        // server-side by hash — see get_shared_passport); the page sets
        // noindex so a live share never becomes indexable content.
        path: 'passport/shared/:token',
        lazy: async () => {
          const { PassportShareViewPage } = await import('@/pages/passport-share-view-page')
          return { Component: PassportShareViewPage }
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
            path: 'applications',
            lazy: async () => {
              const { PlatformApplicationsPage } = await import('@/pages/platform-applications-page')
              return { Component: PlatformApplicationsPage }
            },
          },
          {
            path: 'applications/:applicationId',
            lazy: async () => {
              const { PlatformApplicationDetailPage } = await import('@/pages/platform-application-detail-page')
              return { Component: PlatformApplicationDetailPage }
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
            path: 'acquisition',
            lazy: async () => {
              const { PlatformAcquisitionLayout } = await import('@/routes/platform-acquisition-layout')
              return { Component: PlatformAcquisitionLayout }
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { PlatformAcquisitionOverviewPage } = await import('@/pages/platform-acquisition-overview-page')
                  return { Component: PlatformAcquisitionOverviewPage }
                },
              },
              {
                path: 'search',
                lazy: async () => {
                  const { PlatformAcquisitionSearchPage } = await import('@/pages/platform-acquisition-search-page')
                  return { Component: PlatformAcquisitionSearchPage }
                },
              },
              {
                path: 'map',
                lazy: async () => {
                  const { PlatformAcquisitionMapPage } = await import('@/pages/platform-acquisition-map-page')
                  return { Component: PlatformAcquisitionMapPage }
                },
              },
              {
                path: 'prospects',
                lazy: async () => {
                  const { PlatformAcquisitionProspectsPage } = await import('@/pages/platform-acquisition-prospects-page')
                  return { Component: PlatformAcquisitionProspectsPage }
                },
              },
              {
                path: 'prospects/:prospectId',
                lazy: async () => {
                  const { PlatformAcquisitionProspectDetailPage } = await import('@/pages/platform-acquisition-prospect-detail-page')
                  return { Component: PlatformAcquisitionProspectDetailPage }
                },
              },
              {
                path: 'competitors',
                lazy: async () => {
                  const { PlatformAcquisitionCompetitorsPage } = await import('@/pages/platform-acquisition-competitors-page')
                  return { Component: PlatformAcquisitionCompetitorsPage }
                },
              },
              {
                path: 'barbershops',
                lazy: async () => {
                  const { PlatformAcquisitionBarbershopsPage } = await import('@/pages/platform-acquisition-barbershops-page')
                  return { Component: PlatformAcquisitionBarbershopsPage }
                },
              },
              {
                path: 'independent-barbers',
                lazy: async () => {
                  const { PlatformAcquisitionIndependentBarbersPage } = await import('@/pages/platform-acquisition-independent-barbers-page')
                  return { Component: PlatformAcquisitionIndependentBarbersPage }
                },
              },
              {
                path: 'jobs',
                lazy: async () => {
                  const { PlatformAcquisitionJobsPage } = await import('@/pages/platform-acquisition-jobs-page')
                  return { Component: PlatformAcquisitionJobsPage }
                },
              },
              {
                path: 'sources',
                lazy: async () => {
                  const { PlatformAcquisitionSourcesPage } = await import('@/pages/platform-acquisition-sources-page')
                  return { Component: PlatformAcquisitionSourcesPage }
                },
              },
              {
                path: 'api-usage',
                lazy: async () => {
                  const { PlatformAcquisitionApiUsagePage } = await import('@/pages/platform-acquisition-api-usage-page')
                  return { Component: PlatformAcquisitionApiUsagePage }
                },
              },
              {
                path: 'duplicates',
                lazy: async () => {
                  const { PlatformAcquisitionDuplicatesPage } = await import('@/pages/platform-acquisition-duplicates-page')
                  return { Component: PlatformAcquisitionDuplicatesPage }
                },
              },
              {
                path: 'publication',
                lazy: async () => {
                  const { PlatformAcquisitionPublicationPage } = await import('@/pages/platform-acquisition-publication-page')
                  return { Component: PlatformAcquisitionPublicationPage }
                },
              },
              {
                path: 'claims',
                lazy: async () => {
                  const { PlatformAcquisitionClaimsPage } = await import('@/pages/platform-acquisition-claims-page')
                  return { Component: PlatformAcquisitionClaimsPage }
                },
              },
              {
                path: 'pipeline',
                lazy: async () => {
                  const { PlatformAcquisitionPipelinePage } = await import('@/pages/platform-acquisition-pipeline-page')
                  return { Component: PlatformAcquisitionPipelinePage }
                },
              },
              {
                path: 'suppressions',
                lazy: async () => {
                  const { PlatformAcquisitionSuppressionsPage } = await import('@/pages/platform-acquisition-suppressions-page')
                  return { Component: PlatformAcquisitionSuppressionsPage }
                },
              },
            ],
          },
          {
            path: 'outreach',
            lazy: async () => {
              const { PlatformOutreachLayout } = await import('@/routes/platform-outreach-layout')
              return { Component: PlatformOutreachLayout }
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { PlatformOutreachCampaignsPage } = await import('@/pages/platform-outreach-campaigns-page')
                  return { Component: PlatformOutreachCampaignsPage }
                },
              },
              {
                path: 'whatsapp',
                lazy: async () => {
                  const { PlatformOutreachCampaignsPage } = await import('@/pages/platform-outreach-campaigns-page')
                  return { Component: PlatformOutreachCampaignsPage }
                },
              },
              {
                path: 'whatsapp/:campaignId',
                lazy: async () => {
                  const { PlatformOutreachCampaignDetailPage } = await import('@/pages/platform-outreach-campaign-detail-page')
                  return { Component: PlatformOutreachCampaignDetailPage }
                },
              },
              {
                path: 'templates',
                lazy: async () => {
                  const { PlatformOutreachTemplatesPage } = await import('@/pages/platform-outreach-templates-page')
                  return { Component: PlatformOutreachTemplatesPage }
                },
              },
              {
                path: 'experiments',
                lazy: async () => {
                  const { PlatformDataScienceExperimentsPage } = await import('@/pages/platform-data-science-experiments-page')
                  return { Component: PlatformDataScienceExperimentsPage }
                },
              },
              {
                path: 'replies',
                lazy: async () => {
                  const { PlatformOutreachRepliesPage } = await import('@/pages/platform-outreach-replies-page')
                  return { Component: PlatformOutreachRepliesPage }
                },
              },
            ],
          },
          {
            path: 'data-science',
            lazy: async () => {
              const { PlatformDataScienceLayout } = await import('@/routes/platform-data-science-layout')
              return { Component: PlatformDataScienceLayout }
            },
            children: [
              {
                index: true,
                lazy: async () => {
                  const { PlatformDataScienceModelsPage } = await import('@/pages/platform-data-science-models-page')
                  return { Component: PlatformDataScienceModelsPage }
                },
              },
              {
                path: 'dataset',
                lazy: async () => {
                  const { PlatformDataScienceDatasetPage } = await import('@/pages/platform-data-science-dataset-page')
                  return { Component: PlatformDataScienceDatasetPage }
                },
              },
              {
                path: 'performance',
                lazy: async () => {
                  const { PlatformDataSciencePerformancePage } = await import('@/pages/platform-data-science-performance-page')
                  return { Component: PlatformDataSciencePerformancePage }
                },
              },
            ],
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
            path: 'profile',
            lazy: async () => {
              const { ShopProfilePage } = await import('@/pages/shop-profile-page')
              return { Component: ShopProfilePage }
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
            <RequireProAccess>
              <ProShell />
            </RequireProAccess>
          </RequireAuth>
        ),
        children: [
          {
            index: true,
            lazy: async () => {
              const { ProDashboardPage } = await import('@/pages/pro/dashboard-page')
              return { Component: ProDashboardPage }
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
            // The booking inbox. Its own route rather than a tab on the
            // schedule: the schedule is scoped to one day, and requests span
            // every future date and expire on their own clock.
            path: 'requests',
            lazy: async () => {
              const { AppRequestsPage } = await import('@/pages/app-requests-page')
              return { Component: AppRequestsPage }
            },
          },
          {
            // The calendar. Separate from 'appointments', which is the
            // table-and-booking-form view: one is for READING a day or a week,
            // the other for entering a booking by hand. Collapsing them would
            // make both worse.
            path: 'calendar',
            lazy: async () => {
              const { AppCalendarPage } = await import('@/pages/app-calendar-page')
              return { Component: AppCalendarPage }
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
