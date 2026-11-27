// Approvals and questions from the agent, shown above the composer, as the Web's request cards:
// a permission answers through its options; questions collect answers, then Submit.
import { useState } from 'react';
import { TextInput, View } from 'react-native';
import type { ThreadActionRequestDto } from '@pockymoe/shared';
import { AppText } from '../../design/AppText';
import { mixColor, withAlpha } from '../../design/contrast';
import { Press } from '../../design/Press';
import { useTheme } from '../../design/theme';
import { haptic } from '../../design/haptics';
import { showToast } from '../../design/Overlay';
import { translate } from '../../i18n';

export function RequestCard({ request, onAnswer, readOnly }: { request: ThreadActionRequestDto; onAnswer: (body: { answers: Record<string, { answers: string[] }> } | { allow: boolean }) => Promise<void>; readOnly?: boolean }) {
  const t = useTheme();
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (answers: Record<string, { answers: string[] }> | boolean) => {
    setBusy(true);
    try { await onAnswer(typeof answers === 'boolean' ? { allow: answers } : { answers }); haptic.sent(); }
    catch (error) { showToast(String((error as Error)?.message ?? error), 'error'); }
    finally { setBusy(false); }
  };
  const complete = request.questions.every(q => (picked[q.id]?.length ?? 0) > 0 || (other[q.id]?.trim().length ?? 0) > 0);
  // Titles as the Web's request cards name them.
  const cardTitle = request.kind === 'planDecision' ? translate('chat.plan') : request.kind === 'permissionRequest' ? translate('chat.permissionRequired')
    : request.kind === 'requestUserInput' ? translate('chat.answerRequired') : request.title;
  const permission = request.kind === 'permissionRequest';
  // A permission or plan decision answers through its options; other requests collect, then Submit.
  const submittable = request.kind !== 'planDecision' && !permission && request.questions.length > 0;
  // The Web's request card (TimelineRequestCards): a quiet card in the info hue, each question in
  // its own box with an upper-case header, option pills (the first of a permission filled), Submit.
  const info = '#006087', infoFg = '#f5f9fb';
  const pill = (label: string, on: boolean, filled: boolean, onPress: () => void, hint?: string, testID?: string) => (
    <Press key={label} disabled={busy || readOnly} feedback="dim" onPress={onPress} testID={testID}
      accessibilityRole={permission ? 'button' : 'radio'} accessibilityState={permission ? undefined : { checked: on }} accessibilityLabel={label} accessibilityHint={hint}
      style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', borderRadius: t.terminal ? 0 : 16, borderWidth: 1,
        borderColor: filled || on ? info : t.c.borderStrong, backgroundColor: filled || on ? info : 'transparent', opacity: busy ? 0.6 : 1 }}>
      <AppText variant="footnote" color={filled || on ? infoFg : t.c.fgSoft}>{label}</AppText>
    </Press>
  );
  const action = (text: string, primary: boolean, onPress: () => void, testID: string, incomplete = false) => (
    <Press key={testID} disabled={busy || incomplete} feedback="dim" accessibilityRole="button" testID={testID} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 18, justifyContent: 'center', borderRadius: t.terminal ? 0 : 999, borderWidth: 1,
        borderColor: primary ? info : t.c.borderStrong, backgroundColor: primary ? info : 'transparent' }}>
      <AppText variant="subhead" weight="medium" color={primary ? infoFg : t.c.fg} style={{ fontSize: 14 }}>{text}</AppText>
    </Press>
  );
  return (
    <View accessibilityRole="alert" style={{ marginHorizontal: 9, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: t.terminal ? 0 : 16, borderWidth: 1,
      borderColor: withAlpha(t.c.info, 0.3), backgroundColor: mixColor(t.c.panel, t.c.info, 0.04, t.c.panel), gap: 12 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="subhead" weight="medium" style={{ fontSize: 14 }} numberOfLines={2}>{cardTitle}</AppText>
        {request.title && request.title !== cardTitle ? <AppText variant="footnote" tone="soft" style={{ fontSize: 13, lineHeight: 20 }} selectable>{request.title}</AppText> : null}
        {request.description && request.description !== request.title ? <AppText variant="footnote" tone="soft" style={{ fontSize: 13, lineHeight: 20 }} numberOfLines={6} selectable>{request.description}</AppText> : null}
      </View>
      {request.questions.map(q => (
        <View key={q.id} style={{ padding: 10, borderRadius: t.terminal ? 0 : 12, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.panel }}>
          {q.header ? <AppText variant="caption" tone="muted" style={{ fontSize: 12, letterSpacing: 2.4, textTransform: 'uppercase' }}>{q.header}</AppText> : null}
          {q.question && q.question !== request.title ? <AppText variant="footnote" style={{ marginTop: q.header ? 4 : 0, fontSize: 13, lineHeight: 20 }} selectable>{q.question}</AppText> : null}
          {q.options?.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {q.options.map((option, index) => {
                const on = !!picked[q.id]?.includes(option.label);
                return pill(option.label, on, permission && index === 0 && !/reject|cancel/i.test(`${option.label} ${option.description}`), () => {
                  if (permission || request.kind === 'planDecision') { void submit({ [q.id]: { answers: [option.label] } }); return; }
                  setPicked(p => ({ ...p, [q.id]: q.multiSelect ? (on ? p[q.id]!.filter(x => x !== option.label) : [...(p[q.id] ?? []), option.label]) : [option.label] }));
                }, option.description);
              })}
            </View>
          ) : null}
          {q.isOther || !q.options?.length ? (
            <TextInput value={other[q.id] ?? ''} onChangeText={v => setOther(o => ({ ...o, [q.id]: v }))} editable={!busy && !readOnly} secureTextEntry={q.isSecret}
              placeholder={translate('native.typeAnswer')} placeholderTextColor={t.c.fgMuted} accessibilityLabel={q.question || q.header}
              style={{ marginTop: 12, minHeight: 40, borderWidth: 1, borderColor: t.c.borderStrong, borderRadius: t.terminal ? 0 : 12, paddingHorizontal: 12, color: t.c.fg, backgroundColor: t.c.bg, fontFamily: t.font.regular, fontSize: 14 }} />
          ) : null}
        </View>
      ))}
      {/* The Web's actions (switch-ui f825399): secondary on the left, primary on the right, 44 pt
          tall on phones. A permission without options is denied or approved as a whole; a
          question can be declined next to Submit. */}
      {permission && request.questions.length === 0 && !readOnly ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          {action(translate('desktopShell.deny'), false, () => void submit(false), 'request-deny')}
          {action(translate('desktopShell.approve'), true, () => void submit(true), 'request-allow')}
        </View>
      ) : null}
      {submittable && !readOnly ? (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          {action(translate('native.decline'), false, () => void submit(false), 'request-decline')}
          {action(busy ? translate('chat.submitting') : translate('chat.submit'), true,
            () => void submit(Object.fromEntries(request.questions.map(q => [q.id, { answers: [...(picked[q.id] ?? []), ...(other[q.id]?.trim() ? [other[q.id]!.trim()] : [])] }]))),
            'request-submit', !complete)}
        </View>
      ) : null}
    </View>
  );
}
