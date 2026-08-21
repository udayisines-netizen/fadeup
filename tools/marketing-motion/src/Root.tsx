import { Composition } from 'remotion'
import { FPS, TOTAL } from './brand'
import { ProductFilm } from './ProductFilm'

/**
 * 1920x1080 at 30fps. A silent marketing film does not need 4K or 60fps —
 * the payload cost is real and the perceived gain is not (brief §40).
 */
export function RemotionRoot() {
  return (
    <Composition
      id="ProductFilm"
      component={ProductFilm}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1920}
      height={1080}
    />
  )
}
