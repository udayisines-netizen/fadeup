import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { motion } from 'motion/react'
import { useProspectMapPoints, type ProspectMapPoint } from '@/lib/queries/acquisition/prospects'
import { pipelineStageLabel, prospectTypeLabel } from '@/components/acquisition/labels'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import type { ProspectScoreBucket } from '@/lib/queries/acquisition/types'

const BUCKET_COLORS: Record<ProspectScoreBucket, string> = {
  LOW: '#94a3b8',
  MEDIUM: '#3b82f6',
  HIGH: '#f59e0b',
  HOT: '#dc2626',
}

const BUCKET_SCALES: Record<ProspectScoreBucket, number> = {
  LOW: 0.75,
  MEDIUM: 0.9,
  HIGH: 1.05,
  HOT: 1.25,
}

const DEFAULT_CENTER: [number, number] = [2.3522, 48.8566] // Paris — sensible default given France-first discovery scope.

/**
 * /platform/acquisition/map — raster OpenStreetMap tiles (no paid Mapbox
 * token), one marker per prospect with a primary geocoded location, colored
 * + sized by score bucket. Attribution control is required by the OSM tile
 * usage policy and comes from the style source's `attribution` field below.
 */
export function PlatformAcquisitionMapPage() {
  const pointsQuery = useProspectMapPoints()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const markersRef = useRef<maplibregl.Marker[]>([])

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: DEFAULT_CENTER,
      zoom: 5,
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !pointsQuery.data) return

    for (const marker of markersRef.current) marker.remove()
    markersRef.current = []

    const points = pointsQuery.data.filter(
      (point): point is ProspectMapPoint & { latitude: number; longitude: number } => point.latitude != null && point.longitude != null,
    )

    for (const point of points) {
      const bucket = point.prospect.currentScoreBucket ?? 'LOW'

      const popupNode = document.createElement('div')
      popupNode.className = 'flex flex-col gap-1 text-sm'

      const nameEl = document.createElement('p')
      nameEl.className = 'font-medium text-ink-950'
      nameEl.textContent = point.prospect.canonicalName
      popupNode.appendChild(nameEl)

      const metaEl = document.createElement('p')
      metaEl.className = 'text-xs text-ink-500'
      metaEl.textContent = `${prospectTypeLabel(point.prospect.type)} · ${pipelineStageLabel(point.prospect.status)} · ${
        point.prospect.currentScoreBucket ?? 'Unscored'
      }`
      popupNode.appendChild(metaEl)

      const linkButton = document.createElement('button')
      linkButton.type = 'button'
      linkButton.className = 'mt-1 text-left text-xs font-medium text-accent-700 underline underline-offset-2'
      linkButton.textContent = 'View prospect →'
      linkButton.addEventListener('click', () => navigate(`/platform/acquisition/prospects/${point.prospect.id}`))
      popupNode.appendChild(linkButton)

      const marker = new maplibregl.Marker({ color: BUCKET_COLORS[bucket], scale: BUCKET_SCALES[bucket] })
        .setLngLat([point.longitude, point.latitude])
        .setPopup(new maplibregl.Popup({ offset: 24 }).setDOMContent(popupNode))
        .addTo(map)

      markersRef.current.push(marker)
    }

    if (points.length > 0) {
      const bounds = new maplibregl.LngLatBounds()
      for (const point of points) bounds.extend([point.longitude, point.latitude])
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 0 })
    }
  }, [pointsQuery.data, navigate])

  if (pointsQuery.isError) {
    return <ErrorState title="Couldn't load prospect locations" description={pointsQuery.error.message} />
  }

  return (
    <div className="flex flex-col gap-3">
      {pointsQuery.isPending ? (
        <Skeleton className="h-[32rem] w-full" />
      ) : pointsQuery.data.length === 0 ? (
        <EmptyState title="No geocoded prospects yet" description="Prospects with a primary location and coordinates will appear here." />
      ) : null}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: pointsQuery.isPending ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        className="h-[32rem] w-full overflow-hidden rounded-lg border border-border"
        style={{ display: pointsQuery.isPending ? 'none' : 'block' }}
      >
        <div ref={containerRef} className="h-full w-full" />
      </motion.div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
        <span className="font-medium text-ink-700">Score bucket:</span>
        {(Object.entries(BUCKET_COLORS) as [ProspectScoreBucket, string][]).map(([bucket, color]) => (
          <span key={bucket} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            {bucket}
          </span>
        ))}
      </div>
    </div>
  )
}
