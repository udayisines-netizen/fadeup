import { forwardRef } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'

import { color, radius, spacing, touchTarget } from '@/shared/theme/tokens'
import { FuText } from '@/shared/ui/Text'

/**
 * Champ de saisie du tunnel — étiquette VISIBLE (jamais un placeholder en
 * guise d'étiquette), indice optionnel, erreur annoncée.
 *
 * La validation est la NÔTRE : rien ne délègue à une validation de
 * plate-forme qui parlerait une autre langue que l'interface (correctif F4
 * §11.2.1, transposé — `noValidate` du web devient « aucune validation
 * implicite » ici).
 */
export interface FormFieldProps extends TextInputProps {
  label: string
  hint?: string
  error?: string
}

export const FormField = forwardRef<TextInput, FormFieldProps>(function FormField(
  { label, hint, error, style, ...rest },
  ref,
) {
  return (
    <View style={styles.field}>
      <FuText variant="smMedium">{label}</FuText>
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={color.textTertiary}
        {...rest}
        style={[styles.input, error ? styles.inputError : null, style]}
      />
      {error ? (
        <FuText variant="sm" tone="danger" accessibilityRole="alert">
          {error}
        </FuText>
      ) : hint ? (
        <FuText variant="sm" tone="secondary">
          {hint}
        </FuText>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  field: { gap: spacing(1.5) },
  input: {
    minHeight: touchTarget + 8,
    paddingHorizontal: spacing(4),
    paddingVertical: spacing(2.5),
    borderRadius: radius.control,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    fontSize: 16,
    color: color.textPrimary,
  },
  inputError: { borderColor: color.danger },
})
