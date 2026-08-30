/**
 * The greenfield professional preview lives beside the customer preview under
 * the same `_preview` umbrella — same reasoning as customer-v2/routes.ts: the
 * canonical `/app` professional product keeps working until a human approves
 * this direction, and paths are declared exactly once.
 */

const PRO_ROOT = '/_preview/r5r/pro'

export const PRO_V2_ROUTES = {
  root: PRO_ROOT,
  dashboard: PRO_ROOT,
  calendar: `${PRO_ROOT}/calendar`,
  customers: `${PRO_ROOT}/customers`,
  analytics: `${PRO_ROOT}/analytics`,
  retention: `${PRO_ROOT}/retention`,
  profile: `${PRO_ROOT}/profile`,
} as const

export const PRO_V2_ROUTE_PATH = PRO_ROOT.slice(1)
