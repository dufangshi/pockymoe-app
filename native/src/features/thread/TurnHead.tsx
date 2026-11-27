// The top of a turn, as the Web's TurnHead (shared UI timeline/TurnHead.tsx): a dot with the
// time the turn worked and its cost between two rules; a tap opens one more line with the start
// time, the model and effort, and the speed. Plum Pocket dashes the rules and the cost pill;
// Terminal aligns the line left.
import { useState } from 'react';
import { View } from 'react-native';
import { Coins } from 'lucide-react-native';
import type { ThreadTurnDto } from '@pockymoe/shared';
import { formatDurationSeconds } from '../../../vendor/pockymoe/thread-ui/components/timeline/durationFormatting';
import { AppText } from '../../design/AppText';
import { Press } from '../../design/Press';
import { Rule } from '../../design/Rule';
import { withAlpha } from '../../design/contrast';
import { useTheme } from '../../design/theme';
import { getLocale, translate } from '../../i18n';
import { formatCompactTokenCount, formatCompactUsd, shortModelName } from './turnFormat';

type Status = 'done' | 'running' | 'failed' | 'interrupted';

const clock = (at: string, withDate: boolean) => {
  const d = new Date(at);
  return withDate
    ? d.toLocaleString(getLocale(), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : d.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' });
};

function Dot({ status }: { status: Status }) {
  const t = useTheme();
  const ok = t.terminal ? (t.mode === 'dark' ? '#4de3a2' : '#00692c') : '#2fb37a';
  if (status === 'failed') return <View style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: '#d56b62', transform: [{ rotate: '45deg' }, { scale: 0.9 }] }} />;
  if (status === 'interrupted') return <View style={{ width: 7, height: 7, borderRadius: 1.5, backgroundColor: '#c08a3e' }} />;
  const running = status === 'running';
  return (
    <View style={{ width: running ? 13 : 7, height: running ? 13 : 7, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: running ? withAlpha(ok, 0.2) : 'transparent', margin: running ? -3 : 0 }}>
      <View style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: ok, opacity: running ? 1 : 0.55 }} />
    </View>
  );
}

export function TurnHead({ turn, status, now }: { turn: ThreadTurnDto; status: Status; now: number }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [withDate, setWithDate] = useState(false);
  const started = turn.startedAt ? Date.parse(turn.startedAt) : NaN;
  const end = status === 'running' ? now : Date.parse(turn.completedAt ?? '');
  const took = Number.isFinite(started) && Number.isFinite(end) ? formatDurationSeconds(Math.max(0, Math.floor((end - started) / 1000))) : null;
  const usage = turn.tokenUsage?.total;
  const price = turn.priceEstimate?.totalUsd;
  const speed = turn.tokenUsage?.generationSpeed;
  const rate = status === 'running' ? speed?.averageOutputTokensPerSecond : speed?.averageOutputTokensPerSecond ?? speed?.averageTokensPerSecond;
  const effort = turn.reasoningEffort?.trim();
  const model = turn.model ? `${shortModelName(turn.model)}${effort ? ` · ${effort}` : ''}` : null;
  const ruleColor = t.terminal ? t.c.borderStrong : t.c.border;
  const rule = (fixed?: number) => <Rule color={ruleColor} width={t.plum ? 1.5 : 1} dashed={t.plum} style={fixed ? { width: fixed } : { flex: 1, minWidth: 12 }} />;
  const muted = t.c.fgMuted;
  const fontSize = t.plum ? 11.5 : 11;
  const chip = price != null && price > 0 ? formatCompactUsd(price) : usage?.totalTokens ? formatCompactTokenCount(usage.totalTokens) : null;
  const more = [
    turn.startedAt ? { key: 'time', text: clock(turn.startedAt, withDate), onPress: () => setWithDate(v => !v) } : null,
    model ? { key: 'model', text: model } : null,
    rate != null && Number.isFinite(rate) && rate > 0 ? { key: 'speed', text: translate('chat.turnHeadSpeed', { value: rate >= 10 ? Math.round(rate) : rate.toFixed(1) }) } : null,
  ].filter(Boolean) as { key: string; text: string; onPress?: () => void }[];
  const label = took ? translate(status === 'running' ? 'chat.turnHeadRunning' : 'chat.turnHeadWorked', { elapsed: took }) : translate('chat.turnHeadDetails');
  return (
    <View style={{ marginTop: 4, marginBottom: 2 }}>
      <Press onPress={more.length ? () => setOpen(v => !v) : undefined} feedback="none" accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={label}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 24, justifyContent: t.terminal ? 'flex-start' : 'center' }}>
        {t.terminal ? rule(16) : rule()}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 3 }}>
          <Dot status={status} />
          {took ? <AppText variant="caption" color={status === 'running' || open ? t.c.fg : muted} style={{ fontSize, lineHeight: 20, fontVariant: ['tabular-nums'] }}>{took}</AppText> : null}
        </View>
        {chip ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: t.plum ? 8 : 5, minHeight: t.plum ? 22 : 18, justifyContent: 'center',
            borderRadius: t.terminal ? 0 : t.plum ? 999 : 6, borderWidth: t.plum ? 1.5 : 1, borderStyle: t.plum ? 'dashed' : 'solid',
            borderColor: t.plum ? t.c.borderStrong : t.c.border, backgroundColor: t.plum ? (t.mode === 'dark' ? '#21142a' : '#fffdf8') : t.c.panel }}>
            {price == null || price <= 0 ? <Coins size={12} color={muted} /> : null}
            <AppText variant="caption" weight={t.plum ? 'bold' : 'regular'} style={{ fontSize, lineHeight: 16, fontVariant: ['tabular-nums'] }}
              color={price != null && price > 0 ? (t.plum ? (t.mode === 'dark' ? '#ffd27f' : '#6f4700') : t.c.accentStrong) : muted}>{chip}</AppText>
          </View>
        ) : null}
        {rule()}
      </Press>
      {open && more.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: t.terminal ? 'flex-start' : 'center', columnGap: 12, rowGap: 2, marginBottom: 6, marginLeft: t.terminal ? 24 : 0 }}>
          {more.map(m => (
            <AppText key={m.key} variant="caption" color={muted} onPress={m.onPress} numberOfLines={1}
              style={{ fontSize, lineHeight: 20, fontVariant: ['tabular-nums'], textDecorationLine: m.onPress ? 'underline' : 'none', textDecorationStyle: 'dotted' }}>{m.text}</AppText>
          ))}
        </View>
      ) : null}
    </View>
  );
}
