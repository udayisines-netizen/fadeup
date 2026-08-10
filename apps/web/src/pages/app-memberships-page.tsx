import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useAuth } from '@/lib/auth-context'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgCustomers, type Customer } from '@/lib/queries/customers'
import {
  useCreateMembershipPlan,
  useOrgMembershipPlans,
  useUpdateMembershipPlan,
  type BillingInterval,
  type MembershipPlan,
} from '@/lib/queries/membership-plans'
import {
  useEnrollCustomerMembership,
  useOrgCustomerMemberships,
  useUpdateCustomerMembershipStatus,
  type CustomerMembership,
  type CustomerMembershipStatus,
} from '@/lib/queries/customer-memberships'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useToast } from '@/components/ui/toast'
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'

// Plan management (pricing) is owner/manager only, matching membership_plans
// RLS — narrower than enrollment, which is owner/manager/receptionist,
// matching customer_memberships RLS (front-of-house work).
const PLAN_MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])
const ENROLLMENT_MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

const BILLING_INTERVAL_LABELS: Record<BillingInterval, string> = {
  weekly: '/ week',
  monthly: '/ month',
  yearly: '/ year',
}

const STATUS_LABELS: Record<CustomerMembershipStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  cancelled: 'Cancelled',
  expired: 'Expired',
}

const STATUS_BADGE_VARIANT: Record<CustomerMembershipStatus, BadgeVariant> = {
  active: 'success',
  paused: 'warning',
  cancelled: 'neutral',
  expired: 'neutral',
}

/** Valid staff-initiated status targets — a cancelled/expired membership isn't reactivated in place, a new enrollment is created instead. */
const STATUS_TRANSITIONS: CustomerMembershipStatus[] = ['active', 'paused', 'cancelled', 'expired']

