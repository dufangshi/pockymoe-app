import { useEffect, useState } from 'react';
import { Button } from '../../design/Button';
import { Field } from '../../design/Field';
import { Sheet } from '../../design/Sheet';
import { translate } from '../../i18n';

export function RenameSheet({ visible, onClose, title, onSave }: { visible: boolean; onClose: () => void; title: string; onSave: (title: string) => Promise<void> }) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setValue(title); setError(null); } }, [visible, title]);
  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try { await onSave(value.trim()); onClose(); } catch (e) { setError(String((e as Error)?.message ?? e)); } finally { setBusy(false); }
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={translate('native.rename')} dismissable={!busy}
      footer={<><Button label={translate('workbench.cancel')} onPress={onClose} /><Button label={translate('native.save')} kind="primary" busy={busy} disabled={!value.trim()} onPress={() => void save()} /></>}>
      <Field label={translate('native.title')} value={value} onChangeText={setValue} autoFocus error={error} returnKeyType="done" onSubmitEditing={() => void save()} autoCapitalize="sentences" />
    </Sheet>
  );
}
