// Add a workspace on the current device: a new folder under the development folder, an
// existing path, or a Git repository to clone (the Web's WorkspaceForm, same rules and words).
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { TextInput, View } from 'react-native';
import type { WorkspaceDto } from '@pockymoe/shared';
import { Sheet } from '../../design/Sheet';
import { Segmented } from '../../design/Segmented';
import { Field } from '../../design/Field';
import { Button } from '../../design/Button';
import { AppText } from '../../design/AppText';
import { PathChip } from '../../design/Copy';
import { haptic } from '../../design/haptics';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { deviceApi, devicesStore, findDevice } from '../../connection/devices';
import { loadDeviceLists } from '../../state/deviceData';
import { fieldLabel, inferMode, validateWorkspace, workspaceBody, type WorkspaceMode } from './workspaceInput';

const HINT = { folder: 'files.createsANewDirectoryUnderTheConfigured', path: 'files.registersADirectoryThatIsAlreadyAvailable', git: 'files.clonesTheRepositoryIntoTheConfiguredDevelopment' } as const;
const SUBMIT = { folder: 'files.createFolder', path: 'files.addWorkspace', git: 'files.cloneRepository' } as const;
const PLACEHOLDER = { folder: 'my-project', path: '/Users/name/project', git: 'https://github.com/owner/repo.git' };

export function AddWorkspaceSheet({ deviceKey, visible, onClose, onCreated }: { deviceKey: string; visible: boolean; onClose: () => void; onCreated?: (workspace: WorkspaceDto) => void }) {
  const t = useTheme();
  const device = devicesStore.useValue(() => findDevice(deviceKey));
  const [mode, setMode] = useState<WorkspaceMode>('folder');
  const [values, setValues] = useState<Record<WorkspaceMode, string>>({ folder: '', path: '', git: '' });
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devHome, setDevHome] = useState<string | null>(null);
  const labelRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (!visible || !device) return;
    setValues({ folder: '', path: '', git: '' }); setLabel(''); setTouched(false); setError(null);
    let live = true;
    deviceApi(device).raw('/api/config/workspace-settings').then(s => { if (live) setDevHome((s as { devHome?: string | null })?.devHome ?? null); }, () => { if (live) setDevHome(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, device?.key]);

  const value = values[mode];
  const invalid = validateWorkspace(mode, value);
  const submit = async () => {
    setTouched(true);
    if (invalid || !device) return;
    setBusy(true); setError(null);
    try {
      const created = await deviceApi(device).raw('/api/workspaces', { method: 'POST', body: JSON.stringify(workspaceBody(mode, value, label, devHome)) }) as WorkspaceDto;
      haptic.success();
      await loadDeviceLists(deviceKey);
      onClose();
      onCreated?.(created);
    } catch (e) { setError(String((e as Error)?.message ?? '') || translate('files.unableToCreateWorkspace')); }
    finally { setBusy(false); }
  };
  const change = (next: string) => {
    setError(null);
    // A pasted URL or absolute path switches to the mode it belongs to.
    const inferred = !value ? inferMode(next) : null;
    if (inferred && inferred !== mode) { setMode(inferred); setValues(v => ({ ...v, [inferred]: next })); return; }
    setValues(v => ({ ...v, [mode]: next }));
  };

  return (
    <Sheet visible={visible} onClose={onClose} dismissable={!busy} title={translate('files.addAWorkspace')} subtitle={device?.name}
      footer={<>
        <Button label={translate('workbench.cancel')} onPress={onClose} disabled={busy} style={{ flex: 1, maxWidth: 200 }} />
        <Button label={translate(SUBMIT[mode])} kind="primary" busy={busy} disabled={!value.trim()} onPress={() => void submit()} style={{ flex: 1, maxWidth: 200 }} testID="workspace-submit" />
      </>}>
      <View style={{ gap: 14, paddingTop: 4 }}>
        <Segmented label={translate('files.workspaceSource')} value={mode} onChange={m => { setMode(m); setTouched(false); setError(null); }}
          options={[
            { value: 'folder', label: translate('files.newFolder') },
            { value: 'path', label: translate('files.existingPath') },
            { value: 'git', label: translate('files.gitRepository') },
          ]} />
        <View>
          <Field label={fieldLabel(mode)} value={value} onChangeText={change} placeholder={PLACEHOLDER[mode]} autoFocus
            keyboardType={mode === 'git' ? 'url' : 'default'} error={touched ? invalid ?? error : error}
            hint={translate(HINT[mode])} returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => labelRef.current?.focus()} testID="workspace-target"
            style={mode === 'folder' ? undefined : { fontFamily: t.font.mono, fontSize: 14 }} />
          {mode === 'folder' && devHome ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -6 }}>
              <AppText variant="footnote" tone="muted">→</AppText>
              <PathChip path={`${devHome.replace(/[\\/]+$/, '')}/${value.trim() || PLACEHOLDER.folder}`} style={{ flexShrink: 1 }} />
            </View>
          ) : null}
        </View>
        <Field ref={labelRef} label={`${translate('files.displayLabel')} ${translate('files.optional')}`} value={label} onChangeText={setLabel}
          returnKeyType="go" onSubmitEditing={() => void submit()} />
      </View>
    </Sheet>
  );
}
