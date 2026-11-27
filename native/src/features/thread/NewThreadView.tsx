// A new thread, as the Web's form: an optional first prompt, the backend, workspace, worktree
// option, model and effort and title; New thread creates it (and sends the prompt) and opens it.
import { useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, FolderGit2 } from 'lucide-react-native';
import type { ModelOptionDto, WorkspaceDto } from '@pockymoe/shared';
import { AppBar } from '../../design/AppBar';
import { AppText } from '../../design/AppText';
import { Press } from '../../design/Press';
import { Sheet } from '../../design/Sheet';
import { showToast } from '../../design/Overlay';
import { Button } from '../../design/Button';
import { Field } from '../../design/Field';
import { PathChip } from '../../design/Copy';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { prefs } from '../../platform/prefs';
import { deviceApi, devicesStore, findDevice } from '../../connection/devices';
import { retainDevice, upsertThread, useDeviceData } from '../../state/deviceData';
import { addLocalPrompt, threadKey, updateLocalPrompt } from '../../state/threadDetail';
import { isApiError, type ThreadWorktreeOptions } from '../../protocol/api';
import { agentEntryLabel, isNativeEntry } from '../../protocol/agentKey';
import { worktreeFieldError, worktreeNameFrom, worktreePath } from './worktree';
import { readDraft, writeDraft } from './Composer';
import { ModelPicker, effortLabel } from './ModelPicker';
import { useModelOptions } from './modelOptions';
import { READING_WIDTH } from './readingWidth';
import type { AgentChoice, ModelChoice } from './ModelPicker';

const LAST = 'pockymoe-native.new-thread';

