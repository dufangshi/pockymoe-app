// Which turns notify (the Web's NotificationSettings, relay accounts): subscribed turns, all
// turns, or chosen devices and workspaces, as the Web's radio cards; devices and workspaces
// appear only for the last.
// The scope belongs to the account (every client follows it), so it stays editable while this
// app's own notifications are off.
import { cloneElement, useState, type ReactElement } from 'react';
import { View } from 'react-native';
import { Cloud, Folder, X } from 'lucide-react-native';
import { Row } from '../../design/List';
import { Checkbox, RadioCards } from '../../design/Choice';
import { IconButton } from '../../design/Button';
import { showToast } from '../../design/Overlay';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { allDevices, devicesStore } from '../../connection/devices';
import { notifyStore, saveNotificationPrefs, type NotificationPrefs, type Scope } from './notifications';

const HINT = { subscribed: 'settings.notificationsSubscribedHint', all: 'settings.notificationsAllHint', selected: 'settings.notificationsSelectedHint' } as const;
const NAME = { subscribed: 'settings.notificationsSubscribed', all: 'settings.notificationsAll', selected: 'settings.notificationsSelected' } as const;

export function NotificationScopeRows() {
  const t = useTheme();
  const prefs = notifyStore.useValue(s => s.prefs);
  const relayDevices = devicesStore.useValue(s => allDevices(s).filter(d => d.kind === 'relay' && !d.shared), (a, b) => a.length === b.length && a.every((d, i) => d.key === b[i]!.key));
  const [saving, setSaving] = useState(false);
  if (!prefs) return null;
  const save = async (next: NotificationPrefs) => {
    setSaving(true);
    try { await saveNotificationPrefs(next); }
    catch { showToast(translate('settings.notificationsSaveFailed'), 'error'); }
    finally { setSaving(false); }
  };
  const chooser = (
    // The Web's radio cards: the option's name and what it means, all visible.
    <RadioCards<Scope> key="scope" label={translate('settings.notificationsDescription')} value={prefs.scope} disabled={saving}
      onChange={scope => void save({ ...prefs, scope })}
      options={(['subscribed', 'all', 'selected'] as Scope[]).map(scope => ({ value: scope, title: translate(NAME[scope]), description: translate(HINT[scope]) }))} />
  );
  const chosen: ReactElement<{ last?: boolean }>[] = prefs.scope !== 'selected' ? [] : [
    ...relayDevices.map(device => {
      const deviceId = device.key.slice(6);
      const on = prefs.devices.some(d => d.deviceId === deviceId);
      const toggle = (v: boolean) => void save({ ...prefs, devices: v ? [...prefs.devices, { deviceId, name: device.name }] : prefs.devices.filter(d => d.deviceId !== deviceId) });
      return <Row key={`d:${deviceId}`} title={device.name} icon={Cloud} disabled={saving} onPress={() => toggle(!on)}
        trailing={<Checkbox value={on} onValueChange={toggle} label={device.name} />} />;
    }),
    ...prefs.workspaces.map(w => (
      <Row key={`w:${w.deviceId}:${w.workspaceId}`} title={w.name} subtitle={w.deviceName} icon={Folder} disabled={saving}
        trailing={<IconButton icon={X} size={16} label={translate('settings.notificationsRemove', { name: w.name })}
          onPress={() => void save({ ...prefs, workspaces: prefs.workspaces.filter(x => x !== w) })} />} />
    )),
  ];
  return (
    <View style={{ gap: 10 }}>
      {chooser}
      {chosen.length ? (
        <View style={{ borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.panel, overflow: 'hidden' }}>
          {chosen.map((row, i) => i === chosen.length - 1 ? cloneElement(row, { last: true }) : row)}
        </View>
      ) : null}
    </View>
  );
}
