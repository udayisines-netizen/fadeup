import { Tabs } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Ionicons } from '@expo/vector-icons'
import { color, font } from '@/shared/theme/tokens'

/**
 * Les CINQ onglets, cet ordre, verrouillés (MASTER_SPEC §3, D1 §0bis) :
 * Accueil · Recherche · Feed · Réservations · Compte.
 * Book n'est JAMAIS un onglet — c'est le CTA contextuel des profils et de
 * la feuille de résultat.
 *
 * Libellés en Medium (500) — la convention D1 de la nav basse (12 px comme
 * le web, le seul texte de ce corps hors badges).
 */
export default function TabsLayout() {
  const { t } = useTranslation('v2')

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: color.accentText,
        tabBarInactiveTintColor: color.textTertiary,
        tabBarStyle: {
          backgroundColor: color.surface,
          borderTopColor: color.border,
        },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 12 },
        sceneStyle: { backgroundColor: color.canvas },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.tabs.home'),
          tabBarIcon: ({ color: tint, size }) => <Ionicons name="home-outline" color={tint} size={size} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: t('nav.tabs.search'),
          tabBarIcon: ({ color: tint, size }) => <Ionicons name="search-outline" color={tint} size={size} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: t('nav.tabs.feed'),
          tabBarIcon: ({ color: tint, size }) => <Ionicons name="albums-outline" color={tint} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          title: t('nav.tabs.bookings'),
          tabBarIcon: ({ color: tint, size }) => <Ionicons name="calendar-outline" color={tint} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: t('nav.tabs.account'),
          tabBarIcon: ({ color: tint, size }) => <Ionicons name="person-outline" color={tint} size={size} />,
        }}
      />
    </Tabs>
  )
}
