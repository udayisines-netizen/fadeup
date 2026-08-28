import { useMemo, useState } from 'react'
import {
  useApproveOutreachTemplate,
  useOutreachTemplates,
  useSetOutreachTemplatePaused,
  useTemplatePerformance,
  type OutreachTemplate,
} from '@/lib/queries/acquisition/outreach'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert } from '@/components/ui/alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

const STATUS_VARIANT: Record<OutreachTemplate['status'], BadgeVariant> = {
  draft: 'neutral',
  pending_approval: 'warning',
  approved: 'success',
  paused: 'warning',
  retired: 'neutral',
}

/**
 * /platform/outreach/templates — the approved-copy library.
 *
 * Every outbound message FadeUp sends originates here. There is no
 * generate button and no model-written text anywhere in this screen: a
 * template is written by an administrator, approved by an administrator,
 * and rendered by pure variable substitution.
 */
export function PlatformOutreachTemplatesPage() {
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)
  const { toast } = useToast()

  const templatesQuery = useOutreachTemplates()
  const performanceQuery = useTemplatePerformance()
  const approve = useApproveOutreachTemplate()
  const setPaused = useSetOutreachTemplatePaused()

  const [expandedId, setExpandedId] = useState<string | null>(null)

  const performanceByTemplateId = useMemo(
    () => new Map((performanceQuery.data ?? []).map((row) => [row.templateId, row])),
    [performanceQuery.data],
  )

  /**
   * Locale coverage: which languages actually have approved copy. A
   * prospect whose locale has no approved template is BLOCKED rather than
   * sent the wrong language, so a gap here is an operational problem the
   * owner must see immediately.
   */
  const localeCoverage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const template of templatesQuery.data ?? []) {
      if (template.status !== 'approved') continue
      counts.set(template.locale, (counts.get(template.locale) ?? 0) + 1)
    }
    return counts
  }, [templatesQuery.data])

  async function handleApprove(template: OutreachTemplate) {
    try {
      await approve.mutateAsync(template.id)
      toast({ title: `${template.key} approved`, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't approve template", description: getErrorMessage(error), variant: 'error' })
    }
  }

  async function handleTogglePaused(template: OutreachTemplate) {
    const paused = template.status !== 'paused'
    try {
      await setPaused.mutateAsync({ templateId: template.id, paused })
      toast({ title: paused ? `${template.key} paused` : `${template.key} resumed`, variant: 'success' })
    } catch (error) {
      toast({ title: "Couldn't update template", description: getErrorMessage(error), variant: 'error' })
    }
  }

  if (templatesQuery.isPending) {
    return <Skeleton className="h-96 w-full" />
  }

  if (templatesQuery.isError) {
    return <ErrorState title="Couldn't load templates" description={templatesQuery.error?.message} />
  }

  return (
    <div className="flex flex-col gap-6">
      <Alert variant="info">
        <div className="text-sm">
          <p>
            <strong>Message copy is never generated.</strong> Every outbound message is rendered from one of these
            administrator-approved templates by substituting a fixed set of validated variables. No language model
            writes, rewrites, or edits any part of a message.
          </p>
          <p className="mt-1">
            Machine learning may only <em>choose between</em> templates that already match a prospect’s language,
            competitor and segment.
          </p>
        </div>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Language coverage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {['fr-FR', 'en-GB', 'en-US'].map((locale) => {
              const count = localeCoverage.get(locale) ?? 0
              return (
                <div key={locale} className="rounded-md border border-border px-3 py-2">
                  <p className="font-mono text-sm text-ink-950">{locale}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {count === 0 ? (
                      <span className="text-danger-700">No approved template — outreach blocked</span>
                    ) : (
                      `${count} approved template${count === 1 ? '' : 's'}`
                    )}
                  </p>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-xs text-ink-500">
            A prospect whose resolved locale has no approved template is blocked, never sent a message in another
            language.
          </p>
        </CardContent>
      </Card>

      {templatesQuery.data.length === 0 ? (
        <EmptyState
          title="No templates yet"
          description="Create approved WhatsApp copy before preparing a campaign. Until then, every recipient will be blocked with no_template_for_locale."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Templates</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table label="Outreach templates">
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Locale</TableHead>
                  <TableHead>Targeting</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Reply</TableHead>
                  <TableHead className="text-right">Positive</TableHead>
                  <TableHead className="text-right">Activated</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templatesQuery.data.map((template) => {
                  const performance = performanceByTemplateId.get(template.id)
                  const isExpanded = expandedId === template.id

                  return (
                    <>
                      <TableRow key={template.id}>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left font-mono text-sm text-ink-950 underline-offset-2 hover:underline"
                            onClick={() => setExpandedId(isExpanded ? null : template.id)}
                            aria-expanded={isExpanded}
                          >
                            {template.key}
                          </button>
                          <p className="mt-0.5 text-xs text-ink-500">{template.name}</p>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{template.locale}</TableCell>
                        <TableCell className="text-xs text-ink-700">
                          {template.salesAngle ? <div>{template.salesAngle}</div> : null}
                          {template.segmentKey ? <div className="text-ink-500">{template.segmentKey}</div> : null}
                          {!template.salesAngle && !template.segmentKey ? <span className="text-ink-500">generic</span> : null}
                        </TableCell>
                        <TableCell>
                          <Badge variant={STATUS_VARIANT[template.status]}>{template.status.replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{performance?.sent ?? 0}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <RateCell rate={performance?.replyRate ?? null} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <RateCell rate={performance?.positiveReplyRate ?? null} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <RateCell rate={performance?.activationRate ?? null} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          <RateCell rate={performance?.paidRate ?? null} />
                        </TableCell>
                        <TableCell>
                          {canManage ? (
                            <div className="flex gap-2">
                              {template.status !== 'approved' && template.status !== 'paused' ? (
                                <Button size="sm" variant="secondary" onClick={() => void handleApprove(template)}>
                                  Approve
                                </Button>
                              ) : null}
                              {template.status === 'approved' || template.status === 'paused' ? (
                                <Button size="sm" variant="ghost" onClick={() => void handleTogglePaused(template)}>
                                  {template.status === 'paused' ? 'Resume' : 'Pause'}
                                </Button>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-xs text-ink-500">read only</span>
                          )}
                        </TableCell>
                      </TableRow>

                      {isExpanded ? (
                        <TableRow key={`${template.id}-body`}>
                          <TableCell colSpan={10}>
                            <div className="flex flex-col gap-2 rounded-md bg-paper-100 p-3">
                              <p className="text-xs font-medium text-ink-700">Approved body</p>
                              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-ink-950">
                                {template.body}
                              </pre>
                              <p className="text-xs text-ink-500">
                                Allowed variables: {template.allowedVariables.join(', ') || 'none'}
                              </p>
                              {template.approvedAt ? (
                                <p className="text-xs text-ink-500">
                                  Approved {new Date(template.approvedAt).toLocaleString()}
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Alert variant="warning">
        <p className="text-sm">
          A high read rate is not a reason to promote a template. Compare templates on{' '}
          <strong>activation and paid rate</strong> — the columns on the right — not on delivery or read.
        </p>
      </Alert>
    </div>
  )
}

/** Renders a rate, or an em dash when nothing has been sent — an untested template is not a 0% template. */
function RateCell({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-ink-500">—</span>
  return <span>{(rate * 100).toFixed(1)}%</span>
}