export function NewThreadView({ deviceKey, workspaceId: initialWorkspace, onBack, onCreated }: { deviceKey: string; workspaceId?: string; onBack?: () => void; onCreated: (threadId: string) => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const data = useDeviceData(deviceKey);
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const api = device ? deviceApi(device) : null;
  const last = prefs.getJson<{ workspaceId?: string; agent?: AgentChoice; model?: ModelChoice }>(`${LAST}:${deviceKey}`) ?? {};
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(initialWorkspace ?? last.workspaceId);
  const [agent, setAgent] = useState<AgentChoice>(last.agent ?? { provider: 'acp', agentId: null });
  const [model, setModel] = useState<ModelChoice>(last.model ?? { model: null, effort: null });
  // Harnesses the device offers: native runtimes (Codex, Claude, …) and each ACP agent.
  // On runtimes where Codex and Claude run natively, the ACP adapters and other ACP agents
  // are listed apart, under "ACP agent" (docs/native-harnesses.md).
  const [agents, setAgents] = useState<{ choice: AgentChoice; label: string; description?: string; ready: boolean; isDefault: boolean; acp: boolean }[]>([]);
  const [picking, setPicking] = useState<'workspace' | 'agent' | 'worktree' | null>(null);
  // A new worktree for the thread (owner devices only; the route refuses every share). One
  // request id per distinct input, so sending again after a lost answer makes no second one.
  const [worktree, setWorktree] = useState({ on: false, name: '', branch: '', base: '' });
  const worktreeRequests = useRef(new Map<string, string>());
  const [setupFailed, setSetupFailed] = useState<{ threadId: string; detail: string } | null>(null);
  const worktreeOffered = !!device && !device.shared;
  useEffect(() => retainDevice(deviceKey), [deviceKey]);
  useEffect(() => {
    if (!api) return;
    let live = true;
    (async () => {
      const runtimes = (await api.runtimes().catch(() => [])).filter(r => r.enabled);
      const options: typeof agents = [];
      const acpRuntime = runtimes.find(r => r.provider === 'acp');
      const acpList = acpRuntime ? (await api.runtimeAgents('acp').catch(() => [] as ModelOptionDto[])).filter(x => !x.hidden) : [];
      const split = acpList.some(isNativeEntry);
      for (const runtime of runtimes) {
        // Native Codex and Claude are listed under the ACP runtime's agents; their own runtime
        // entries would name them twice (both run natively).
        if (runtime.provider !== 'acp' && split && acpList.some(a => isNativeEntry(a) && a.model === runtime.provider)) continue;
        if (runtime.provider !== 'acp') { options.push({ choice: { provider: runtime.provider, agentId: null }, label: runtime.displayName, description: runtime.description, ready: true, isDefault: runtime.isDefault, acp: false }); continue; }
        for (const a of acpList) options.push({ choice: { provider: 'acp', agentId: a.id }, label: agentEntryLabel(a), description: a.description, ready: (a.acpAgent?.availability ?? 'ready') === 'ready', isDefault: runtime.isDefault && a.isDefault, acp: split && !isNativeEntry(a) });
      }
      if (!live) return;
      setAgents(options);
      const keep = options.find(o => o.ready && o.choice.provider === agent.provider && o.choice.agentId === agent.agentId);
      if (!keep) { const pick = options.find(o => o.ready && o.isDefault) ?? options.find(o => o.ready); if (pick) setAgent(pick.choice); }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
  // Models belong to the agent: pick its default when the agent changes.
  useEffect(() => {
    if (!api || (agent.provider === 'acp' && !agent.agentId)) return;
    api.runtimeModels(agent.provider, agent.agentId).then(list => {
      if (model.model && list.some(m => m.model === model.model)) return;
      const d = list.find(m => m.isDefault) ?? list[0];
      if (d) setModel({ model: d.model, effort: d.defaultReasoningEffort });
    }, () => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, agent.provider, agent.agentId]);
  const workspace: WorkspaceDto | undefined = data.workspaces.find(w => w.id === workspaceId) ?? data.workspaces[0];
  const current = agents.find(a => a.choice.provider === agent.provider && a.choice.agentId === agent.agentId);

  const send = async (text: string, attachments: Parameters<NonNullable<typeof api>['prompt']>[2]) => {
    if (!api || !workspace) return false;
    const title = titleText.trim();
    if (!model.model) { showToast(translate('native.pickModelFirst'), 'error'); return false; }
    const nameError = worktree.on ? worktreeFieldError(worktree.name.trim()) : null;
    if (nameError) { showToast(translate('native.worktreeNameInvalid'), 'error'); setPicking('worktree'); return false; }
    try {
      const input = { workspaceId: workspace.id, provider: agent.provider, ...(agent.agentId ? { agentId: agent.agentId } : {}),
        model: model.model, ...(model.effort ? { reasoningEffort: model.effort } : {}), approvalMode: 'yolo' as const, ...(title ? { title } : {}) };
      let thread;
      if (worktree.on && worktreeOffered) {
        const name = worktree.name.trim() || worktreeNameFrom(text);
        const options: ThreadWorktreeOptions = { ...(name ? { name } : {}), ...(worktree.branch.trim() ? { branch: worktree.branch.trim() } : {}), ...(worktree.base.trim() ? { base: worktree.base.trim() } : {}) };
        const key = JSON.stringify([input, options]);
        const clientRequestId = worktreeRequests.current.get(key) ?? globalThis.crypto.randomUUID();
        worktreeRequests.current.set(key, clientRequestId);
        const started = await api.createThreadInWorktree(input, { ...options, clientRequestId }).catch(e => {
          // Runtimes before the route answer 405 (or 404) with no message.
          throw isApiError(e) && [404, 405].includes(e.status) && /^HTTP \d+$/.test(e.message) ? new Error(translate('native.worktreeUnsupported')) : e;
        });
        upsertThread(deviceKey, started.thread);
        if (started.setup && !started.setup.completed) {
          // The thread and worktree exist; say why setup failed and open the thread on request,
          // with this prompt as its draft (the composer puts it back here when send fails).
          setSetupFailed({ threadId: started.thread.id, detail: [started.setup.error, ...(started.setup.output ?? [])].filter(Boolean).join('\n').slice(0, 4000) });
          return false;
        }
        if (started.setup) showToast(translate('native.worktreeSetupRan'));
        thread = started.thread;
      } else thread = await api.createThread(input);
      prefs.setJson(`${LAST}:${deviceKey}`, { workspaceId: workspace.id, agent, model });
      upsertThread(deviceKey, thread);
      writeDraft(`new:${deviceKey}`, { text: '', attachments: [], quotes: [] });
      // The first prompt is optional, as on the Web: without one the thread just opens.
      if (text.trim() || attachments?.length) {
        const clientRequestId = globalThis.crypto.randomUUID();
        addLocalPrompt(deviceKey, thread.id, { clientRequestId, text, createdAt: new Date().toISOString(), state: 'sending', attachments: attachments ?? [] });
        void api.prompt(thread.id, { prompt: text, clientRequestId }, attachments)
          .catch(e => updateLocalPrompt(deviceKey, thread.id, clientRequestId, { state: 'failed', error: String((e as Error)?.message ?? e) }));
      }
      onCreated(thread.id);
      return true;
    } catch (e) { showToast(String((e as Error)?.message ?? e), 'error'); return false; }
  };

  const openFailed = () => {
    if (!setupFailed) return;
    writeDraft(threadKey(deviceKey, setupFailed.threadId), readDraft(`new:${deviceKey}`));
    writeDraft(`new:${deviceKey}`, { text: '', attachments: [], quotes: [] });
    const id = setupFailed.threadId;
    setSetupFailed(null);
    onCreated(id);
  };
  const worktreeName = worktree.name.trim() || worktreeNameFrom(readDraft(`new:${deviceKey}`).text);
  // The Web's new-thread form (workbench NewThreadPage): first prompt, backend, workspace, the
  // worktree option, model and effort, title, then New thread / Cancel.
  const [prompt, setPrompt] = useState(() => readDraft(`new:${deviceKey}`).text);
  const [titleText, setTitleText] = useState('');
  const [creating, setCreating] = useState(false);
  const [picker, setPicker] = useState(false);
  const options = useModelOptions(api, null, agent, workspace?.absPath);
  const option = options?.find(o => o.model === model.model);
  const label = (text: string) => <AppText variant="footnote" tone="muted" style={{ fontSize: 13, marginBottom: 8 }}>{text}</AppText>;
  const select = (text: string, onPress: () => void, a11y: string, testID?: string, middle = false) => (
    <Press onPress={onPress} feedback="dim" accessibilityRole="button" accessibilityLabel={a11y} testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 11, borderRadius: t.terminal ? 0 : 8, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.bg }}>
      <AppText variant="subhead" numberOfLines={1} ellipsizeMode={middle ? 'middle' : 'tail'} style={{ flex: 1, fontSize: 14 }}>{text}</AppText>
      <ChevronDown size={16} color={t.c.fgMuted} />
    </Press>
  );
  const create = async () => {
    setCreating(true);
    writeDraft(`new:${deviceKey}`, { ...readDraft(`new:${deviceKey}`), text: prompt });
    const ok = await send(prompt.trim(), []);
    setCreating(false);
    if (ok) setPrompt('');
  };
  const home = workspace ? workspace.absPath.replace(/^\/home\/[^/]+/, '~') : '';
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.c.bg }}>
      <AppBar onBack={onBack} title={translate('workbench.backToThreads')} subtitle={device?.name} onTitlePress={onBack} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ width: '100%', maxWidth: READING_WIDTH, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        <View style={{ paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: t.c.border, marginBottom: 20 }}>
          <AppText variant="title" weight="semibold" style={{ fontSize: 24, lineHeight: 30, ...(t.plum ? { fontFamily: t.font.display } : null) }} accessibilityRole="header">{translate('workbench.newThread')}</AppText>
        </View>
        {label(translate('workbench.firstPrompt'))}
        <TextInput value={prompt} onChangeText={v => { setPrompt(v); writeDraft(`new:${deviceKey}`, { ...readDraft(`new:${deviceKey}`), text: v }); }} multiline
          placeholder={translate('workbench.firstPromptPlaceholder')} placeholderTextColor={t.c.fgMuted} accessibilityLabel={translate('workbench.firstPrompt')} textAlignVertical="top"
          style={{ minHeight: 96, maxHeight: 240, paddingHorizontal: 16, paddingVertical: 12, borderRadius: t.terminal ? 0 : 8, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.bg,
            color: t.c.fg, fontFamily: t.terminal ? t.font.mono : t.font.regular, fontSize: 16, lineHeight: 24, marginBottom: 24 }} />
        {label(translate('workbench.backend'))}
        <View accessibilityRole="radiogroup" accessibilityLabel={translate('workbench.backend')}
          style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 3, borderRadius: t.terminal ? 0 : 12, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.surface }}>
          {agents.map(a => {
            const on = a.choice.provider === agent.provider && a.choice.agentId === agent.agentId;
            return (
              <Press key={`${a.choice.provider}:${a.choice.agentId ?? ''}`} disabled={!a.ready} onPress={() => { setAgent(a.choice); setModel({ model: null, effort: null }); }} feedback="dim"
                accessibilityRole="radio" accessibilityState={{ checked: on, disabled: !a.ready }} accessibilityLabel={a.label}
                style={{ width: '50%', minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: t.terminal ? 0 : 9, opacity: a.ready ? 1 : 0.45,
                  backgroundColor: on ? t.c.panel : 'transparent', ...(on && !t.terminal ? { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null),
                  ...(on && t.terminal ? { borderWidth: 1, borderColor: t.c.primary } : null) }}>
                <AppText variant="subhead" weight={on ? 'semibold' : 'medium'} tone={on ? undefined : 'soft'} numberOfLines={1} style={{ fontSize: 14 }}>{a.label}</AppText>
              </Press>
            );
          })}
        </View>
        <AppText variant="footnote" tone="muted" style={{ fontSize: 13, marginTop: 10 }} numberOfLines={2}>
          {[current?.ready === false ? translate('native.notInstalled') : translate('workbench.installed_7bb440'), current?.description].filter(Boolean).join(' · ')}</AppText>
        <View style={{ height: 1, backgroundColor: t.c.border, marginVertical: 20 }} />
        {label(translate('workbench.workspace'))}
        {select(workspace ? `${workspace.label} · ${home}` : translate('workbench.workspaces'), () => setPicking('workspace'), translate('native.chooseWorkspace'), undefined, true)}
        {worktreeOffered ? (
          <View style={{ marginTop: 24 }}>
            <Press onPress={() => setWorktree(w => ({ ...w, on: !w.on }))} feedback="none" accessibilityRole="checkbox" accessibilityState={{ checked: worktree.on }} testID="worktree-toggle"
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
              <View style={{ width: 16, height: 16, borderRadius: t.terminal ? 0 : 3, borderWidth: 1.5, borderColor: worktree.on ? t.c.primary : t.c.borderStrong, backgroundColor: worktree.on ? t.c.primary : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                {worktree.on ? <Check size={12} color={t.c.primaryFg} strokeWidth={3} /> : null}
              </View>
              <AppText variant="callout">{translate('native.worktreeNew')}</AppText>
            </Press>
            <AppText variant="footnote" tone="muted" style={{ fontSize: 13, lineHeight: 20 }}>{translate('native.worktreeHint')}</AppText>
            {worktree.on ? (
              <View style={{ paddingTop: 12 }}>
                {workspace ? <PathChip path={worktreePath(workspace.absPath, worktreeName ?? '…')} style={{ alignSelf: 'flex-start', marginBottom: 12 }} /> : null}
                <Field label={translate('native.worktreeName')} value={worktree.name} onChangeText={name => setWorktree(w => ({ ...w, name }))}
                  placeholder={worktreeName ?? translate('native.worktreeNameAuto')} hint={translate('native.worktreeNameHint')}
                  error={worktreeFieldError(worktree.name.trim()) ? translate('native.worktreeNameInvalid') : null} spellCheck={false} />
                <Field label={translate('native.worktreeBranch')} value={worktree.branch} onChangeText={branch => setWorktree(w => ({ ...w, branch }))}
                  placeholder={`agent/${worktreeName ?? '…'}`} spellCheck={false} />
                <Field label={translate('native.worktreeBase')} value={worktree.base} onChangeText={base => setWorktree(w => ({ ...w, base }))}
                  placeholder="HEAD" hint={translate('native.worktreeBaseHint')} spellCheck={false} />
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={{ marginTop: 24 }}>{label(translate('workbench.model'))}</View>
        {select(option?.displayName || model.model || translate('native.defaultModel'), () => setPicker(true), translate('workbench.model'), 'model-key')}
        {option?.supportedReasoningEfforts.length ? (
          <>
            <View style={{ marginTop: 24 }}>{label(translate('workbench.reasoningEffort'))}</View>
            {select(effortLabel(model.effort ?? option.defaultReasoningEffort), () => setPicker(true), translate('workbench.reasoningEffort'))}
          </>
        ) : null}
        <View style={{ marginTop: 24 }}>{label(translate('workbench.title'))}</View>
        <TextInput value={titleText} onChangeText={setTitleText} placeholder={translate('workbench.optionalFallsBackToFirstPrompt')} placeholderTextColor={t.c.fgMuted}
          accessibilityLabel={translate('workbench.title')}
          style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: t.terminal ? 0 : 8, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.bg, color: t.c.fg, fontFamily: t.terminal ? t.font.mono : t.font.regular, fontSize: 16 }} />
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: Math.max(insets.bottom, 12), borderTopWidth: 1, borderTopColor: t.c.border }}>
        <Button label={translate('workbench.newThreadTitle')} kind="primary" busy={creating} disabled={!workspace || !api || !model.model} onPress={() => void create()} testID="create-thread" />
        <Button label={translate('workbench.cancel')} onPress={onBack ?? (() => undefined)} />
      </View>
      {api ? <ModelPicker visible={picker} onClose={() => setPicker(false)} api={api} threadId={null} agent={agent} value={model} onChange={setModel} cwd={workspace?.absPath} /> : null}
      <Sheet visible={picking === 'workspace'} onClose={() => setPicking(null)} title={translate('native.chooseWorkspace')}>
        {data.workspaces.map(w => (
          <Press key={w.id} onPress={() => { setWorkspaceId(w.id); setPicking(null); }} accessibilityRole="radio" accessibilityState={{ checked: w.id === workspace?.id }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 8, borderRadius: t.radius.md }}>
            <FolderGit2 size={18} color={t.c.fgSoft} />
            <View style={{ flex: 1 }}><AppText variant="callout" weight="medium">{w.label}</AppText><AppText variant="monoSmall" tone="muted" numberOfLines={1} ellipsizeMode="middle">{w.absPath}</AppText></View>
            {w.id === workspace?.id ? <Check size={18} color={t.c.accentStrong} /> : null}
          </Press>
        ))}
      </Sheet>
      <Sheet visible={!!setupFailed} onClose={() => setSetupFailed(null)} title={translate('native.worktreeSetupFailedTitle')}
        footer={<Button label={translate('native.openThread')} kind="primary" onPress={openFailed} testID="worktree-open-thread" />}>
        <AppText variant="callout" style={{ marginBottom: 10 }}>{translate('native.worktreeSetupFailed')}</AppText>
        <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ padding: 10, borderRadius: t.radius.md, backgroundColor: t.c.surface }}>
          <AppText variant="monoSmall" selectable>{setupFailed?.detail ?? ''}</AppText>
        </ScrollView>
      </Sheet>
    </KeyboardAvoidingView>
  );
}
