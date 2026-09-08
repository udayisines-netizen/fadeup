import { useState } from 'react'
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native'
import { color, font } from '@/shared/theme/tokens'

/**
 * Bannière d'établissement — image réelle (aujourd'hui : uniquement le jeu
 * de démonstration `demo-*`) ou repli COMPOSÉ : surface douce de marque +
 * monogramme décoratif en débord (D1 §4/§9). Jamais un carré gris, jamais
 * une fausse image, jamais un dégradé sur du vide.
 */
export interface BannerImageProps {
  src: ImageSourcePropType | null
  name: string
  height: number
  /** Taille du monogramme décoratif du repli. */
  watermarkSize?: number
}

export function BannerImage({ src, name, height, watermarkSize = 112 }: BannerImageProps) {
  const [failed, setFailed] = useState(false)
  const showImage = src !== null && !failed

  return (
    <View style={[styles.frame, { height }]} accessibilityElementsHidden>
      {showImage ? (
        <Image
          source={src as ImageSourcePropType}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.fallback}>
          <Text
            style={[styles.watermark, { fontSize: watermarkSize, lineHeight: watermarkSize }]}
            numberOfLines={1}
          >
            {name.trim().charAt(0).toUpperCase() || '•'}
          </Text>
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: color.surfaceBrand },
  fallback: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  watermark: {
    fontFamily: font.bold,
    color: color.brandWatermark,
    marginBottom: -18,
    marginEnd: -8,
  },
})
