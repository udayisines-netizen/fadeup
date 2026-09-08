import { useState } from 'react'
import { Image, StyleSheet, Text, View, type ImageSourcePropType, type ViewStyle } from 'react-native'
import { color, font, radius } from '@/shared/theme/tokens'

/**
 * Portrait rond — image réelle ou monogramme DÉTERMINISTE (initiales sur la
 * surface douce de marque). Le média manquant est la norme du scrapé : le
 * repli est un état de première classe, jamais un carré gris (D1 §9).
 */

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<AvatarSize, number> = { sm: 32, md: 44, lg: 64, xl: 88 }
const FONT_SIZES: Record<AvatarSize, number> = { sm: 14, md: 16, lg: 22, xl: 30 }

export interface AvatarProps {
  name: string
  /** URL absolue OU source native déjà résolue (resolveMediaSource). */
  src?: string | ImageSourcePropType | null
  size?: AvatarSize
  /** Anneau de détachement (ring) — couleur de la surface porteuse. */
  ringColor?: string
  style?: ViewStyle
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const first = parts[0]?.charAt(0) ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? '') : ''
  return (first + last).toUpperCase() || '•'
}

export function Avatar({ name, src, size = 'md', ringColor, style }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const dimension = SIZES[size]
  const source: ImageSourcePropType | null =
    typeof src === 'string' ? { uri: src } : (src ?? null)
  const showImage = source !== null && !failed

  return (
    <View
      accessibilityElementsHidden
      style={[
        {
          width: dimension,
          height: dimension,
          borderRadius: radius.avatar,
          overflow: 'hidden',
          backgroundColor: color.surfaceBrand,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ringColor ? { borderWidth: 3, borderColor: ringColor } : null,
        style,
      ]}
    >
      {showImage ? (
        <Image
          source={source as ImageSourcePropType}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text
          style={{
            fontFamily: font.semibold,
            fontSize: FONT_SIZES[size],
            color: color.accentText,
          }}
        >
          {initials(name)}
        </Text>
      )}
    </View>
  )
}
