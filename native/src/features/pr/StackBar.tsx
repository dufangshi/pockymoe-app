// A PR's stack (docs/source-control.md): bottom (on the base branch) to top, every layer
// one tap away and the open one marked; merge the layers below and this one, or rebase
// the stack onto its base, where the host allows. Same rules as the Web's StackBar.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { ScrollView, View } from 'react-native';
import { GitMerge, Layers, RefreshCcw } from 'lucide-react-native';
import type { PullDetail, Stack, StackLayer, StackRef } from '@pockymoe/web-git/pr/review/reviewApi';
import { rt, type ReviewMessage } from '@pockymoe/web-git/pr/review/reviewText';
import { AppText } from '../../design/AppText';
import { Button, IconButton } from '../../design/Button';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { confirmAsync } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { Segmented } from '../thread/ModelPicker';
import { PullStateMark } from './parts';

const METHOD_LABEL: Record<string, ReviewMessage> = { squash: 'squash', merge: 'mergeCommit', rebase: 'rebase' };
const heads = (layers: StackLayer[]) => layers.filter(l => l.state === 'open').map(l => ({ number: l.number, headSha: l.headSha }));

/** "2/3" with a layers icon in a list row; the words are for screen readers. */
export function StackChip({ stack }: { stack: StackRef | null | undefined }) {
  const t = useTheme();
  if (!stack) return null;
  const label = `${rt('stackPosition', { i: stack.position, n: stack.size })} · ${rt(stack.native ? 'stackNative' : 'stackInferred')}`;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, height: 18, borderRadius: t.radius.pill, borderWidth: 1, borderColor: t.c.accentBorder }}>
      <Layers size={11} color={t.c.accentStrong} />
      <AppText variant="caption" color={t.c.accentStrong} style={{ lineHeight: 14 }}>{`${stack.position}/${stack.size}`}</AppText>
    </View>
  );
}

export function StackBar({ stack, detail, busy, canRebase, onOpen, onAct }: {
  stack: Stack; detail: PullDetail; busy: boolean; canRebase: boolean;
  onOpen(layer: StackLayer): void;
  onAct(action: 'mergeStack' | 'rebaseStack', input: Record<string, unknown>): Promise<unknown>;
}) {
  const t = useTheme();
  const [merging, setMerging] = useState(false);
  const row = useRef<ComponentRef<typeof ScrollView>>(null);
  const offsets = useRef<Record<number, { x: number; width: number }>>({});
  const [rowWidth, setRowWidth] = useState(0);
  const index = stack.layers.findIndex(l => l.number === detail.number);
  const below = stack.layers.slice(0, index + 1).filter(l => l.state !== 'merged');
  const open = stack.layers.filter(l => l.state === 'open');
  const canMerge = detail.state === 'open' && (detail.capabilities.merge || stack.native) && below.every(l => l.state === 'open' && !l.draft);
  // The open layer is centred in the row (a phone shows two or three).
  useEffect(() => {
    const at = offsets.current[detail.number];
    if (at && rowWidth) row.current?.scrollTo({ x: Math.max(0, at.x - (rowWidth - at.width) / 2), animated: false });
  }, [detail.number, stack.id, rowWidth]);
  const rebase = async () => {
    if (await confirmAsync({ title: rt('rebaseStackTitle', { base: stack.base }), message: rt('rebaseStackBody', { n: open.length }), confirmLabel: rt('rebaseStack'), destructive: true }))
      void onAct('rebaseStack', { expectedHeads: heads(stack.layers) });
  };
  return (
    <View accessibilityLabel={`${rt('stack')} · ${rt(stack.native ? 'stackNative' : 'stackInferred')}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 10, paddingRight: 2, minHeight: 44, borderTopWidth: 1, borderTopColor: t.c.border }}>
      <Layers size={15} color={t.c.fgSoft} />
      <ScrollView ref={row} horizontal showsHorizontalScrollIndicator={false} onLayout={e => setRowWidth(e.nativeEvent.layout.width)} contentContainerStyle={{ gap: 4, alignItems: 'center', paddingHorizontal: 4 }} style={{ flex: 1 }}>
        <AppText variant="caption" tone="muted" numberOfLines={1}>{rt('stackBase', { base: stack.base })}</AppText>
        {stack.layers.map((layer, position) => {
          const current = layer.number === detail.number;
          return (
            <Press key={layer.number} onPress={current ? undefined : () => onOpen(layer)} feedback="dim" accessibilityRole="button" accessibilityState={{ selected: current }}
              accessibilityLabel={`${rt('stackPosition', { i: position + 1, n: stack.layers.length })}: #${layer.number} ${layer.title}`}
              onLayout={e => { offsets.current[layer.number] = { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width }; }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 8, maxWidth: 160, borderRadius: t.radius.pill, borderWidth: 1,
                borderColor: current ? t.c.primary : t.c.border, backgroundColor: current ? t.c.accentSoft : t.c.surface, opacity: 1 }}>
              <PullStateMark state={layer.state} draft={layer.draft} size={13} />
              <AppText variant="caption" weight="semibold" color={current ? t.c.accentStrong : t.c.fg}>{`#${layer.number}`}</AppText>
              <AppText variant="caption" tone="soft" numberOfLines={1} style={{ flexShrink: 1 }}>{layer.title}</AppText>
            </Press>
          );
        })}
      </ScrollView>
      {canMerge ? <IconButton icon={GitMerge} label={rt('mergeStack')} disabled={busy} onPress={() => setMerging(true)} /> : null}
      {canRebase && open.length ? <IconButton icon={RefreshCcw} label={rt('rebaseStack')} disabled={busy} onPress={() => void rebase()} /> : null}
      <MergeStackSheet visible={merging} stack={stack} layers={below} detail={detail} busy={busy} onClose={() => setMerging(false)}
        onMerge={async method => { if (await onAct('mergeStack', { method, expectedHeads: heads(below) })) setMerging(false); }} />
    </View>
  );
}

