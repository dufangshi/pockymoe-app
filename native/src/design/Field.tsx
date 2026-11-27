import { useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { AppText } from './AppText';
import { IconButton } from './Button';
import { useTheme } from './theme';
import { ErrorMark } from './ErrorMark';
import { translate } from '../i18n';

export interface FieldProps extends TextInputProps { label: string; error?: string | null; hint?: string | null; secret?: boolean; ref?: Ref<ComponentRef<typeof TextInput>>;
  /** The raw reason behind a short error, opened from an ErrorMark (§11) instead of printed. */
  errorDetail?: string | null;
  /** Beside the label, right-aligned (a link such as Forgot password?). */
  labelAccessory?: ReactNode }
/** Labelled text input; the label is always visible (§12). Secrets get a show/hide toggle. */
export function Field({ label, error, hint, secret, style, ref, errorDetail, labelAccessory, ...rest }: FieldProps) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const [shown, setShown] = useState(false);
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <AppText variant="subhead" tone="soft">{label}</AppText>
        {labelAccessory}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: focused ? 2 : 1, borderColor: error ? t.c.failed : focused ? t.c.primary : t.c.borderStrong,
        borderRadius: t.radius.md, backgroundColor: t.c.bg, paddingLeft: focused ? 11 : 12, minHeight: 48 }}>
        <TextInput ref={ref} accessibilityLabel={label} placeholderTextColor={t.c.fgMuted} selectionColor={t.c.primary}
          secureTextEntry={secret && !shown} autoCapitalize="none" autoCorrect={false}
          onFocus={e => { setFocused(true); rest.onFocus?.(e); }} onBlur={e => { setFocused(false); rest.onBlur?.(e); }}
          style={[{ flex: 1, color: t.c.fg, fontFamily: t.font.regular, fontSize: 16, paddingVertical: 10 }, style]} {...rest} />
        {secret ? <IconButton icon={shown ? EyeOff : Eye} label={shown ? translate('native.hide') : translate('native.show')} onPress={() => setShown(v => !v)} tone="muted" /> : null}
      </View>
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 5 }}>
          <AppText variant="footnote" tone="danger" style={{ flexShrink: 1 }} accessibilityLiveRegion="polite">{error}</AppText>
          {errorDetail ? <ErrorMark reason={errorDetail} size={14} /> : null}
        </View>
      )
        : hint ? <AppText variant="footnote" tone="muted" style={{ marginTop: 5 }}>{hint}</AppText> : null}
    </View>
  );
}
