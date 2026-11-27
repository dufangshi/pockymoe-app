// Small pieces of the Git inspector: view chips, change letters, file rows, counts.
import type { ComponentType, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { LucideProps } from 'lucide-react-native';
import { Minus, Plus } from 'lucide-react-native';
import { fileChange, type FileChange } from '@pockymoe/web-git/patch';
import { gitText as gt } from '@pockymoe/web/gitI18n';
import { AppText } from '../../design/AppText';
import { IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { useTheme, type Theme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { formatNumber } from '../../i18n';
import { Stat } from '../diff/DiffViewer';
import { diffPrefs } from '../diff/prefs';

export { fileChange, type FileChange };
export const CHANGE_LETTER: Record<FileChange, string> = { untracked: 'U', added: 'A', modified: 'M', deleted: 'D', renamed: 'R', copied: 'C', conflicted: '!', typeChanged: 'T', changed: '•' };
export const baseName = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
export const dirName = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
export const shortOid = (oid: string) => oid.slice(0, 7);

export function changeColor(t: Theme, change: FileChange) {
  const cb = diffPrefs.get().colorblind;
  switch (change) {
    case 'added': case 'untracked': return cb ? t.c.info : t.c.success;
    case 'deleted': return cb ? t.c.warning : t.c.danger;
    case 'conflicted': return t.c.failed;
    case 'renamed': case 'copied': return t.c.accentStrong;
    default: return t.c.warning;
  }
}

/** The change as a letter with its colour; the word is for screen readers. */
export function ChangeLetter({ change }: { change: FileChange }) {
  const t = useTheme();
  const color = changeColor(t, change);
  return (
    <View accessible accessibilityLabel={gt(change)} style={{ width: 20, height: 20, borderRadius: t.radius.xs, borderWidth: 1, borderColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <AppText variant="caption" weight="semibold" color={color} style={{ fontFamily: t.font.mono, fontSize: 11, lineHeight: 14 }}>{CHANGE_LETTER[change]}</AppText>
    </View>
  );
}

export interface ChipOption<T extends string> { value: T; label: string; count?: number | null; icon?: ComponentType<LucideProps> }
/** One row of scope chips that scrolls sideways on a phone (Turn, PR, Unstaged, …). */
export function ViewChips<T extends string>({ value, options, onChange, label }: { value: T; options: ChipOption<T>[]; onChange(v: T): void; label: string }) {
  const t = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" accessibilityLabel={label}
      contentContainerStyle={{ gap: 6, paddingHorizontal: 10, paddingVertical: 6 }} style={{ flexGrow: 0 }}>
      {options.map(o => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <Press key={o.value} onPress={() => { if (!on) { haptic.selection(); onChange(o.value); } }} feedback="dim" accessibilityRole="tab" accessibilityState={{ selected: on }}
            accessibilityLabel={o.count === undefined || o.count === null ? o.label : `${o.label}, ${o.count}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 12, borderRadius: t.radius.pill, borderWidth: 1,
              borderColor: on ? t.c.primary : t.c.border, backgroundColor: on ? t.c.primary : t.c.surface }}>
            {Icon ? <Icon size={14} color={on ? t.c.primaryFg : t.c.fgSoft} /> : null}
            <AppText variant="subhead" weight="medium" color={on ? t.c.primaryFg : t.c.fg}>{t.terminal && on ? `[${o.label}]` : o.label}</AppText>
            {o.count !== undefined && o.count !== null ? <AppText variant="caption" color={on ? t.c.primaryFg : o.count ? t.c.fgSoft : t.c.fgMuted} style={{ opacity: o.count ? 1 : 0.7 }}>{formatNumber(o.count)}</AppText> : null}
          </Press>
        );
      })}
    </ScrollView>
  );
}

export interface ListedFile { path: string; change: FileChange; originalPath?: string | undefined; additions?: number; deletions?: number; binary?: boolean }

/** One changed file: letter, name, directory, counts; a tap opens its diff alone. The
    trailing control stages or unstages; a long press offers everything else. */
export function FileRow({ file, selected, onOpen, onLongPress, action, trailing }: {
  file: ListedFile; selected?: boolean; onOpen(): void; onLongPress?: () => void;
  action?: { kind: 'stage' | 'unstage'; busy: boolean; run(): void } | null; trailing?: ReactNode;
}) {
  const t = useTheme();
  const name = baseName(file.path);
  const dir = (file.originalPath ? `← ${baseName(file.originalPath)} ` : '') + dirName(file.path);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: selected ? t.c.accentSoft : 'transparent' }}>
      <Press onPress={onOpen} onLongPress={onLongPress} style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingLeft: 12, paddingRight: 4 }}
        accessibilityRole="button" accessibilityLabel={`${gt(file.change)} ${file.path}`} accessibilityState={{ selected: !!selected }}>
        <ChangeLetter change={file.change} />
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
          <AppText variant="callout" numberOfLines={1} ellipsizeMode="middle" style={{ flexShrink: 0, maxWidth: '72%' }}>{name}</AppText>
          {dir ? <AppText variant="caption" tone="muted" numberOfLines={1} ellipsizeMode="head" style={{ flexShrink: 1 }}>{dir}</AppText> : null}
        </View>
        {file.binary ? <AppText variant="caption" tone="muted">{gt('binary')}</AppText> : <Stat additions={file.additions} deletions={file.deletions} />}
      </Press>
      {action ? <IconButton icon={action.kind === 'stage' ? Plus : Minus} size={18} label={`${gt(action.kind)} ${file.path}`} onPress={action.run} disabled={action.busy} /> : null}
      {trailing}
    </View>
  );
}

/** A small labelled count beside the branch (↑ to push, ↓ to pull). */
export function Badge({ text, tone = 'muted', label }: { text: string; tone?: 'muted' | 'accent' | 'warning' | 'danger'; label?: string }) {
  const t = useTheme();
  const color = { muted: t.c.fgMuted, accent: t.c.accentStrong, warning: t.c.warning, danger: t.c.danger }[tone];
  return (
    <View accessible accessibilityLabel={label ?? text} style={{ paddingHorizontal: 6, height: 20, borderRadius: t.radius.pill, borderWidth: 1, borderColor: color, justifyContent: 'center' }}>
      <AppText variant="caption" color={color} style={{ lineHeight: 14 }}>{text}</AppText>
    </View>
  );
}
