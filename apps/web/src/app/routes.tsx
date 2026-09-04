import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from '@/routes/root-layout'
import { PlatformLayout } from '@/routes/platform-layout'
import { RouteErrorBoundary } from '@/routes/route-error-boundary'
import { ConsumerShell } from '@/app/shells/ConsumerShell'
import { RequireAuth } from '@/app/guards/RequireAuth'
import { RequirePro } from '@/app/guards/RequirePro'
import { RequireDemo } from '@/app/guards/RequireDemo'
import { NotBuiltPage, NotFoundPage } from '@/app/NotBuiltPage'

/**
 * ============================================================================
 * LA table de routes V2 (P1b §7)
 * ============================================================================
 *
 * | Chemin        | Shell     | Garde              | Lot   |
 * |---------------|-----------|--------------------|-------|
 * | /             | Consumer  | —                  | P2    |
 * | /search       | Consumer  | —                  | P2    |
 * | /feed         | Consumer  | —                  | P4    |
 * | /pro/:handle  | Consumer  | —                  | P2    |
 * | /shop/:slug   | Consumer  | —                  | P2    |
 * | /bookings     | Consumer  | auth               | P2    |
 * | /account/*    | Consumer  | auth               | P2    |
 * | /auth/*       | aucun     | —                  | P1b   |
 * | /business     | Marketing | —                  | P4    |
 * | /dashboard/*  | Pro       | auth + pro         | P3    |
 * | /platform/*   | legacy    | interne (legacy)   | EXISTANT, INTOUCHÉ |
 * | /demo/*       | selon     | VITE_ENABLE_DEMO   | coquille P1b, rempli P1c |
 * | /dev/ui       | aucun     | import.meta.env.DEV| P1b   |
 *
 * ARBITRAGE DE CHEMIN : `/pro/:handle` est le profil PUBLIC consumer d'un
 * barber ; l'OS professionnel vit sous `/dashboard`. Rien dans l'existant
 * n'utilisait `/pro` (tout hors /platform résolvait sur le placeholder de
 * purge), le conflit est donc résolu sans migration.
 *
 * La branche /platform/** ci-dessous est la COPIE VERBATIM du routeur de
 * production (src/routes/router.tsx) : mêmes chemins, mêmes layouts, mêmes
 * pages legacy, mêmes gardes. Aucun composant /platform n'est modifié.
 */

const platformRoutes = [
  {
    path: 'platform/login',
    lazy: async () => {
      const { PlatformLoginPage } = await import('@/pages/platform-login-page')
      return { Component: PlatformLoginPage }
    },
  },
  {
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
]

/* Écrans d'auth — chargés paresseusement (hors du chunk d'entrée). */
const authRoutes = {
  path: 'auth',
  children: [
    {
      path: 'login',
      lazy: async () => {
        const { LoginPage } = await import('@/features/auth/routes/LoginPage')
        return { Component: LoginPage }
      },
    },
    {
      path: 'signup',
      lazy: async () => {
        const { SignupPage } = await import('@/features/auth/routes/SignupPage')
        return { Component: SignupPage }
      },
    },
    {
      path: 'magic',
      lazy: async () => {
        const { MagicPage } = await import('@/features/auth/routes/MagicPage')
        return { Component: MagicPage }
      },
    },
    {
      path: 'otp',
      lazy: async () => {
        const { OtpPage } = await import('@/features/auth/routes/OtpPage')
        return { Component: OtpPage }
      },
    },
    {
      path: 'forgot',
      lazy: async () => {
        const { ForgotPage } = await import('@/features/auth/routes/ForgotPage')
        return { Component: ForgotPage }
      },
    },
    {
      path: 'reset',
      lazy: async () => {
        const { ResetPage } = await import('@/features/auth/routes/ResetPage')
        return { Component: ResetPage }
      },
    },
    {
      path: 'callback',
      lazy: async () => {
        const { CallbackPage } = await import('@/features/auth/routes/CallbackPage')
        return { Component: CallbackPage }
      },
    },
  ],
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      ...platformRoutes,

      authRoutes,

      /* Surface consumer — cinq onglets ; toute route non construite rend un
         EmptyState traduit qui nomme son lot. */
      {
        element: <ConsumerShell />,
        children: [
          { index: true, element: <NotBuiltPage zone="home" /> },
          { path: 'search', element: <NotBuiltPage zone="search" /> },
          { path: 'feed', element: <NotBuiltPage zone="feed" /> },
          { path: 'pro/:handle', element: <NotBuiltPage zone="proProfile" /> },
          { path: 'shop/:slug', element: <NotBuiltPage zone="proProfile" /> },
          {
            element: <RequireAuth />,
            children: [
              { path: 'bookings', element: <NotBuiltPage zone="bookings" /> },
              { path: 'account/*', element: <NotBuiltPage zone="account" /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },

      /* Marketing — sombre éditorial (P4). */
      {
        path: 'business',
        lazy: async () => {
          const { MarketingShell } = await import('@/app/shells/MarketingShell')
          return { Component: MarketingShell }
        },
        children: [{ index: true, element: <NotBuiltPage zone="business" /> }],
      },

      /* Pro OS — auth + pro ; les entrées du menu se conditionnent aux
         entitlements dans le shell lui-même. */
      {
        element: <RequireAuth />,
        children: [
          {
            element: <RequirePro />,
            children: [
              {
                path: 'dashboard',
                lazy: async () => {
                  const mod = await import('@/app/shells/ProShell')
                  return { Component: mod.default }
                },
                children: [
                  { index: true, element: <NotBuiltPage zone="dashboard" /> },
                  { path: '*', element: <NotBuiltPage zone="dashboard" /> },
                ],
              },
            ],
          },
        ],
      },

      /* /demo — drapeau + noindex ; les trois études réelles de P1c. */
      {
        path: 'demo',
        element: <RequireDemo />,
        children: [
          {
            index: true,
            lazy: async () => {
              const { DemoIndexPage } = await import('@/features/demo/DemoIndexPage')
              return { Component: DemoIndexPage }
            },
          },
          {
            path: 'discovery',
            lazy: async () => {
              const { DemoDiscoveryPage } = await import('@/features/demo/DemoDiscoveryPage')
              return { Component: DemoDiscoveryPage }
            },
          },
          {
            path: 'profile',
            lazy: async () => {
              const { DemoProfilePage } = await import('@/features/demo/DemoProfilePage')
              return { Component: DemoProfilePage }
            },
          },
          {
            path: 'pro',
            lazy: async () => {
              const { DemoProPage } = await import('@/features/demo/DemoProPage')
              return { Component: DemoProPage }
            },
          },
        ],
      },

      /* /dev/ui — galerie de primitives, ÉLIMINÉE du build de production. */
      ...(import.meta.env.DEV
        ? [
            {
              path: 'dev/ui',
              lazy: async () => {
                const { DevUiPage } = await import('@/features/dev-ui/DevUiPage')
                return { Component: DevUiPage }
              },
            },
          ]
        : []),
    ],
  },
])
