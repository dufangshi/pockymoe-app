// An agent's mark, as the Web draws it (AgentChip, thread-map.css `.thread-map-agent`): the
// theme pack's art for the agent (Plum Pocket's avatars, Terminal's square tags), else a
// two-letter monogram in the agent's own colour (Classic). Lists, the composer, the dock, the
// new-thread form and the model picker all use it, so an agent looks the same everywhere.
import { View } from 'react-native';
import { Image } from 'expo-image';
import { themeAgentKey } from '../../vendor/pockymoe/thread-ui/components/themeAgent';
import { PLUM_AVATARS } from './agentArt';
import { TERMINAL_MARKS } from './terminalMarks.generated';
import { withAlpha } from './contrast';
import { AppText } from './AppText';
import { agentMonogram } from './agentMonogram';
import { useTheme } from './theme';

export { agentMonogram };

const COLORS: Record<string, string> = {
  claude: '#c96442', codex: '#0f8a69', gemini: '#3b78e7', deepseek: '#4d6bfe', copilot: '#8250df', opencode: '#475569', grok: '#3f3f46', cursor: '#27272a', qwen: '#615ced', kimi: '#0b84c6',
};

export function AgentMark({ agent, size = 28, label }: { agent: string | null | undefined; size?: number; label?: string }) {
  const t = useTheme();
  const key = themeAgentKey(agent) ?? 'agent';
  const a11y = label ? { accessible: true, accessibilityLabel: label } : { accessible: false };
  const art = t.plum ? PLUM_AVATARS[key] ?? PLUM_AVATARS.agent : undefined;
  if (art) return <Image source={art} style={{ width: size, height: size, borderRadius: size / 2 }} {...a11y} />;
  const tag = t.terminal ? TERMINAL_MARKS[key] ?? TERMINAL_MARKS.agent : undefined;
  if (tag) {
    // The pack's 32-unit SVG square, drawn natively: fill, an inset frame, the monogram.
    const unit = size / 32;
    return (
      <View {...a11y} style={{ width: size, height: size, backgroundColor: tag.fill, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', left: unit, top: unit, right: unit, bottom: unit, borderWidth: Math.max(1, unit), borderColor: withAlpha(tag.stroke, tag.strokeOpacity) }} />
        <AppText variant="caption" color={tag.color} maxFontSizeMultiplier={1}
          style={{ fontFamily: t.font.monoBold, fontWeight: '700', fontSize: tag.fontSize * unit, lineHeight: Math.round(tag.fontSize * unit * 1.2) }}>{tag.text}</AppText>
      </View>
    );
  }
  return (
    <View {...a11y} style={{ width: size, height: size, borderRadius: t.terminal ? 0 : Math.round(size * 0.22), backgroundColor: COLORS[key] ?? t.c.fgMuted, alignItems: 'center', justifyContent: 'center' }}>
      <AppText variant="caption" weight="bold" color="#fff" style={{ fontSize: Math.round(size * 0.4), lineHeight: Math.round(size * 0.5) }} maxFontSizeMultiplier={1}>{agentMonogram(key)}</AppText>
    </View>
  );
}
