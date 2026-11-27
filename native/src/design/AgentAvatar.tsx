// Every agent keeps its own avatar: the Web's mark (AgentMark), with the agent's name for
// screen readers.
import { Image } from 'expo-image';
import { themeAgentKey, themeAgentName } from '../../vendor/pockymoe/thread-ui/components/themeAgent';
import { agentKeyName, isAdapterKey } from '../protocol/agentKey';
import { PLUM_PEEKS } from './agentArt';
import { AgentMark } from './AgentMark';
import { useTheme } from './theme';

export function AgentAvatar({ agent, size = 22 }: { agent: string | null | undefined; size?: number }) {
  const key = themeAgentKey(agent) ?? 'agent';
  const name = !agent ? 'Agent' : isAdapterKey(agent) ? agentKeyName(agent) : themeAgentName(agent, key);
  return <AgentMark agent={agent} size={size} label={name} />;
}

// The Web's phone mascot: 42 pt wide at the composer's left, peeking over its top edge.
const PEEK_TOP = -32;
const peekSource = (agent: string | null | undefined) => PLUM_PEEKS[themeAgentKey(agent) ?? 'claude'];

/** Plum Pocket's mascot that peeks over the composer. */
export function ComposerPeek({ agent }: { agent: string | null | undefined }) {
  const t = useTheme();
  const source = t.plum ? peekSource(agent) : undefined;
  if (!source) return null;
  return <Image source={source} style={{ position: 'absolute', left: 20, top: PEEK_TOP, width: 42, height: 34 }} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

/** How far the mascot rises above the composer (its 6 pt top padding taken off): the
 *  transcript keeps that much room at its end, so the last line is never under it. */
export function composerPeekRise(agent: string | null | undefined, plum: boolean) {
  return plum && peekSource(agent) ? -PEEK_TOP - 6 : 0;
}
