// The working turn's bell (docs/thread-notifications.md): subscribe this exact turn.
// Shown only in "Subscribed turns" scope; the filled bell and the label say it is on.
import { Bell, BellRing } from 'lucide-react-native';
import { IconButton } from '../../design/Button';
import { showToast } from '../../design/Overlay';
import { haptic } from '../../design/haptics';
import { translate } from '../../i18n';
import { notifyStore, setTurnSubscription } from './notifications';

export function TurnBell({ deviceKey, threadId, turnId }: { deviceKey: string; threadId: string; turnId: string }) {

  const deviceId = deviceKey.startsWith('relay:') ? deviceKey.slice(6) : null;
  const scope = notifyStore.useValue(s => s.scope);
  const on = notifyStore.useValue(s => !!deviceId && !!s.subscribed[`${deviceId}/${threadId}/${turnId}`]);
  if (!deviceId || scope !== 'subscribed') return null;
  return (
    <IconButton icon={on ? BellRing : Bell} size={17} tone={on ? 'primary' : 'muted'} active={on} label={on ? translate('native.notifyOn') : translate('native.notifyMe')}
      onPress={() => { haptic.selection(); void setTurnSubscription(deviceId, threadId, turnId, !on).then(() => { if (!on) showToast(translate('native.notifyOn')); }, e => showToast(String(e?.message ?? e), 'error')); }}
      style={{ marginLeft: 4 }} testID="turn-bell" />
  );
}
