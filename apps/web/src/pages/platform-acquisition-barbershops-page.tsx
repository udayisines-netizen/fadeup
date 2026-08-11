import { ProspectsListView } from '@/components/acquisition/prospects-list'

/** /platform/acquisition/barbershops — the shared prospects table, preset to type=barbershop. */
export function PlatformAcquisitionBarbershopsPage() {
  return <ProspectsListView presetType="barbershop" />
}
