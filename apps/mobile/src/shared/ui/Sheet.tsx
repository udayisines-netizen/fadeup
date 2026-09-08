/* eslint-disable react-hooks/immutability --
 * Les shared values Reanimated s'écrivent PAR CONTRAT via `.value` depuis
 * les callbacks de geste et de fermeture (le motif documenté Reanimated).
 * La règle `immutability` du React Compiler ne connaît pas ce contrat ;
 * le composant porte déjà `'use no memo'` pour que le compilateur le saute.
 */
import { type ReactNode, useCallback, useEffect } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { color, radius, shadow, sheetSpring } from '@/shared/theme/tokens'
import { usePrefersReducedMotion } from '@/shared/hooks/usePrefersReducedMotion'

/**
 * LA feuille qui remonte — primitive native de première classe (M1a §4 :
 * « meilleure que sa version web, pas identique »). Une seule feuille dans
 * l'app, comme le web (D1 §5 : ne pas écrire une deuxième feuille).
 *
 * - Ressort D1 (stiffness 420 / damping 36) à l'ouverture, geste de
 *   fermeture par glissement depuis la zone d'en-tête (hero + poignée),
 *   suivi du doigt en direct, retour en ressort sous le seuil.
 * - La liste reste dessous (Modal transparent) : la position de défilement
 *   est préservée par construction.
 * - Réduction d'animations : fondu < 100 ms, AUCUNE translation.
 * - Fermeture : glissement, scrim, retour système Android (onRequestClose).
 *
 * `hero` : contenu média pleine largeur en tête (variante feuille de
 * résultat) — c'est LUI qui porte le geste de glissement, comme la zone
 * d'en-tête de 90 px du web.
 */

const CLOSE_DISTANCE = 90
const CLOSE_VELOCITY = 800

export interface SheetProps {
  open: boolean
  onClose: () => void
  /** Libellé d'accessibilité de la feuille. */
  title: string
  hero?: ReactNode
  children: ReactNode
}

export function Sheet({ open, onClose, title, hero, children }: SheetProps) {
  // Reanimated écrit dans ses shared values depuis les callbacks de geste —
  // exactement ce que le React Compiler interdit de mémoïser : on le
  // désactive ICI (directive officielle), le reste de l'app le garde.
  'use no memo'
  const { t } = useTranslation('v2')
  const reduced = usePrefersReducedMotion()
  const { height: screenHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()

  const translateY = useSharedValue(screenHeight)
  const opacity = useSharedValue(0)

  useEffect(() => {
    if (open) {
      if (reduced) {
        translateY.value = 0
        opacity.value = withTiming(1, { duration: 90 })
      } else {
        opacity.value = withTiming(1, { duration: 120 })
        translateY.value = withSpring(0, sheetSpring)
      }
    }
  }, [open, reduced, translateY, opacity, screenHeight])

  const requestClose = useCallback(() => {
    if (reduced) {
      opacity.value = withTiming(0, { duration: 90 }, () => runOnJS(onClose)())
    } else {
      opacity.value = withTiming(0, { duration: 160 })
      translateY.value = withTiming(screenHeight, { duration: 200 }, () => runOnJS(onClose)())
    }
  }, [reduced, onClose, opacity, translateY, screenHeight])

  const pan = Gesture.Pan()
    .enabled(!reduced)
    .onChange((event) => {
      // Suivi du doigt vers le bas seulement — vers le haut, résistance nulle.
      translateY.value = Math.max(0, translateY.value + event.changeY)
    })
    .onEnd((event) => {
      if (translateY.value > CLOSE_DISTANCE || event.velocityY > CLOSE_VELOCITY) {
        opacity.value = withTiming(0, { duration: 160 })
        translateY.value = withTiming(screenHeight, { duration: 200 }, () => runOnJS(onClose)())
      } else {
        translateY.value = withSpring(0, sheetSpring)
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }))
  const scrimStyle = useAnimatedStyle(() => ({ opacity: opacity.value }))

  if (!open) return null

  return (
    <Modal transparent visible animationType="none" onRequestClose={requestClose} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, scrimStyle]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.action.close')}
            style={[StyleSheet.absoluteFill, styles.scrim]}
            onPress={requestClose}
          />
        </Animated.View>

        {/* Ombre sur l'enveloppe, rognage sur l'intérieur (contrainte iOS). */}
        <Animated.View
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={[
            styles.sheet,
            shadow.sheet,
            { maxHeight: screenHeight * 0.86, paddingBottom: insets.bottom + 16 },
            sheetStyle,
          ]}
        >
          <View style={styles.sheetInner}>
          <GestureDetector gesture={pan}>
            <View>
              {hero ? (
                <View style={styles.hero}>{hero}</View>
              ) : null}
              <View
                style={[styles.handleZone, !hero && styles.handleZoneInFlow]}
                collapsable={false}
              >
                <View style={[styles.handle, !hero && styles.handleOnSurface]} />
              </View>
            </View>
          </GestureDetector>
          <ScrollView
            bounces={false}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: color.scrim },
  sheet: {
    backgroundColor: color.surface,
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
  },
  sheetInner: {
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
    overflow: 'hidden',
    flexShrink: 1,
  },
  hero: { position: 'relative' },
  handleZone: {
    position: 'absolute',
    top: 0,
    insetInlineStart: 0,
    insetInlineEnd: 0,
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: radius.avatar,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  handleOnSurface: { backgroundColor: color.borderStrong },
  handleZoneInFlow: { position: 'relative' },
  content: { paddingHorizontal: 16, paddingTop: 12 },
})
