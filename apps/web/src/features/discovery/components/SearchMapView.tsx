import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { ProfessionalSearchRow } from '@/shared/data/discovery'

/**
 * F3 — la carte de la recherche : un ONGLET, jamais la vue par défaut
 * (MASTER_SPEC §3). Chunk paresseux : maplibre ne monte jamais dans l'entrée
 * consumer.
 *
 * Pile éprouvée du dépôt (page carte legacy /platform) : maplibre-gl +
 * tuiles raster OpenStreetMap, attribution obligatoire. LANGAGE VISUEL
 * MINIMAL ASSUMÉ : le contrat P1 déclare lui-même que le langage de carte
 * (marqueurs, clusters) n'est pas encore tranché — ici : marqueurs uniformes
 * à la couleur d'accent (jamais le bleu par défaut de maplibre), AUCUN
 * cluster, popup sobre vers le profil. À faire ratifier (rapport F3 §11).
 *
 * HONNÊTETÉ GÉOGRAPHIQUE : une zone de service est marquée à son CENTRE de
 * zone — le popup dit la zone, jamais une adresse (aucune n'existe).
 */

export interface SearchMapViewProps {
  rows: ProfessionalSearchRow[]
  searchPoint: { latitude: number; longitude: number } | null
}

function markerPoint(row: ProfessionalSearchRow): [number, number] | null {
  const longitude = row.longitude ?? row.service_area_center_longitude
  const latitude = row.latitude ?? row.service_area_center_latitude
  if (longitude === null || latitude === null) return null
  return [longitude, latitude]
}

export default function SearchMapView({ rows, searchPoint }: SearchMapViewProps) {
  const { t } = useTranslation('v2')
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
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [2.3522, 48.8566],
      zoom: 11,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }))
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    markersRef.current.forEach((marker) => marker.remove())
    markersRef.current = []

    const accent =
      getComputedStyle(document.body).getPropertyValue('--fu-accent').trim() || undefined
    const ink = getComputedStyle(document.body).getPropertyValue('--fu-text-primary').trim()
    const bounds = new maplibregl.LngLatBounds()
    let hasPoint = false

    // Le point de recherche du client : un point discret, distinct des
    // résultats — il situe « moi » sur la carte, il ne prétend rien d'autre.
    if (searchPoint) {
      const dot = document.createElement('span')
      dot.style.display = 'block'
      dot.style.width = '14px'
      dot.style.height = '14px'
      dot.style.borderRadius = '9999px'
      dot.style.background = ink || 'currentColor'
      dot.style.border = '3px solid var(--fu-canvas)'
      dot.style.boxShadow = '0 0 0 1px var(--fu-border-strong)'
      const selfMarker = new maplibregl.Marker({ element: dot })
        .setLngLat([searchPoint.longitude, searchPoint.latitude])
      selfMarker.addTo(map)
      markersRef.current.push(selfMarker)
    }

    rows.forEach((row) => {
      const point = markerPoint(row)
      if (!point) return
      hasPoint = true
      bounds.extend(point)

      const popupNode = document.createElement('div')
      const title = document.createElement('p')
      title.textContent = row.organization_name
      title.style.fontWeight = '600'
      title.style.margin = '0 0 4px'
      const link = document.createElement('button')
      link.type = 'button'
      link.textContent = t('discovery.map.openProfile')
      link.style.textDecoration = 'underline'
      link.style.cursor = 'pointer'
      link.addEventListener('click', () => {
        void navigate(`/shop/${encodeURIComponent(row.organization_slug)}`)
      })
      popupNode.append(title, link)

      const marker = new maplibregl.Marker(accent ? { color: accent } : undefined)
        .setLngLat(point)
        .setPopup(new maplibregl.Popup({ offset: 20 }).setDOMContent(popupNode))
      marker.addTo(map)
      markersRef.current.push(marker)
    })

    if (searchPoint) bounds.extend([searchPoint.longitude, searchPoint.latitude])
    if (hasPoint || searchPoint) map.fitBounds(bounds, { padding: 48, maxZoom: 14, animate: false })
  }, [rows, searchPoint, navigate, t])

  const locatedCount = rows.filter((row) => markerPoint(row) !== null).length
  const unlocatedCount = rows.length - locatedCount

  return (
    <div className="flex flex-col gap-2">
      {/* La carte ne se tait jamais : zéro marqueur se dit, et une ligne
          sans coordonnées est déclarée plutôt qu'escamotée. */}
      {locatedCount === 0 && (
        <p role="status" className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="map-empty-note">
          {t('discovery.map.empty')}
        </p>
      )}
      {unlocatedCount > 0 && (
        <p role="status" className="text-fu-sm text-[var(--fu-text-secondary)]" data-testid="map-unlocated-note">
          {t('discovery.map.unlocated', { count: unlocatedCount })}
        </p>
      )}
      <div
        ref={containerRef}
        role="region"
        aria-label={t('discovery.map.label')}
        data-testid="search-map"
        className="h-[60dvh] w-full overflow-hidden rounded-[var(--radius-card)] border border-[var(--fu-border)]"
      />
    </div>
  )
}
