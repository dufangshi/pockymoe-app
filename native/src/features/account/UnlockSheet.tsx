// Answers the vendored account code's unlock requests with the password (or the
// recovery code). The reason says why; Cancel always gets out.
import { useState } from 'react';
import { LockKeyhole } from 'lucide-react-native';
import { View } from 'react-native';
import { AppText } from '../../design/AppText';
import { Button } from '../../design/Button';
import { Field } from '../../design/Field';
import { Sheet } from '../../design/Sheet';
import { useTheme } from '../../design/theme';
import { translate } from '../../i18n';
import { cancelUnlock, submitUnlock, unlockStore } from '../../connection/unlock';

export function UnlockSheet() {
  const t = useTheme();
  const { pending, browserRemoved } = unlockStore.useValue(s => s);
  const [secret, setSecret] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = pending.length > 0;
  const reason = pending[0]?.reason;
  const unlock = async () => {
    setBusy(true); setError(null);
    try { await submitUnlock(secret, recovery); setSecret(''); }
    catch (e) { setError(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  };
  const title = browserRemoved ? translate('native.appRemoved') : translate('native.unlockTitle');
  return (
    <Sheet visible={visible} onClose={() => { cancelUnlock(); setSecret(''); }} title={title} dismissable={!busy}
      footer={<><Button label={translate('workbench.cancel')} onPress={() => cancelUnlock()} /><Button label={translate('native.unlock')} kind="primary" busy={busy} disabled={!secret} onPress={() => void unlock()} testID="unlock" /></>}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <LockKeyhole size={20} color={t.c.accentStrong} />
        <AppText variant="callout" tone="soft" style={{ flex: 1 }}>{translate(`native.unlockReason.${reason ?? 'connect'}` as never)}</AppText>
      </View>
      <Field label={recovery ? translate('native.recoveryCode') : translate('native.password')} value={secret} onChangeText={setSecret} secret={!recovery} autoFocus
        error={error} returnKeyType="go" onSubmitEditing={() => void unlock()} testID="unlock-password" />
      <AppText variant="subhead" tone="accent" onPress={() => { setRecovery(v => !v); setSecret(''); }} accessibilityRole="button">{recovery ? translate('native.usePassword') : translate('native.useRecoveryCode')}</AppText>
    </Sheet>
  );
}
