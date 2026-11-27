// The Web's ErrorMark (docs/ui-principles.md §11): a small, quiet exclamation where something
// failed; the reason opens on tap (a sheet on phones) with copy and, when it helps, retry.
// Screen readers hear the reason directly.
import { useState } from 'react';
import { View } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { Press } from './Press';
import { AppText } from './AppText';
import { Button } from './Button';
import { CopyButton } from './Copy';
import { Sheet } from './Sheet';
import { useTheme } from './theme';
import { translate } from '../i18n';

export function ErrorMark({ reason, title, onRetry, size = 16 }: { reason: string; title?: string; onRetry?: () => void; size?: number }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Press onPress={() => setOpen(true)} feedback="dim" hitSlop={12} accessibilityRole="button" accessibilityLabel={reason}
        accessibilityHint={translate('native.errorDetails')} style={{ padding: 4, borderRadius: 12 }}>
        <AlertCircle size={size} color={t.c.fgMuted} />
      </Press>
      <Sheet visible={open} onClose={() => setOpen(false)} title={title ?? translate('native.errorDetails')}
        footer={onRetry ? <Button label={translate('common.retry')} kind="primary" onPress={() => { setOpen(false); onRetry(); }} style={{ flex: 1, maxWidth: 200 }} /> : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
          <AppText variant="monoSmall" tone="soft" selectable style={{ flex: 1 }}>{reason}</AppText>
          <CopyButton value={reason} />
        </View>
      </Sheet>
    </>
  );
}
