// The one thread status mark (docs/ui-principles.md §6): every state keeps its shape in
// every theme and has an accessible name. All marks sit in one 12 pt slot and never move.
import { View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { translate } from '../i18n';
import { useTheme } from './theme';
import { useIconSize } from './useIconScale';

export type NavStatus = 'running' | 'waiting' | 'unread' | 'idle' | 'failed' | 'interrupted' | 'agents-running' | 'unknown';
export function navigationStatusLabel(status: NavStatus) {
  switch (status) {
    case 'waiting': return translate('workbench.waitingForYou');
    case 'running': return translate('workbench.running');
    case 'unread': return translate('workbench.completedUnread');
    case 'idle': return translate('workbench.idleRead');
    case 'failed': return translate('workbench.failed');
    case 'interrupted': return translate('workbench.interrupted');
    case 'agents-running': return translate('workbench.agentThreadsRunningShort');
    default: return translate('workbench.statusUnavailable');
  }
}

export function StatusMark({ status, size = 12, label }: { status: NavStatus; size?: number; label?: string }) {
  const { c, terminal } = useTheme();
  // Marks keep their proportion to large text (§6 shapes unchanged; only the size follows).
  const s = useIconSize(size);
  let shape: React.ReactNode;
  switch (status) {
    case 'running':
      shape = terminal ? <Rect x={s * 0.25} y={s * 0.08} width={s * 0.5} height={s * 0.84} fill={c.running} />
        // A static three-quarter ring, open at the top.
        : <Path d={`M ${s / 2} ${s * 0.1} A ${s * 0.4} ${s * 0.4} 0 1 1 ${s * 0.1} ${s / 2}`} stroke={c.running} strokeWidth={s * 0.2} fill="none" strokeLinecap="butt" />;
      break;
    case 'agents-running':
      shape = terminal ? <Rect x={s * 0.28} y={s * 0.12} width={s * 0.44} height={s * 0.76} stroke={c.agents} strokeWidth={1.4} fill="none" />
        : <><Circle cx={s / 2} cy={s / 2} r={s * 0.36} stroke={c.agents} strokeWidth={1.5} fill="none" /><Circle cx={s / 2} cy={s / 2} r={s * 0.17} fill={c.agents} /></>;
      break;
    case 'waiting':
      // Solid speech bubble with a lower-right tail.
      shape = <Path fill={c.waiting} d={`M ${s * 0.22} ${s * 0.04} H ${s * 0.78} L ${s} ${s * 0.22} V ${s * 0.62} L ${s * 0.83} ${s * 0.77} L ${s * 0.94} ${s * 0.96} L ${s * 0.58} ${s * 0.77} H ${s * 0.22} L 0 ${s * 0.62} V ${s * 0.22} Z`} />;
      break;
    case 'unread': shape = <Circle cx={s / 2} cy={s / 2} r={s * 0.3} fill={c.primary} />; break;
    case 'failed': shape = <Path fill={c.failed} d={`M ${s / 2} ${s * 0.12} L ${s * 0.88} ${s / 2} L ${s / 2} ${s * 0.88} L ${s * 0.12} ${s / 2} Z`} />; break;
    case 'interrupted':
      shape = terminal ? <Rect x={s * 0.12} y={s * 0.4} width={s * 0.76} height={s * 0.22} fill={c.interrupted} />
        : <Rect x={s * 0.2} y={s * 0.2} width={s * 0.6} height={s * 0.6} rx={1.5} fill={c.interrupted} />;
      break;
    case 'idle': shape = <Circle cx={s / 2} cy={s / 2} r={s * 0.24} stroke={c.borderContrast} strokeWidth={1.5} fill="none" />; break;
    default: shape = <Circle cx={s / 2} cy={s / 2} r={s * 0.24} stroke={c.borderContrast} strokeWidth={1.5} strokeDasharray="1.5 1.5" fill="none" opacity={0.6} />;
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label ?? navigationStatusLabel(status)} style={{ width: s, height: s }}>
      <Svg width={s} height={s}>{shape}</Svg>
    </View>
  );
}

/** Device connection (§6 "设备连接状态"): solid dot online, hollow offline, diamond flapping. */
export function DeviceStateMark({ online, flapping, size = 10 }: { online: boolean | null; flapping?: boolean; size?: number }) {
  const { c } = useTheme();
  const s = useIconSize(size);
  const label = online === null ? translate('workbench.statusUnavailable') : online ? translate('desktopDevices.online') : translate('native.offline');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: s, height: s }}>
      <Svg width={s} height={s}>
        {flapping ? <Path fill={c.warning} d={`M ${s / 2} 0 L ${s} ${s / 2} L ${s / 2} ${s} L 0 ${s / 2} Z`} />
          : online ? <Circle cx={s / 2} cy={s / 2} r={s * 0.4} fill={c.online} />
          : <Circle cx={s / 2} cy={s / 2} r={s * 0.34} stroke={c.fgMuted} strokeWidth={1.5} fill="none" strokeDasharray={online === null ? '1.5 1.5' : undefined} />}
      </Svg>
    </View>
  );
}
