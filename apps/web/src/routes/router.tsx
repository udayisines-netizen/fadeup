import { createBrowserRouter } from 'react-router-dom'
import { RootLayout } from '@/routes/root-layout'
import { PlatformLayout } from '@/routes/platform-layout'
import { RouteErrorBoundary } from '@/routes/route-error-boundary'
import { ResetPlaceholder } from '@/routes/reset-placeholder'

/**
 * ============================================================================
 * FRONTEND RESET — WHAT THIS ROUTER IS RIGHT NOW
 * ============================================================================
 *
 * The visible FadeUp web application was purged on 2026-09-01
 * (`docs/frontend/WEB_UI_PURGE_INVENTORY.md`). Every customer, professional,
 * public and marketing route now resolves to one neutral placeholder, and the
 * `/_preview/r5r` and `/_preview/v3` branches are gone entirely rather than
 * aliased, so no rejected preview product appears to still exist.
 *
 * What deliberately survives:
 *
 *  - `/platform/**` — the internal Worker V2 / operations console, which was
 *    never part of the rejected consumer or professional design direction and
 *    whose backend the purge brief preserves. Its routes are unchanged.
 *  - The whole non-visual engine behind both: auth/session, queries and
 *    mutations, realtime, pricing, i18n. It is temporarily under-used by the
 *    placeholder and is kept on purpose — the next frontend reconnects to
 *    these same contracts.
 *
 * A catch-all placeholder (rather than a 404) is intentional: during the reset
 * every product URL should say the product is being rebuilt, not that it does
 * not exist.
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <RootLayout />,
    /*
      Kept from before the purge: without it a render error anywhere below
      reaches React Router's built-in developer screen instead of FadeUp's
      own error surface. It also covers lazy chunks that fail to load.
    */
    errorElement: <RouteErrorBoundary />,
    children: [
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

      /*
        Everything else — `/`, `/login`, `/register`, `/app/**`, `/s/:slug**`,
        `/q/:slug`, `/w/:slug`, `/onboarding`, `/passport/shared/:token`, the
        former preview namespaces and any unknown path — is the reset
        placeholder until the new design exists.
      */
      { path: '*', element: <ResetPlaceholder /> },
    ],
  },
])
