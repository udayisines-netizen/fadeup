import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera'

import { color, radius, spacing } from '@/shared/theme/tokens'
import { Button } from '@/shared/ui/Button'
import { FuText } from '@/shared/ui/Text'

/**
 * M1b — le scan du QR du salon, en NATIF (remplace `shared/ui/QRScanner.tsx`
 * du web et son décodeur navigateur).
 *
 * Deux règles tiennent ce composant :
 *  1. la permission caméra est demandée AU MOMENT DU SCAN, jamais avant :
 *     ce composant n'est monté que pendant l'étape « scan » du join ;
 *  2. le flux caméra est LIBÉRÉ au démontage — c'est la conséquence directe
 *     de (1) : quitter l'étape démonte `CameraView`, donc éteint la caméra.
 *     Aucun aperçu caché ne reste actif (le voyant vert de l'appareil le
 *     trahirait, et ce serait un mensonge de plus qu'une fonctionnalité).
 *
 * La lecture est verrouillée après chaque code lu, puis rouverte après deux
 * secondes : un QR refusé (autre salon, jeton mal formé) doit pouvoir être
 * re-visé sans refermer la feuille, sans que la caméra rejoue vingt fois le
 * même code entre-temps.
 */

const RESCAN_DELAY_MS = 2_000

export interface QrScannerProps {
  /** Valeur brute du QR — l'appelant décide (parseQueueLink). */
  onScan: (value: string) => void
}

export function QrScanner({ onScan }: QrScannerProps) {
  const { t } = useTranslation('v2')
  const [permission, requestPermission] = useCameraPermissions()
  const [locked, setLocked] = useState(false)
  const asked = useRef(false)

  // La demande part au montage du SCANNER, c'est-à-dire au geste de scan.
  useEffect(() => {
    if (!permission || asked.current) return
    if (!permission.granted && permission.canAskAgain) {
      asked.current = true
      void requestPermission()
    }
  }, [permission, requestPermission])

  useEffect(() => {
    if (!locked) return
    const id = setTimeout(() => setLocked(false), RESCAN_DELAY_MS)
    return () => clearTimeout(id)
  }, [locked])

  if (!permission) {
    // Statut pas encore connu : on n'affirme ni refus, ni autorisation.
    return (
      <View style={styles.frame} accessibilityLabel={t('mobile.queuex.scanTitle')}>
        <ActivityIndicator color={color.accentText} />
      </View>
    )
  }

  if (!permission.granted) {
    const askable = permission.canAskAgain
    return (
      <View style={styles.denied}>
        <FuText variant="sm" tone="secondary" style={styles.center}>
          {askable ? t('mobile.queuex.cameraPermissionBody') : t('mobile.queuex.cameraDenied')}
        </FuText>
        <Button
          label={askable ? t('mobile.queuex.scanTitle') : t('mobile.queuex.openSettings')}
          variant="secondary"
          fullWidth
          onPress={() => {
            if (askable) void requestPermission()
            else void Linking.openSettings()
          }}
        />
      </View>
    )
  }

  const handleScan = (result: BarcodeScanningResult) => {
    if (locked) return
    setLocked(true)
    onScan(result.data)
  }

  return (
    <View style={styles.frame} accessibilityLabel={t('mobile.queuex.scanTitle')}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={locked ? undefined : handleScan}
      />
      <View style={styles.reticle} accessibilityElementsHidden />
    </View>
  )
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: color.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticle: {
    width: '62%',
    aspectRatio: 1,
    borderWidth: 2,
    borderColor: color.accent,
    borderRadius: radius.card,
  },
  denied: {
    gap: spacing(3),
    paddingVertical: spacing(4),
  },
  center: { textAlign: 'center' },
})
