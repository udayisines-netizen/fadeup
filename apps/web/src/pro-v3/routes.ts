/**
 * V3 professional preview paths — mounted under the customer V3 namespace's
 * /pro segment (see customer-v3/routes.ts for the preview rationale).
 * Declared once; the shell, its navigation and the router all read from here.
 */
const PRO_ROOT = '/_preview/v3/pro'

export const PRO_V3_ROUTES = {
  dashboard: PRO_ROOT,
  calendar: `${PRO_ROOT}/calendar`,
  customers: `${PRO_ROOT}/customers`,
  analytics: `${PRO_ROOT}/analytics`,
  retention: `${PRO_ROOT}/retention`,
  profile: `${PRO_ROOT}/profile`,
} as const

export const PRO_V3_ROUTE_PATH = 'pro'