/** `customer_memberships_one_open_per_customer` rejects a second concurrent active/paused enrollment — same friendly-error pattern used throughout this app. */
function friendlyMembershipError(rawMessage: string): string {
  if (rawMessage.includes('customer_memberships_one_open_per_customer')) {
    return 'This customer already has an active or paused membership. Cancel it first, or edit it directly below.'
  }
  return rawMessage
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

export function AppMembershipsPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <MembershipsManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function MembershipsManagement({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const { user } = useAuth()
  const canManagePlans = PLAN_MANAGING_ROLES.has(role)
  const canManageEnrollments = ENROLLMENT_MANAGING_ROLES.has(role)

  const [isPlanDialogOpen, setIsPlanDialogOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<MembershipPlan | null>(null)
  const [isEnrollOpen, setIsEnrollOpen] = useState(false)

  const plansQuery = useOrgMembershipPlans(organizationId)
  const customersQuery = useOrgCustomers(organizationId)
  const enrollmentsQuery = useOrgCustomerMemberships(organizationId)

  const isLoading = plansQuery.isPending || customersQuery.isPending || enrollmentsQuery.isPending
  const loadError = plansQuery.error ?? customersQuery.error ?? enrollmentsQuery.error
  const isError = plansQuery.isError || customersQuery.isError || enrollmentsQuery.isError

  function refetchAll() {
    void plansQuery.refetch()
    void customersQuery.refetch()
    void enrollmentsQuery.refetch()
  }

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>()
    for (const customer of customersQuery.data ?? []) map.set(customer.id, customer)
    return map
  }, [customersQuery.data])

  const planById = useMemo(() => {
    const map = new Map<string, MembershipPlan>()
    for (const plan of plansQuery.data ?? []) map.set(plan.id, plan)
    return map
  }, [plansQuery.data])

  return (
    <Container size="lg" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Memberships</h1>
        <p className="mt-1 text-sm text-ink-500">Recurring plans and who&apos;s enrolled.</p>
      </div>

      {isLoading ? (
        <div className="mt-6">
          <MembershipsSkeleton />
        </div>
      ) : isError ? (
        <div className="mt-6">
          <ErrorState
            title="Couldn't load memberships"
            description={loadError?.message}
            action={
              <Button variant="secondary" onClick={refetchAll}>
                Try again
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Plans</h2>
              {canManagePlans ? (
                <Button size="sm" onClick={() => setIsPlanDialogOpen(true)}>
                  New plan
                </Button>
              ) : null}
            </div>
            <div className="mt-3">
              {(plansQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No plans yet"
                  description="Create a recurring plan customers can enroll in."
                  action={canManagePlans ? <Button onClick={() => setIsPlanDialogOpen(true)}>New plan</Button> : undefined}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {(plansQuery.data ?? []).map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      disabled={!canManagePlans}
                      onClick={() => canManagePlans && setEditingPlan(plan)}
                      className="flex flex-col gap-1 rounded-lg border border-border bg-paper-0 p-4 text-left disabled:cursor-default enabled:hover:border-accent-600"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-ink-950">{plan.name}</span>
                        {!plan.isActive ? <Badge variant="neutral">Inactive</Badge> : null}
                      </div>
                      <span className="text-sm text-ink-500">
                        {formatPrice(plan.priceCents)} {BILLING_INTERVAL_LABELS[plan.billingInterval]}
                      </span>
                      {plan.description ? <span className="mt-1 text-sm text-ink-700">{plan.description}</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Members</h2>
              {canManageEnrollments && (plansQuery.data ?? []).length > 0 ? (
                <Button size="sm" onClick={() => setIsEnrollOpen(true)}>
                  Enroll customer
                </Button>
              ) : null}
            </div>
            <div className="mt-3">
              {(enrollmentsQuery.data ?? []).length === 0 ? (
                <EmptyState
                  title="No one enrolled yet"
                  description={
                    (plansQuery.data ?? []).length === 0
                      ? 'Create a plan first, then enroll a customer.'
                      : 'Enroll a customer in a plan to see them here.'
                  }
                />
              ) : (
                <Table label="Enrolled customers">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Current period ends</TableHead>
                      <TableHead>Status</TableHead>
                      {canManageEnrollments ? (
                        <TableHead>
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(enrollmentsQuery.data ?? []).map((enrollment) => (
                      <EnrollmentRow
                        key={enrollment.id}
                        enrollment={enrollment}
                        canManage={canManageEnrollments}
                        customerName={customerById.get(enrollment.customerId)?.name ?? 'Unknown customer'}
                        planName={planById.get(enrollment.planId)?.name ?? 'Unknown plan'}
                      />
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </section>
        </div>
      )}

      {isPlanDialogOpen || editingPlan ? (
        <PlanFormDialog
          organizationId={organizationId}
          plan={editingPlan ?? undefined}
          onClose={() => {
            setIsPlanDialogOpen(false)
            setEditingPlan(null)
          }}
          onSaved={() => {
            toast({ title: editingPlan ? 'Plan updated' : 'Plan created', variant: 'success' })
            setIsPlanDialogOpen(false)
            setEditingPlan(null)
          }}
        />
      ) : null}

      {isEnrollOpen ? (
        <EnrollDialog
          organizationId={organizationId}
          customers={customersQuery.data ?? []}
          plans={(plansQuery.data ?? []).filter((plan) => plan.isActive)}
          createdBy={user?.id ?? null}
          onClose={() => setIsEnrollOpen(false)}
          onEnrolled={() => {
            toast({ title: 'Customer enrolled', variant: 'success' })
            setIsEnrollOpen(false)
          }}
        />
      ) : null}
    </Container>
  )
}

// --- Enrollment row -----------------------------------------------------------

function EnrollmentRow({
  enrollment,
  canManage,
  customerName,
  planName,
}: {
  enrollment: CustomerMembership
  canManage: boolean
  customerName: string
  planName: string
}) {
  const { toast } = useToast()
  const updateStatus = useUpdateCustomerMembershipStatus()

  function handleStatusChange(status: CustomerMembershipStatus) {
    updateStatus.mutate(
      { id: enrollment.id, organizationId: enrollment.organizationId, status },
      {
        onSuccess: () => toast({ title: `Marked ${STATUS_LABELS[status].toLowerCase()}`, variant: 'success' }),
        onError: (error) =>
          toast({
            title: "Couldn't update status",
            description: getErrorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <TableRow>
      <TableCell className="font-medium text-ink-950">{customerName}</TableCell>
      <TableCell className="text-ink-500">{planName}</TableCell>
      <TableCell className="text-ink-500">{formatDate(enrollment.currentPeriodEnd)}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[enrollment.status]}>{STATUS_LABELS[enrollment.status]}</Badge>
      </TableCell>
      {canManage ? (
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary" size="sm" isLoading={updateStatus.isPending}>
                Update status
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_TRANSITIONS.filter((status) => status !== enrollment.status).map((status) => (
                <DropdownMenuItem
                  key={status}
                  variant={status === 'cancelled' || status === 'expired' ? 'danger' : 'default'}
                  onSelect={() => handleStatusChange(status)}
                >
                  Mark {STATUS_LABELS[status].toLowerCase()}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      ) : null}
    </TableRow>
  )
}

// --- Plan form dialog ---------------------------------------------------------

const planSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string(),
  priceDollars: z.string().min(1, 'Price is required'),
  billingInterval: z.enum(['weekly', 'monthly', 'yearly']),
  isActive: z.boolean(),
})

type PlanFormValues = z.infer<typeof planSchema>

const BILLING_INTERVAL_OPTIONS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

function PlanFormDialog({
  organizationId,
  plan,
  onClose,
  onSaved,
}: {
  organizationId: string
  plan?: MembershipPlan
  onClose: () => void
  onSaved: () => void
}) {
  const createPlan = useCreateMembershipPlan()
  const updatePlan = useUpdateMembershipPlan()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      name: plan?.name ?? '',
      description: plan?.description ?? '',
      priceDollars: plan ? (plan.priceCents / 100).toFixed(2) : '',
      billingInterval: plan?.billingInterval ?? 'monthly',
      isActive: plan?.isActive ?? true,
    },
  })

  async function onSubmit(values: PlanFormValues) {
    setFormError(null)
    const priceCents = Math.round(Number.parseFloat(values.priceDollars) * 100)
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setFormError('Enter a valid price.')
      return
    }
    const payload = {
      organizationId,
      name: values.name.trim(),
      description: values.description.trim() || null,
      priceCents,
      billingInterval: values.billingInterval,
      isActive: values.isActive,
    }
    try {
      if (plan) {
        await updatePlan.mutateAsync({ id: plan.id, ...payload })
      } else {
        await createPlan.mutateAsync(payload)
      }
      onSaved()
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{plan ? 'Edit plan' : 'New plan'}</DialogTitle>
          <DialogDescription>
            {plan ? `Update ${plan.name}.` : 'Create a recurring plan customers can enroll in.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <TextField label="Name" hint='e.g. "Unlimited Fades Monthly"' error={errors.name?.message} {...register('name')} />
          <Textarea label="Description (optional)" rows={2} {...register('description')} />
          <div className="grid grid-cols-2 gap-4">
            <TextField
              label="Price"
              inputMode="decimal"
              hint="In dollars"
              error={errors.priceDollars?.message}
              {...register('priceDollars')}
            />
            <SelectField label="Billing interval" options={BILLING_INTERVAL_OPTIONS} {...register('billingInterval')} />
          </div>
          <Switch label="Active" description="Inactive plans are hidden from new enrollment." {...register('isActive')} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {plan ? 'Save changes' : 'Create plan'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Enroll dialog -------------------------------------------------------------

const enrollSchema = z.object({
  customerId: z.string().min(1, 'Select a customer'),
  planId: z.string().min(1, 'Select a plan'),
  notes: z.string(),
})

type EnrollFormValues = z.infer<typeof enrollSchema>

function addInterval(billingInterval: BillingInterval): string {
  const now = new Date()
  if (billingInterval === 'weekly') now.setDate(now.getDate() + 7)
  else if (billingInterval === 'yearly') now.setFullYear(now.getFullYear() + 1)
  else now.setMonth(now.getMonth() + 1)
  return now.toISOString()
}

function EnrollDialog({
  organizationId,
  customers,
  plans,
  createdBy,
  onClose,
  onEnrolled,
}: {
  organizationId: string
  customers: Customer[]
  plans: MembershipPlan[]
  createdBy: string | null
  onClose: () => void
  onEnrolled: () => void
}) {
  const enroll = useEnrollCustomerMembership()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<EnrollFormValues>({
    resolver: zodResolver(enrollSchema),
    defaultValues: { customerId: '', planId: '', notes: '' },
  })

  const customerOptions = [
    { value: '', label: customers.length > 0 ? 'Select a customer' : 'No customers yet' },
    ...customers.map((customer) => ({ value: customer.id, label: customer.phone ? `${customer.name} · ${customer.phone}` : customer.name })),
  ]

  const planOptions = [
    { value: '', label: plans.length > 0 ? 'Select a plan' : 'No active plans' },
    ...plans.map((plan) => ({ value: plan.id, label: plan.name })),
  ]

  async function onSubmit(values: EnrollFormValues) {
    setFormError(null)
    const plan = plans.find((p) => p.id === values.planId)
    if (!plan) {
      setFormError('Select a plan.')
      return
    }
    try {
      await enroll.mutateAsync({
        organizationId,
        customerId: values.customerId,
        planId: values.planId,
        currentPeriodEnd: addInterval(plan.billingInterval),
        notes: values.notes.trim() || null,
        createdBy,
      })
      onEnrolled()
    } catch (error) {
      const rawMessage = getErrorMessage(error) ?? 'Something went wrong.'
      setFormError(friendlyMembershipError(rawMessage))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enroll customer</DialogTitle>
          <DialogDescription>Start a customer on a recurring plan.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <SelectField label="Customer" options={customerOptions} error={errors.customerId?.message} {...register('customerId')} />
          <SelectField label="Plan" options={planOptions} error={errors.planId?.message} {...register('planId')} />
          <Textarea label="Notes (optional)" rows={2} {...register('notes')} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              Enroll
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MembershipsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
