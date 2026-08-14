import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useCurrentOrg } from '@/lib/current-org-context'
import {
  useCreateServiceCategory,
  useDeleteServiceCategory,
  useOrgServiceCategories,
  useUpdateServiceCategory,
  type ServiceCategory,
} from '@/lib/queries/service-categories'
import { useCreateService, useOrgServices, useUpdateService, type Service } from '@/lib/queries/services'
import {
  useAssignServiceLocation,
  useOrgServiceLocations,
  useUnassignServiceLocation,
} from '@/lib/queries/service-locations'
import { useAssignBarberService, useOrgBarberServices, useUnassignBarberService } from '@/lib/queries/barber-services'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { useOrgBarbers, type Barber } from '@/lib/queries/barbers'
import { useOrgStaffProfiles, type StaffProfile } from '@/lib/queries/staff-profiles'
import { TextField } from '@/components/ui/text-field'
import { Textarea } from '@/components/ui/textarea'
import { SelectField } from '@/components/ui/select-field'
import { Switch } from '@/components/ui/switch'
import { Button, buttonVariants } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Container } from '@/components/ui/container'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableStateRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import type { MembershipRole } from '@/lib/types'
import { getErrorMessage } from '@/lib/get-error-message'

const MANAGING_ROLES = new Set<MembershipRole>(['owner', 'manager'])

const NO_CATEGORY_VALUE = ''
const ALL_CATEGORIES_VALUE = 'all'
const UNCATEGORIZED_VALUE = 'uncategorized'

function centsToDollarsInput(cents: number): number {
  return Math.round(cents) / 100
}

function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100)
}

