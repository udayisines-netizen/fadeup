import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useCreateCustomer, useOrgCustomers, useUpdateCustomer, type Customer } from '@/lib/queries/customers'
import { useCustomerAppointments } from '@/lib/queries/appointments'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge, type BadgeVariant } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { AppointmentStatus } from '@/lib/queries/appointments'
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'

// Same broader role set as appointments/queue_entries — customers RLS
// grants owner/manager/receptionist write access, any member read.
const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager', 'receptionist'])

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

const STATUS_BADGE_VARIANT: Record<AppointmentStatus, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'info',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
}

/**
 * `customers` rows created via the partial unique indexes on
 * (organization_id, phone) / (organization_id, lower(email)) reject a raw
 * duplicate insert or update — see db/migrations/20260809180000_customers.sql.
 * Same friendly-error pattern as `isBookingConflictError` in
 * app-appointments-page.tsx.
 */
function friendlyCustomerError(rawMessage: string): string {
  if (rawMessage.includes('customers_org_phone_unique')) {
    return 'Another customer already has this phone number.'
  }
  if (rawMessage.includes('customers_org_email_unique')) {
    return 'Another customer already has this email address.'
  }
  return rawMessage
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso))
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso))
}

export function AppCustomersPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <CustomersDirectory organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function CustomersDirectory({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const canManage = MANAGING_ROLES.has(role)
  const [search, setSearch] = useState('')
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)

  const customersQuery = useOrgCustomers(organizationId)
  const customers = customersQuery.data ?? []

  const filteredCustomers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return customersQuery.data ?? []
    return (customersQuery.data ?? []).filter((customer) =>
      [customer.name, customer.phone, customer.email].some((field) => field?.toLowerCase().includes(query)),
    )
  }, [customersQuery.data, search])

  return (
    <Container size="lg" className="py-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink-950">Customers</h1>
          <p className="mt-1 text-sm text-ink-500">Everyone who&apos;s booked or walked in, in one place.</p>
        </div>
        {canManage ? <Button onClick={() => setIsAddOpen(true)}>Add customer</Button> : null}
      </div>

      <div className="mt-6">
        {customersQuery.isPending ? (
          <CustomersSkeleton />
        ) : customersQuery.isError ? (
          <ErrorState
            title="Couldn't load customers"
            description={customersQuery.error.message}
            action={
              <Button variant="secondary" onClick={() => void customersQuery.refetch()}>
                Try again
              </Button>
            }
          />
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Customers are added automatically the first time someone books or walks in with a phone or email — or add one directly."
            action={canManage ? <Button onClick={() => setIsAddOpen(true)}>Add customer</Button> : undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="sm:max-w-xs">
              <TextField
                label="Search"
                placeholder="Name, phone, or email"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <Table label="Customers">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Last updated</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCustomers.length === 0 ? (
                  <TableStateRow colSpan={5}>
                    <EmptyState title="No matches" description="Try a different search." className="border-none" />
                  </TableStateRow>
                ) : (
                  filteredCustomers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium text-ink-950">{customer.name}</TableCell>
                      <TableCell className="text-ink-500">{customer.phone || '—'}</TableCell>
                      <TableCell className="text-ink-500">{customer.email || '—'}</TableCell>
                      <TableCell className="text-ink-500">{formatDate(customer.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="secondary" size="sm" onClick={() => setSelectedCustomer(customer)}>
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {isAddOpen ? (
        <AddCustomerDialog
          organizationId={organizationId}
          onClose={() => setIsAddOpen(false)}
          onSaved={() => {
            toast({ title: 'Customer added', variant: 'success' })
            setIsAddOpen(false)
          }}
        />
      ) : null}

      {selectedCustomer ? (
        <CustomerDetailDialog
          customer={selectedCustomer}
          organizationId={organizationId}
          canManage={canManage}
          onClose={() => setSelectedCustomer(null)}
        />
      ) : null}
    </Container>
  )
}

// --- Detail dialog: editable fields + recent visit history -----------------

function CustomerDetailDialog({
  customer,
  organizationId,
  canManage,
  onClose,
}: {
  customer: Customer
  organizationId: string
  canManage: boolean
  onClose: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const visitsQuery = useCustomerAppointments(customer.id)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer.name}</DialogTitle>
          <DialogDescription>Customer since {formatDate(customer.createdAt)}</DialogDescription>
        </DialogHeader>

        {isEditing ? (
          <CustomerFormFields
            organizationId={organizationId}
            customer={customer}
            onDone={() => setIsEditing(false)}
            onCancel={() => setIsEditing(false)}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-ink-500">Phone</p>
                <p className="text-ink-950">{customer.phone || '—'}</p>
              </div>
              <div>
                <p className="text-ink-500">Email</p>
                <p className="text-ink-950">{customer.email || '—'}</p>
              </div>
            </div>
            {customer.notes ? (
              <div className="text-sm">
                <p className="text-ink-500">Notes</p>
                <p className="whitespace-pre-wrap text-ink-950">{customer.notes}</p>
              </div>
            ) : null}

            <div>
              <h3 className="mb-2 text-sm font-medium text-ink-950">Recent visits</h3>
              {visitsQuery.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : visitsQuery.isError ? (
                <p className="text-sm text-danger-700">{visitsQuery.error.message}</p>
              ) : visitsQuery.data.length === 0 ? (
                <p className="text-sm text-ink-500">No appointments yet.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {visitsQuery.data.map((appointment) => (
                    <li
                      key={appointment.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                    >
                      <span className="text-ink-700">{formatDateTime(appointment.startsAt)}</span>
                      <Badge variant={STATUS_BADGE_VARIANT[appointment.status]}>{STATUS_LABELS[appointment.status]}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary">
                  Close
                </Button>
              </DialogClose>
              {canManage ? <Button onClick={() => setIsEditing(true)}>Edit</Button> : null}
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Create / edit form ------------------------------------------------------

const customerSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string(),
  email: z.string(),
  notes: z.string(),
})

type CustomerFormValues = z.infer<typeof customerSchema>

function CustomerFormFields({
  organizationId,
  customer,
  onDone,
  onCancel,
}: {
  organizationId: string
  customer?: Customer
  onDone: () => void
  onCancel: () => void
}) {
  const createCustomer = useCreateCustomer()
  const updateCustomer = useUpdateCustomer()
  const [formError, setFormError] = useState<string | null>(null)
  const isPending = createCustomer.isPending || updateCustomer.isPending

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      email: customer?.email ?? '',
      notes: customer?.notes ?? '',
    },
  })

  async function onSubmit(values: CustomerFormValues) {
    setFormError(null)
    const payload = {
      organizationId,
      name: values.name.trim(),
      phone: values.phone.trim() || null,
      email: values.email.trim() || null,
      notes: values.notes.trim() || null,
    }
    try {
      if (customer) {
        await updateCustomer.mutateAsync({ id: customer.id, ...payload })
      } else {
        await createCustomer.mutateAsync(payload)
      }
      onDone()
    } catch (error) {
      const rawMessage = getErrorMessage(error) ?? 'Something went wrong.'
      setFormError(friendlyCustomerError(rawMessage))
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
      {formError ? <Alert variant="error">{formError}</Alert> : null}
      <TextField label="Name" error={errors.name?.message} {...register('name')} />
      <TextField label="Phone (optional)" type="tel" {...register('phone')} />
      <TextField label="Email (optional)" type="email" {...register('email')} />
      <Textarea label="Notes (optional)" rows={3} {...register('notes')} />
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isLoading={isSubmitting || isPending}>
          {customer ? 'Save changes' : 'Add customer'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function AddCustomerDialog({
  organizationId,
  onClose,
  onSaved,
}: {
  organizationId: string
  onClose: () => void
  onSaved: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add customer</DialogTitle>
          <DialogDescription>Add a customer directly — most are created automatically from bookings.</DialogDescription>
        </DialogHeader>
        <CustomerFormFields organizationId={organizationId} onDone={onSaved} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  )
}

function CustomersSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
