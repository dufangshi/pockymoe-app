// The thread's context use beside the composer's send button (the Web's composer context
// control, total only): a ring in the tone the Web uses (warning from 60%, danger from 80%),
// and on tap a sheet with the figures and Compact. Category analysis stays on the Web.
import { useState } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import type { ThreadContextUsageDto } from '@pockymoe/shared';
import { contextAge, contextPercent, contextTone, formatContextPercent, formatContextTokens, readingFromUsage } from '../../../vendor/pockymoe/thread-ui/components/composer/contextInspectionModel';
import { AppText } from '../../design/AppText';
import { Button } from '../../design/Button';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { withAlpha } from '../../design/contrast';
import { translate } from '../../i18n';

/** `bar`: the Web's composer context bar under the model key (8 pt tall, a 3 pt fill: blue,
 *  amber from 60%, red from 80%); `ring` keeps the older ring for other places. */
export function ContextMeter({ usage, running, onCompact, variant = 'ring', width }: { usage: ThreadContextUsageDto | null | undefined; running: boolean; onCompact?: () => Promise<void>; variant?: 'ring' | 'bar'; width?: number }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const reading = readingFromUsage(usage);
  if (!reading) return null;
  const percent = contextPercent(reading.used, reading.window);
  const tone = contextTone(reading.used, reading.window);
  const color = tone === 'danger' ? t.c.failed : tone === 'warning' ? t.c.waiting : t.c.fgSoft;
  const label = translate('chat.contextMeterLabel', { percent: formatContextPercent(reading.used, reading.window, true), used: formatContextTokens(reading.used), total: formatContextTokens(reading.window) });
  const size = 22, stroke = 3, r = (size - stroke) / 2, length = 2 * Math.PI * r;
  const compact = async () => {
    if (!onCompact) return;
    setCompacting(true);
    try { await onCompact(); setOpen(false); showToast(translate('chat.compactingContext')); }
    catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); }
    finally { setCompacting(false); }
  };
  const barColor = tone === 'danger' ? '#c5302f' : tone === 'warning' ? '#b25e00' : t.plum || t.terminal ? t.c.primary : '#2a78d6';
  const trigger = variant === 'bar' ? (
    <Press onPress={() => setOpen(true)} feedback="dim" accessibilityRole="button" accessibilityLabel={label} testID="context-meter"
      style={{ height: 8, paddingTop: 2, paddingBottom: 3, paddingHorizontal: 2, borderRadius: 2, width }} hitSlop={{ top: 8, bottom: 8 }}>
      <View style={{ height: 3, borderRadius: t.terminal ? 0 : 2, backgroundColor: withAlpha(t.c.fgMuted, 0.22), overflow: 'hidden' }}>
        <View style={{ width: `${percent}%`, height: '100%', backgroundColor: barColor }} />
      </View>
    </Press>
  ) : null;
  return (
    <>
      {trigger ?? <Press onPress={() => setOpen(true)} feedback="dim" accessibilityRole="button" accessibilityLabel={label} testID="context-meter"
        style={{ minWidth: 40, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4 }}>
        <Svg width={size} height={size} style={{ transform: [{ rotate: '-90deg' }] }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={t.c.border} strokeWidth={stroke} fill="none" />
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap={t.terminal ? 'butt' : 'round'}
            strokeDasharray={`${(length * percent) / 100} ${length}`} />
        </Svg>
        {tone !== 'normal' ? <AppText variant="caption" weight="semibold" color={color}>{formatContextPercent(reading.used, reading.window)}</AppText> : null}
      </Press>}
      <Sheet visible={open} onClose={() => setOpen(false)} title={translate('chat.context')}
        footer={onCompact ? <Button label={translate('chat.contextCompact')} kind="primary" busy={compacting} disabled={running} onPress={() => void compact()} testID="context-compact" /> : undefined}>
        <View style={{ gap: 10 }}>
          <AppText variant="title" color={tone === 'normal' ? t.c.fg : color}>{formatContextPercent(reading.used, reading.window, true)}</AppText>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden' }}>
            <View style={{ width: `${percent}%`, height: '100%', backgroundColor: tone === 'normal' ? t.c.primary : color }} />
          </View>
          <AppText variant="callout" tone="soft">{`${formatContextTokens(reading.used)} / ${formatContextTokens(reading.window)} · ${translate('chat.contextRemaining', { value1: formatContextTokens(Math.max(0, reading.window - reading.used)) })}`}</AppText>
          {contextAge(reading.updatedAt) ? <AppText variant="footnote" tone="muted">{contextAge(reading.updatedAt)}</AppText> : null}
        </View>
      </Sheet>
    </>
  );
}
