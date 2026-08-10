import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { useCurrentOrg } from '@/lib/current-org-context'
import { useOrgLocations, type Location } from '@/lib/queries/locations'
import { useCreateChair, useOrgChairs, useUpdateChair, type Chair, type ChairInput } from '@/lib/queries/chairs'
import { TextField } from '@/components/ui/text-field'
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

const chairSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  isActive: z.boolean(),
})

type ChairFormValues = z.infer<typeof chairSchema>

type DialogState = { mode: 'create' } | { mode: 'edit'; chair: Chair } | null

export function AppChairsPage() {
  const { currentMembership } = useCurrentOrg()

  if (!currentMembership) return null

  return <ChairsManagement organizationId={currentMembership.organizationId} role={currentMembership.role} />
}

function ChairsManagement({ organizationId, role }: { organizationId: string; role: MembershipRole }) {
  const { toast } = useToast()
  const canManage = MANAGING_ROLES.has(role)
  const locationsQuery = useOrgLocations(organizationId)
  const chairsQuery = useOrgChairs(organizationId)
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null)
  const [dialogState, setDialogState] = useState<DialogState>(null)

  const locations = locationsQuery.data ?? []
  const activeLocationId = selectedLocationId ?? locations[0]?.id ?? null

  const chairsByLocation = useMemo(() => {
    const map = new Map<string, Chair[]>()
    for (const chair of chairsQuery.data ?? []) {
      const list = map.get(chair.locationId) ?? []
      list.push(chair)
      map.set(chair.locationId, list)
    }
    return map
  }, [chairsQuery.data])

  const isLoading = locationsQuery.isPending || chairsQuery.isPending
  const loadError = locationsQuery.error ?? chairsQuery.error
  const isError = locationsQuery.isError || chairsQuery.isError

  function handleSaved(message: string) {
    toast({ title: message, variant: 'success' })
    setDialogState(null)
  }

  return (
    <Container size="lg" className="py-8">
      <div>
        <h1 className="text-xl font-semibold text-ink-950">Chairs</h1>
        <p className="mt-1 text-sm text-ink-500">Chair inventory for each location.</p>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <ChairsSkeleton />
        ) : isError ? (
          <ErrorState
            title="Couldn't load chairs"
            description={loadError?.message}
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  void locationsQuery.refetch()
                  void chairsQuery.refetch()
                }}
              >
                Try again
              </Button>
            }
          />
        ) : locations.length === 0 ? (
          <EmptyState
            title="No locations yet"
            description="Add a location before adding chairs."
            action={
              <Link to="/app/locations" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                Go to locations
              </Link>
            }
          />
        ) : (
          <Tabs value={activeLocationId ?? undefined} onValueChange={setSelectedLocationId}>
            <TabsList>
              {locations.map((location) => (
                <TabsTrigger key={location.id} value={location.id}>
                  {location.name}
                </TabsTrigger>
              ))}
            </TabsList>
            {locations.map((location) => (
              <TabsContent key={location.id} value={location.id}>
                <LocationChairs
                  location={location}
                  chairs={chairsByLocation.get(location.id) ?? []}
                  canManage={canManage}
                  onAdd={() => setDialogState({ mode: 'create' })}
                  onEdit={(chair) => setDialogState({ mode: 'edit', chair })}
                />
              </TabsContent>
            ))}
          </Tabs>
        )}
      </div>

      {dialogState && activeLocationId ? (
        <ChairFormDialog
          key={dialogState.mode === 'edit' ? dialogState.chair.id : `create-${activeLocationId}`}
          organizationId={organizationId}
          locationId={activeLocationId}
          chair={dialogState.mode === 'edit' ? dialogState.chair : null}
          onClose={() => setDialogState(null)}
          onSaved={handleSaved}
        />
      ) : null}
    </Container>
  )
}

function LocationChairs({
  location,
  chairs,
  canManage,
  onAdd,
  onEdit,
}: {
  location: Location
  chairs: Chair[]
  canManage: boolean
  onAdd: () => void
  onEdit: (chair: Chair) => void
}) {
  const columnCount = canManage ? 3 : 2

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-end">
        {canManage ? (
          <Button size="sm" onClick={onAdd}>
            Add chair
          </Button>
        ) : null}
      </div>
      <Table label={`Chairs at ${location.name}`}>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            {canManage ? (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {chairs.length === 0 ? (
            <TableStateRow colSpan={columnCount}>
              <EmptyState
                title="No chairs yet"
                description={canManage ? 'Add a chair to this location.' : 'This location has no chairs yet.'}
                className="border-none"
              />
            </TableStateRow>
          ) : (
            chairs.map((chair) => (
              <TableRow key={chair.id}>
                <TableCell className="font-medium text-ink-950">{chair.name}</TableCell>
                <TableCell>
                  <Badge variant={chair.isActive ? 'success' : 'neutral'}>
                    {chair.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                {canManage ? (
                  <TableCell className="text-right">
                    <Button variant="secondary" size="sm" onClick={() => onEdit(chair)}>
                      Edit
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

function ChairFormDialog({
  organizationId,
  locationId,
  chair,
  onClose,
  onSaved,
}: {
  organizationId: string
  locationId: string
  chair: Chair | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const isEdit = Boolean(chair)
  const createChair = useCreateChair()
  const updateChair = useUpdateChair()
  const [formError, setFormError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ChairFormValues>({
    resolver: zodResolver(chairSchema),
    defaultValues: {
      name: chair?.name ?? '',
      isActive: chair?.isActive ?? true,
    },
  })

  async function onSubmit(values: ChairFormValues) {
    setFormError(null)

    const payload: ChairInput = {
      organizationId,
      locationId,
      name: values.name,
      isActive: values.isActive,
    }

    try {
      if (isEdit && chair) {
        await updateChair.mutateAsync({ id: chair.id, ...payload })
        onSaved('Chair updated')
      } else {
        await createChair.mutateAsync(payload)
        onSaved('Chair added')
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
          <DialogTitle>{isEdit ? 'Edit chair' : 'Add chair'}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update this chair's details." : 'Add a new chair to this location.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
          {formError ? <Alert variant="error">{formError}</Alert> : null}

          <TextField label="Name" hint='e.g. "Chair 1"' error={errors.name?.message} {...register('name')} />
          <Switch label="Active" description="Inactive chairs are hidden from scheduling." {...register('isActive')} />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" isLoading={isSubmitting}>
              {isEdit ? 'Save changes' : 'Add chair'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ChairsSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border p-4" aria-hidden="true">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-3/4" />
    </div>
  )
}
