/**
 * Map rendering configuration — the ONE place the tile source lives
 * (Design Pass A.1 §8).
 *
 * RENDERER. MapLibre GL (`maplibre-gl`, already a dependency), loaded lazily
 * by `v2-results-map.tsx` so it never enters the initial bundle.
 *
 * CURRENT PREVIEW SOURCE. Public OpenStreetMap raster tiles. This is a
 * PREVIEW convenience, not a production decision: the OSM tile servers are a
 * volunteer-run service whose usage policy tolerates light development
 * traffic and explicitly discourages production apps. The attribution below
 * is required by that policy and must survive any source change in whatever
 * form the replacement's licence requires.
 *
 * PRODUCTION REQUIREMENT (decision pending, out of this pass's scope): a
 * licensed or self-hosted tile source — e.g. a commercial vector-tile
 * provider or a self-hosted OpenMapTiles/Protomaps stack — swapped in by
 * editing THIS object only. No component knows the URL.
 */
export const MAP_TILE_SOURCE: { tiles: string[]; tileSize: number; attribution: string } = {
  tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
  tileSize: 256,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
}
