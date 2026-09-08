import { StyleSheet, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import { FuText } from '@/shared/ui/Text'
import { OptionRow } from '@/shared/ui/OptionRow'
import { setLocaleOverride, V2_LOCALES, type V2Locale } from '@/shared/i18n'
import { color, radius, spacing } from '@/shared/theme/tokens'

/**
 * Compte — placeholder honnête (M1b construit la connexion, le Passport,
 * les préférences). SEUL réglage réel dès M1a : la langue — le choix
 * explicite est une exigence transverse de globalisation, persisté et
 * prioritaire sur la langue de l'appareil.
 */
export default function AccountTab() {
  const { t, i18n } = useTranslation('v2')

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.body}>
        <View style={styles.placeholder}>
          <View style={styles.iconFrame}>
            <Ionicons name="person-outline" size={28} color={color.accentText} />
          </View>
          <FuText variant="title" style={styles.center}>
            {t('mobile.placeholder.account.title')}
          </FuText>
          <FuText variant="sm" tone="secondary" style={styles.center}>
            {t('mobile.placeholder.account.body')}
          </FuText>
        </View>

        <View style={styles.language}>
          <FuText variant="smMedium" tone="secondary">
            {t('mobile.language.label')}
          </FuText>
          {V2_LOCALES.map((locale: V2Locale) => (
            <OptionRow
              key={locale}
              label={t(`mobile.language.${locale}`)}
              selected={i18n.language === locale}
              onPress={() => {
                void setLocaleOverride(locale)
              }}
            />
          ))}
        </View>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: color.canvas },
  body: { flex: 1, paddingHorizontal: spacing(5), justifyContent: 'center', gap: spacing(10) },
  placeholder: { alignItems: 'center', gap: spacing(2.5) },
  iconFrame: {
    width: 64,
    height: 64,
    borderRadius: radius.card,
    backgroundColor: color.surfaceBrand,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing(1),
  },
  center: { textAlign: 'center' },
  language: { gap: spacing(2) },
})
