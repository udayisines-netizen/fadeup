import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useCreateProspectSuppression, useProspectSuppressions } from '@/lib/queries/acquisition/suppressions'
import { useProspectsByIds } from '@/lib/queries/acquisition/prospects'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Alert } from '@/components/ui/alert'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { getErrorMessage } from '@/lib/get-error-message'
import { usePlatformRole } from '@/routes/require-platform-role'
import { PROSPECT_SUPPRESSION_SCOPES } from '@/lib/queries/acquisition/types'

const WRITE_ROLES = new Set(['platform_owner', 'platform_admin'])

const SCOPE_LABELS: Record<string, string> = {
  prospect: 'Specific prospect',
  phone: 'Phone number',
  email: 'Email address',
  domain: 'Website domain',
  instagram_handle: 'Instagram handle',
}

/** /platform/acquisition/suppressions — the global Do Not Contact list (prospect_suppressions). Direct INSERT, no RPC — see the schema migration's RLS notes. */
export function PlatformAcquisitionSuppressionsPage() {
  const role = usePlatformRole()
  const canManage = WRITE_ROLES.has(role)
  const suppressionsQuery = useProspectSuppressions()
  const [isAddOpen, setIsAddOpen] = useState(false)

  const prospectIds = useMemo(
    () => [...new Set((suppressionsQuery.data ?? []).map((s) => s.prospectId).filter((id): id is string => Boolean(id)))],
    [suppressionsQuery.data],
  )
  const prospectsQuery = useProspectsByIds(prospectIds)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        {canManage ? <Button onClick={() => setIsAddOpen(true)}>Add suppression</Button> : null}
      </div>

      {suppressionsQuery.isPending ? (
        <SuppressionsSkeleton />
      ) : suppressionsQuery.isError ? (
        <ErrorState title="Couldn't load suppressions" description={suppressionsQuery.error.message} />
      ) : suppressionsQuery.data.length === 0 ? (
        <EmptyState
          title="No suppressions yet"
          description="Prospects, phone numbers, emails, domains, or Instagram handles added here are never re-selected for outreach."
          action={canManage ? <Button onClick={() => setIsAddOpen(true)}>Add suppression</Button> : undefined}
        />
      ) : (
        <Table label="Suppressions">
          <TableHeader>
            <TableRow>
              <TableHead>Scope</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Added</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {suppressionsQuery.data.length === 0 ? (
              <TableStateRow colSpan={4}>
                <EmptyState title="No suppressions yet" className="border-none" />
              </TableStateRow>
            ) : (
              suppressionsQuery.data.map((suppression) => {
                const prospect = suppression.prospectId ? prospectsQuery.data?.get(suppression.prospectId) : undefined
                return (
                  <TableRow key={suppression.id}>
                    <TableCell>
                      <Badge variant="neutral">{SCOPE_LABELS[suppression.scope] ?? suppression.scope}</Badge>
                    </TableCell>
                    <TableCell className="text-ink-800">
                      {suppression.scope === 'prospect' ? (
                        prospect ? (
                          <Link
                            to={`/platform/acquisition/prospects/${prospect.id}`}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {prospect.canonicalName}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs text-ink-400">{suppression.prospectId}</span>
                        )
                      ) : (
                        <span className="font-mono text-xs">{suppression.value}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[20rem] text-ink-500">{suppression.reason}</TableCell>
                    <TableCell className="whitespace-nowrap text-ink-500">{new Date(suppression.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      )}

      {isAddOpen ? <AddSuppressionDialog onClose={() => setIsAddOpen(false)} /> : null}
    </div>
  )
}

const suppressionSchema = z
  .object({
    scope: z.enum(['prospect', 'phone', 'email', 'domain', 'instagram_handle']),
    value: z.string(),
    reason: z.string().min(1, 'A reason is required'),
  })
  .refine((data) => data.scope !== 'prospect' || data.value.trim().length > 0, {
    message: 'Enter the prospect ID',
    path: ['value'],
  })
  .refine((data) => data.scope === 'prospect' || data.value.trim().length > 0, {
    message: 'Enter a value to suppress',
    path: ['value'],
  })

type SuppressionFormValues = z.infer<typeof suppressionSchema>

function AddSuppressionDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const createSuppression = useCreateProspectSuppression()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<SuppressionFormValues>({
    resolver: zodResolver(suppressionSchema),
    defaultValues: { scope: 'phone', value: '', reason: '' },
  })

  const scope = watch('scope')

  async function onSubmit(values: SuppressionFormValues) {
    setFormError(null)
    try {
      await createSuppression.mutateAsync({
        scope: values.scope,
        prospectId: values.scope === 'prospect' ? values.value.trim() : null,
        value: values.scope === 'prospect' ? null : values.value.trim(),
        reason: values.reason.trim(),
      })
      toast({ title: 'Suppression added', variant: 'success' })
      onClose()
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Failed to add suppression.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add suppression</DialogTitle>
          <DialogDescription>Prevents this prospect or identifier from ever being selected for outreach again.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <SelectField
            label="Scope"
            options={PROSPECT_SUPPRESSION_SCOPES.map((s) => ({ value: s, label: SCOPE_LABELS[s] ?? s }))}
            {...register('scope')}
          />
          {scope === 'prospect' ? (
            <TextField
              label="Prospect ID"
              hint="Copy the ID from the prospect's URL, or use 'Suppress this prospect' on their profile instead."
              error={errors.value?.message}
              {...register('value')}
            />
          ) : (
            <TextField
              label="Value"
              hint={scope === 'phone' ? 'E.164 format, e.g. +33612345678' : scope === 'email' ? 'name@example.com' : scope === 'domain' ? 'example.com' : '@handle'}
              error={errors.value?.message}
              {...register('value')}
            />
          )}
          <Textarea label="Reason" rows={3} error={errors.reason?.message} {...register('reason')} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting || createSuppression.isPending}>
              Add suppression
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function SuppressionsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
