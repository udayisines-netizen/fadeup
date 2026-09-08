import { Stack } from 'expo-router'
import { color } from '@/shared/theme/tokens'

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: color.canvas },
      }}
    />
  )
}
