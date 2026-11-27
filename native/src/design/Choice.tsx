// The Web's form controls (shared form-controls.css) drawn natively: a square checkbox, a
// radio card (bordered box, radio circle, title and description) and a select button that
// opens the one menu. Appearance follows the theme; behaviour and roles stay native.
import { useRef, type ComponentRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { Check, ChevronDown } from 'lucide-react-native';
import { AppText } from './AppText';
import { Press } from './Press';
import { showMenu } from './Overlay';
import { useTheme } from './theme';

export function Checkbox({ value, onValueChange, label, disabled }: { value: boolean; onValueChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Press onPress={() => onValueChange(!value)} disabled={disabled} feedback="dim" hitSlop={10} accessibilityRole="checkbox" accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={{ width: 20, height: 20, borderRadius: t.terminal ? 0 : 5, borderWidth: value ? 0 : 1.5, borderColor: t.c.borderContrast,
        backgroundColor: value ? t.c.primarySolid : t.c.bg, alignItems: 'center', justifyContent: 'center' }}>
      {value ? <Check size={14} color={t.c.primaryFg} strokeWidth={3} /> : null}
    </Press>
  );
}

function RadioDot({ on }: { on: boolean }) {
  const t = useTheme();
  return (
    <View style={{ width: 18, height: 18, borderRadius: t.terminal ? 0 : 9, borderWidth: on ? 5 : 1.5, borderColor: on ? t.c.primarySolid : t.c.borderContrast, backgroundColor: on ? t.c.primaryFg : t.c.bg }} />
  );
}

/** One option of a radio group as the Web draws it: a bordered card. */
export function RadioCard({ selected, title, description, onPress, disabled, testID }: { selected: boolean; title: string; description?: string; onPress: () => void; disabled?: boolean; testID?: string }) {
  const t = useTheme();
  return (
    <Press onPress={onPress} disabled={disabled} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !!disabled }} accessibilityLabel={title}
      accessibilityHint={description} testID={testID} radius={t.radius.md}
      style={{ flexDirection: 'row', gap: 12, padding: 14, borderRadius: t.radius.md, borderWidth: 1, borderColor: selected ? t.c.accentBorder : t.c.border, backgroundColor: t.c.panel }}>
      <View style={{ paddingTop: 2 }}><RadioDot on={selected} /></View>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="callout" weight="medium">{title}</AppText>
        {description ? <AppText variant="footnote" tone="soft">{description}</AppText> : null}
      </View>
    </Press>
  );
}

export function RadioCards<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: { value: T; title: string; description?: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ gap: 8 }}>
      {options.map(o => <RadioCard key={o.value} selected={o.value === value} title={o.title} description={o.description} disabled={disabled}
        onPress={() => { if (o.value !== value) onChange(o.value); }} testID={`radio-${o.value}`} />)}
    </View>
  );
}

/** The Web's Select: a bordered button with the current value and a chevron; opens a menu. */
export function SelectButton<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const current = options.find(o => o.value === value)?.label ?? value;
  const open = () => ref.current?.measureInWindow((x, y, width, height) => showMenu({ anchor: { x, y, width, height }, title: label,
    items: options.map(o => ({ label: o.label, checked: o.value === value, onPress: () => onChange(o.value) })) }));
  return (
    <View ref={ref} collapsable={false}>
      <Press onPress={open} feedback="dim" accessibilityRole="button" accessibilityLabel={`${label}: ${current}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 40, paddingHorizontal: 12, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.panel }}>
        <AppText variant="callout">{current}</AppText>
        <ChevronDown size={15} color={t.c.fgMuted} />
      </Press>
    </View>
  );
}

/** A settings section the Web way: a title, a muted description, the control, a rule above. */
export function SettingBlock({ title, description, inline, children, first, accessory }: { title: string; description?: string | null; inline?: ReactNode; children?: ReactNode; first?: boolean; accessory?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ paddingVertical: 16, gap: 10, borderTopWidth: first ? 0 : 1, borderTopColor: t.c.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText variant="headline" style={{ fontSize: 15 }} accessibilityRole="header">{title}</AppText>
            {accessory}
          </View>
          {description ? <AppText variant="footnote" tone="soft">{description}</AppText> : null}
        </View>
        {inline}
      </View>
      {children}
    </View>
  );
}