function MergeStackSheet({ visible, stack, layers, detail, busy, onClose, onMerge }: { visible: boolean; stack: Stack; layers: StackLayer[]; detail: PullDetail; busy: boolean; onClose(): void; onMerge(method: string): Promise<void> }) {
  const t = useTheme();
  const methods = detail.mergeMethods.length ? detail.mergeMethods : ['merge'];
  const [method, setMethod] = useState(methods.includes('merge') && !stack.native ? 'merge' : methods[0]!);
  return (
    <Sheet visible={visible} onClose={onClose} title={rt('mergeStackTitle', { n: layers.length })} dismissable={!busy}
      footer={<><Button label={rt('cancel')} onPress={onClose} style={{ flex: 1, maxWidth: 220 }} />
        <Button label={rt('mergeLayers', { n: layers.length })} kind="danger" icon={GitMerge} busy={busy} onPress={() => void onMerge(method)} style={{ flex: 1, maxWidth: 220 }} /></>}>
      <View style={{ gap: 10 }}>
        <AppText variant="footnote" tone="muted">{rt(stack.native ? 'mergeStackNative' : 'mergeStackInferred', { base: stack.base })}</AppText>
        <View style={{ borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border, overflow: 'hidden' }}>
          {layers.map((layer, i) => (
            <View key={layer.number} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, minHeight: 40, borderTopWidth: i ? 1 : 0, borderTopColor: t.c.border }}>
              <PullStateMark state={layer.state} draft={layer.draft} size={14} />
              <AppText variant="subhead" weight="semibold">{`#${layer.number}`}</AppText>
              <AppText variant="subhead" numberOfLines={1} style={{ flex: 1 }}>{layer.title}</AppText>
              <AppText variant="monoSmall" tone="muted">{layer.headSha.slice(0, 7)}</AppText>
            </View>
          ))}
        </View>
        {methods.length > 1 ? <Segmented label={rt('mergeMethod')} value={method} onChange={setMethod} options={methods.map(m => ({ value: m, label: rt(METHOD_LABEL[m] ?? 'mergeCommit') }))} /> : null}
        <AppText variant="footnote" tone="muted">{rt('mergeStackCredits')}</AppText>
      </View>
    </Sheet>
  );
}