function formatPrice(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

export function AppServicesPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <ServicesManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function ServicesManagement({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const canManage = MANAGING_ROLES.has(role)
  const categoriesQuery = useOrgServiceCategories(organizationId)
  const servicesQuery = useOrgServices(organizationId)
  const locationsQuery = useOrgLocations(organizationId)
  const barbersQuery = useOrgBarbers(organizationId)
  const staffProfilesQuery = useOrgStaffProfiles(organizationId)
  const serviceLocationsQuery = useOrgServiceLocations(organizationId)
  const barberServicesQuery = useOrgBarberServices(organizationId)

  const isLoading =
    categoriesQuery.isPending ||
    servicesQuery.isPending ||
    locationsQuery.isPending ||
    barbersQuery.isPending ||
    staffProfilesQuery.isPending ||
    serviceLocationsQuery.isPending ||
    barberServicesQuery.isPending

  const loadError =
    categoriesQuery.error ??
    servicesQuery.error ??
    locationsQuery.error ??
    barbersQuery.error ??
    staffProfilesQuery.error ??
    serviceLocationsQuery.error ??
    barberServicesQuery.error

  const isError =
    categoriesQuery.isError ||
    servicesQuery.isError ||
    locationsQuery.isError ||
    barbersQuery.isError ||
    staffProfilesQuery.isError ||
    serviceLocationsQuery.isError ||
    barberServicesQuery.isError

  function refetchAll() {
    void categoriesQuery.refetch()
    void servicesQuery.refetch()
    void locationsQuery.refetch()
    void barbersQuery.refetch()
    void staffProfilesQuery.refetch()
    void serviceLocationsQuery.refetch()
    void barberServicesQuery.refetch()
  }

  return (
    <Container size="lg" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Services</h1>
        <p className="mt-1 text-sm text-ink-500">Your service catalog, pricing, and where/who offers each service.</p>
      </div>

      {isLoading ? (
        <div className="mt-6">
          <ServicesSkeleton />
        </div>
      ) : isError ? (
        <div className="mt-6">
          <ErrorState
            title="Couldn't load your service catalog"
            description={loadError?.message}
            action={
              <Button variant="secondary" onClick={refetchAll}>
                Try again
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <CategoriesSection organizationId={organizationId} categories={categoriesQuery.data} canManage={canManage} />
          <ServicesSection
            organizationId={organizationId}
            services={servicesQuery.data}
            categories={categoriesQuery.data}
            locations={locationsQuery.data}
            barbers={barbersQuery.data}
            staffProfiles={staffProfilesQuery.data}
            serviceLocations={serviceLocationsQuery.data}
            barberServices={barberServicesQuery.data}
            canManage={canManage}
          />
        </>
      )}
    </Container>
  )
}

// --- Categories -------------------------------------------------------------

type CategoryDialogState = { mode: 'create' } | { mode: 'edit'; category: ServiceCategory } | null

const categorySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  displayOrder: z.coerce.number().int('Must be a whole number').min(0, 'Must be zero or more'),
  isActive: z.boolean(),
})

type CategoryFormValues = z.infer<typeof categorySchema>

function CategoriesSection({
  organizationId,
  categories,
  canManage,
}: {
  organizationId: string
  categories: ServiceCategory[]
  canManage: boolean
}) {
  const { toast } = useToast()
  const deleteCategory = useDeleteServiceCategory()
  const [dialogState, setDialogState] = useState<CategoryDialogState>(null)

  function handleSaved(message: string) {
    toast({ title: message, variant: 'success' })
    setDialogState(null)
  }

  function handleDelete(category: ServiceCategory) {
    if (!window.confirm(`Delete "${category.name}"? Services in this category will become uncategorized.`)) return

    deleteCategory.mutate(
      { id: category.id, organizationId },
      {
        onSuccess: () => toast({ title: 'Category deleted', variant: 'success' }),
        onError: (error) =>
          toast({
            title: "Couldn't delete category",
            description: getErrorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-950">Categories</h2>
        {canManage ? (
          <Button size="sm" variant="secondary" onClick={() => setDialogState({ mode: 'create' })}>
            Add category
          </Button>
        ) : null}
      </div>

      <div className="mt-3">
        {categories.length === 0 ? (
          <EmptyState
            title="No categories yet"
            description="Categories are optional — group services like &ldquo;Haircuts&rdquo; or &ldquo;Beard&rdquo; to keep the catalog organized."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="min-w-0 truncate text-sm font-medium text-ink-950">{category.name}</span>
                  <Badge variant={category.isActive ? 'success' : 'neutral'}>
                    {category.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                {canManage ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setDialogState({ mode: 'edit', category })}>
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      isLoading={deleteCategory.isPending && deleteCategory.variables?.id === category.id}
                      onClick={() => handleDelete(category)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialogState ? (
        <CategoryFormDialog
          key={dialogState.mode === 'edit' ? dialogState.category.id : 'create'}
          organizationId={organizationId}
          category={dialogState.mode === 'edit' ? dialogState.category : null}
          onClose={() => setDialogState(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  )
}

function CategoryFormDialog({
  organizationId,
  category,
  onClose,
  onSaved,
}: {
  organizationId: string
  category: ServiceCategory | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const isEdit = Boolean(category)
  const createCategory = useCreateServiceCategory()
  const updateCategory = useUpdateServiceCategory()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CategoryFormValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      name: category?.name ?? '',
      displayOrder: category?.displayOrder ?? 0,
      isActive: category?.isActive ?? true,
    },
  })

  async function onSubmit(values: CategoryFormValues) {
    setFormError(null)

    try {
      if (isEdit && category) {
        await updateCategory.mutateAsync({ id: category.id, organizationId, ...values })
        onSaved('Category updated')
      } else {
        await createCategory.mutateAsync({ organizationId, ...values })
        onSaved('Category created')
      }
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'Add category'}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this category's details." : 'Group services under a new category.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label="Name" hint='e.g. "Haircuts"' error={errors.name?.message} {...register('name')} />
          <TextField
            label="Display order"
            type="number"
            min={0}
            step={1}
            hint="Lower numbers show first."
            error={errors.displayOrder?.message}
            {...register('displayOrder')}
          />
          <Switch label="Active" description="Inactive categories are hidden from booking." {...register('isActive')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? 'Save changes' : 'Add category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// --- Services -----------------------------------------------------------------

type ServiceDialogState = { mode: 'create' } | { mode: 'edit'; service: Service } | null

function ServicesSection({
  organizationId,
  services,
  categories,
  locations,
  barbers,
  staffProfiles,
  serviceLocations,
  barberServices,
  canManage,
}: {
  organizationId: string
  services: Service[]
  categories: ServiceCategory[]
  locations: Location[]
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  serviceLocations: { serviceId: string; locationId: string }[]
  barberServices: { serviceId: string; barberId: string }[]
  canManage: boolean
}) {
  const { toast } = useToast()
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES_VALUE)
  const [dialogState, setDialogState] = useState<ServiceDialogState>(null)

  const categoryById = useMemo(() => {
    const map = new Map<string, ServiceCategory>()
    for (const category of categories) map.set(category.id, category)
    return map
  }, [categories])

  const locationCountByService = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of serviceLocations) {
      map.set(row.serviceId, (map.get(row.serviceId) ?? 0) + 1)
    }
    return map
  }, [serviceLocations])

  const barberCountByService = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of barberServices) {
      map.set(row.serviceId, (map.get(row.serviceId) ?? 0) + 1)
    }
    return map
  }, [barberServices])

  const filteredServices = useMemo(() => {
    if (categoryFilter === ALL_CATEGORIES_VALUE) return services
    if (categoryFilter === UNCATEGORIZED_VALUE) return services.filter((service) => !service.categoryId)
    return services.filter((service) => service.categoryId === categoryFilter)
  }, [services, categoryFilter])

  const columnCount = canManage ? 5 : 4

  function handleSaved(message: string) {
    toast({ title: message, variant: 'success' })
    setDialogState(null)
  }

  const filterOptions = [
    { value: ALL_CATEGORIES_VALUE, label: 'All categories' },
    { value: UNCATEGORIZED_VALUE, label: 'No category' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ]

  return (
    <section className="mt-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-64">
          <SelectField
            label="Filter by category"
            options={filterOptions}
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
          />
        </div>
        {canManage ? <Button onClick={() => setDialogState({ mode: 'create' })}>Add service</Button> : null}
      </div>

      <div className="mt-4">
        <Table label="Services">
          <TableHeader>
            <TableRow>
              <TableHead>Service</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Price</TableHead>
              {canManage ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredServices.length === 0 ? (
              <TableStateRow colSpan={columnCount}>
                <EmptyState
                  title={services.length === 0 ? 'No services yet' : 'No services in this category'}
                  description={canManage ? 'Add a service to start building your catalog.' : undefined}
                  action={
                    canManage && services.length === 0 ? (
                      <Button size="sm" onClick={() => setDialogState({ mode: 'create' })}>
                        Add service
                      </Button>
                    ) : undefined
                  }
                  className="border-none"
                />
              </TableStateRow>
            ) : (
              filteredServices.map((service) => {
                const locationCount = locationCountByService.get(service.id) ?? 0
                const barberCount = barberCountByService.get(service.id) ?? 0
                return (
                  <TableRow key={service.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink-950">{service.name}</span>
                        <span className="text-xs text-ink-500">
                          {locationCount} location{locationCount === 1 ? '' : 's'} · {barberCount} barber
                          {barberCount === 1 ? '' : 's'} eligible
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-ink-500">
                      {service.categoryId ? (categoryById.get(service.categoryId)?.name ?? '—') : '—'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{service.durationMinutes} min</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatPrice(service.priceCents)}
                      {!service.isActive ? (
                        <Badge variant="neutral" className="ml-2">
                          Inactive
                        </Badge>
                      ) : null}
                    </TableCell>
                    {canManage ? (
                      <TableCell className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setDialogState({ mode: 'edit', service })}
                        >
                          Edit
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>

      {dialogState ? (
        <ServiceFormDialog
          key={dialogState.mode === 'edit' ? dialogState.service.id : 'create'}
          organizationId={organizationId}
          service={dialogState.mode === 'edit' ? dialogState.service : null}
          categories={categories}
          locations={locations}
          barbers={barbers}
          staffProfiles={staffProfiles}
          serviceLocations={serviceLocations}
          barberServices={barberServices}
          canManage={canManage}
          onClose={() => setDialogState(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </section>
  )
}

const serviceSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string(),
  categoryId: z.string(),
  durationMinutes: z.coerce.number().int('Must be a whole number').positive('Duration must be greater than zero'),
  bufferBeforeMinutes: z.coerce.number().int('Must be a whole number').min(0, 'Must be zero or more'),
  bufferAfterMinutes: z.coerce.number().int('Must be a whole number').min(0, 'Must be zero or more'),
  priceDollars: z.coerce.number().min(0, 'Must be zero or more'),
  isActive: z.boolean(),
})

type ServiceFormValues = z.infer<typeof serviceSchema>

function ServiceFormDialog({
  organizationId,
  service,
  categories,
  locations,
  barbers,
  staffProfiles,
  serviceLocations,
  barberServices,
  canManage,
  onClose,
  onSaved,
}: {
  organizationId: string
  service: Service | null
  categories: ServiceCategory[]
  locations: Location[]
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  serviceLocations: { serviceId: string; locationId: string }[]
  barberServices: { serviceId: string; barberId: string }[]
  canManage: boolean
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const isEdit = Boolean(service)
  const createService = useCreateService()
  const updateService = useUpdateService()
  const [formError, setFormError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('details')

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ServiceFormValues>({
    resolver: zodResolver(serviceSchema),
    defaultValues: {
      name: service?.name ?? '',
      description: service?.description ?? '',
      categoryId: service?.categoryId ?? NO_CATEGORY_VALUE,
      durationMinutes: service?.durationMinutes ?? 30,
      bufferBeforeMinutes: service?.bufferBeforeMinutes ?? 0,
      bufferAfterMinutes: service?.bufferAfterMinutes ?? 0,
      priceDollars: service ? centsToDollarsInput(service.priceCents) : 0,
      isActive: service?.isActive ?? true,
    },
  })

  async function onSubmit(values: ServiceFormValues) {
    setFormError(null)

    const payload = {
      organizationId,
      categoryId: values.categoryId || null,
      name: values.name,
      description: values.description || null,
      durationMinutes: values.durationMinutes,
      bufferBeforeMinutes: values.bufferBeforeMinutes,
      bufferAfterMinutes: values.bufferAfterMinutes,
      priceCents: dollarsToCents(values.priceDollars),
      isActive: values.isActive,
    }

    try {
      if (isEdit && service) {
        await updateService.mutateAsync({ id: service.id, ...payload })
        onSaved('Service updated')
      } else {
        await createService.mutateAsync(payload)
        onSaved('Service created')
      }
    } catch (error) {
      setFormError(getErrorMessage(error) ?? 'Something went wrong.')
    }
  }

  const categoryOptions = [
    { value: NO_CATEGORY_VALUE, label: 'No category' },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ]

  const detailsFields = (
    <div className="flex flex-col gap-4">
      {formError ? <Alert variant="error">{formError}</Alert> : null}

      <TextField label="Name" error={errors.name?.message} {...register('name')} />
      <Textarea label="Description" rows={2} {...register('description')} />
      <SelectField label="Category" options={categoryOptions} {...register('categoryId')} />

      <div className="grid grid-cols-3 gap-4">
        <TextField
          label="Duration (min)"
          type="number"
          min={1}
          step={5}
          error={errors.durationMinutes?.message}
          {...register('durationMinutes')}
        />
        <TextField
          label="Buffer before (min)"
          type="number"
          min={0}
          step={5}
          error={errors.bufferBeforeMinutes?.message}
          {...register('bufferBeforeMinutes')}
        />
        <TextField
          label="Buffer after (min)"
          type="number"
          min={0}
          step={5}
          error={errors.bufferAfterMinutes?.message}
          {...register('bufferAfterMinutes')}
        />
      </div>

      <TextField
        label="Price"
        type="number"
        min={0}
        step={0.01}
        inputMode="decimal"
        hint="Dollar amount, e.g. 35.00"
        error={errors.priceDollars?.message}
        {...register('priceDollars')}
      />
      <Switch label="Active" description="Inactive services are hidden from booking." {...register('isActive')} />
    </div>
  )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit service' : 'Add service'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update details, or manage which locations and barbers offer this service.'
              : 'Add a new service to your catalog.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {isEdit && service ? (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="locations">Locations</TabsTrigger>
                <TabsTrigger value="barbers">Barbers</TabsTrigger>
              </TabsList>
              {/*
                No inner viewport-height scroller: DialogContent is capped to
                the viewport and scrolls itself, so a second nested scroll area
                only produced a scrollbar inside a scrollbar on short screens.
              */}
              <div>
                <TabsContent value="details">{detailsFields}</TabsContent>
                <TabsContent value="locations">
                  <ServiceLocationsTab
                    organizationId={organizationId}
                    serviceId={service.id}
                    locations={locations}
                    assignedLocationIds={
                      new Set(
                        serviceLocations.filter((row) => row.serviceId === service.id).map((row) => row.locationId),
                      )
                    }
                    canManage={canManage}
                  />
                </TabsContent>
                <TabsContent value="barbers">
                  <ServiceBarbersTab
                    organizationId={organizationId}
                    serviceId={service.id}
                    barbers={barbers}
                    staffProfiles={staffProfiles}
                    assignedBarberIds={
                      new Set(
                        barberServices.filter((row) => row.serviceId === service.id).map((row) => row.barberId),
                      )
                    }
                    canManage={canManage}
                  />
                </TabsContent>
              </div>
            </Tabs>
          ) : (
            detailsFields
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Close
              </Button>
            </DialogClose>
            {canManage ? (
              <Button type="submit" isLoading={isSubmitting}>
                {isEdit ? 'Save changes' : 'Add service'}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ServiceLocationsTab({
  organizationId,
  serviceId,
  locations,
  assignedLocationIds,
  canManage,
}: {
  organizationId: string
  serviceId: string
  locations: Location[]
  assignedLocationIds: Set<string>
  canManage: boolean
}) {
  const { toast } = useToast()
  const assign = useAssignServiceLocation()
  const unassign = useUnassignServiceLocation()
  const [pendingLocationId, setPendingLocationId] = useState<string | null>(null)

  if (locations.length === 0) {
    return (
      <EmptyState
        title="No locations yet"
        description="Add a location before assigning this service to it."
        action={
          <Link to="/app/locations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Go to locations
          </Link>
        }
      />
    )
  }

  function handleToggle(location: Location, assigned: boolean) {
    setPendingLocationId(location.id)
    const mutation = assigned ? unassign : assign
    mutation.mutate(
      { organizationId, serviceId, locationId: location.id },
      {
        onSettled: () => setPendingLocationId(null),
        onError: (error) =>
          toast({
            title: "Couldn't update location assignment",
            description: getErrorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {locations.map((location) => {
        const assigned = assignedLocationIds.has(location.id)
        return (
          <li key={location.id} className="px-4 py-2">
            <Switch
              label={location.name}
              checked={assigned}
              disabled={!canManage || pendingLocationId === location.id}
              onChange={() => handleToggle(location, assigned)}
            />
          </li>
        )
      })}
    </ul>
  )
}

function ServiceBarbersTab({
  organizationId,
  serviceId,
  barbers,
  staffProfiles,
  assignedBarberIds,
  canManage,
}: {
  organizationId: string
  serviceId: string
  barbers: Barber[]
  staffProfiles: StaffProfile[]
  assignedBarberIds: Set<string>
  canManage: boolean
}) {
  const { toast } = useToast()
  const assign = useAssignBarberService()
  const unassign = useUnassignBarberService()
  const [pendingBarberId, setPendingBarberId] = useState<string | null>(null)

  const staffProfileById = useMemo(() => {
    const map = new Map<string, StaffProfile>()
    for (const profile of staffProfiles) map.set(profile.id, profile)
    return map
  }, [staffProfiles])

  const bookableBarbers = useMemo(() => barbers.filter((barber) => barber.isBookable), [barbers])

  if (bookableBarbers.length === 0) {
    return (
      <EmptyState
        title="No bookable barbers yet"
        description="Mark a team member as a bookable barber before assigning them to services."
        action={
          <Link to="/app/team" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Go to team
          </Link>
        }
      />
    )
  }

  function handleToggle(barber: Barber, assigned: boolean) {
    setPendingBarberId(barber.id)
    const mutation = assigned ? unassign : assign
    mutation.mutate(
      { organizationId, serviceId, barberId: barber.id },
      {
        onSettled: () => setPendingBarberId(null),
        onError: (error) =>
          toast({
            title: "Couldn't update barber eligibility",
            description: getErrorMessage(error),
            variant: 'error',
          }),
      },
    )
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {bookableBarbers.map((barber) => {
        const assigned = assignedBarberIds.has(barber.id)
        const displayName = staffProfileById.get(barber.staffProfileId)?.displayName ?? 'Unnamed barber'
        return (
          <li key={barber.id} className="px-4 py-2">
            <Switch
              label={displayName}
              checked={assigned}
              disabled={!canManage || pendingBarberId === barber.id}
              onChange={() => handleToggle(barber, assigned)}
            />
          </li>
        )
      })}
    </ul>
  )
}

function ServicesSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
