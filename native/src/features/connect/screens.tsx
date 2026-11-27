// First run and sign-in: choose a relay (account, end-to-end encrypted) or a Supervisor on
// this network; sign in, register (with the recovery code step) or recover. Every step has
// a way back.
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Platform, ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { ChevronDown, Globe, Cloud, KeyRound, Laptop } from 'lucide-react-native';
import { AppText } from '../../design/AppText';
import { BackIcon } from '../../design/AppBar';
import { PocketFriends } from '../../design/PackArt';
import { Button, IconButton } from '../../design/Button';
import { Field } from '../../design/Field';
import { Press } from '../../design/Press';
import { CopyButton } from '../../design/Copy';
import { Banner } from '../../design/States';
import { useTheme } from '../../design/theme';
import { clearLocaleOverride, hasLocaleOverride, setLocale, translate, useI18n } from '../../i18n';
import { showMenu } from '../../design/Overlay';
import { accountStore, restoreAccount, chooseRelay, completeChallenge, finishRegistration, probeRelay, register, signIn, signInWithRecovery } from '../../connection/account';
import { addDirect, signInDirect } from '../../connection/devices';
import { selectDevice } from '../../layout/selection';

/** The language menu of the Web's sign-in header: system, English, 简体中文. */
function LanguageButton() {
  const t = useTheme();
  const { locale } = useI18n();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const current = hasLocaleOverride() ? (locale === 'zh-CN' ? '简体中文' : 'English') : translate('native.system');
  const open = () => ref.current?.measureInWindow((x, y, width, height) => showMenu({ anchor: { x, y, width, height }, title: translate('common.language'), items: [
    { label: translate('native.system'), checked: !hasLocaleOverride(), onPress: () => clearLocaleOverride() },
    { label: 'English', checked: hasLocaleOverride() && locale === 'en', onPress: () => setLocale('en') },
    { label: '简体中文', checked: hasLocaleOverride() && locale === 'zh-CN', onPress: () => setLocale('zh-CN') },
  ] }));
  return (
    <View ref={ref} collapsable={false}>
      <Press onPress={open} feedback="dim" accessibilityRole="button" accessibilityLabel={`${translate('common.language')}: ${current}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 12, borderRadius: t.radius.md, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.panel }}>
        <Globe size={15} color={t.c.fgSoft} />
        <AppText variant="subhead" tone="soft">{current}</AppText>
        <ChevronDown size={14} color={t.c.fgMuted} />
      </Press>
    </View>
  );
}

/** Connect pages share the Web sign-in header (logo, name, language) and, for forms, its card. */
function Frame({ children, onBack, card = true, logo = true }: { children: React.ReactNode; onBack?: () => void; card?: boolean; logo?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: t.c.bg }}>
      {/* Back stays where every page has it (the bar's place). */}
      <View style={{ minHeight: insets.top + 56, paddingTop: insets.top, paddingLeft: Math.max(6, insets.left), paddingRight: Math.max(14, insets.right), flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {onBack ? <IconButton icon={BackIcon} size={Platform.OS === 'ios' ? 26 : 22} label={translate('native.back')} onPress={onBack} tone="fg" testID="back" /> : <View style={{ width: 8 }} />}
        {logo ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }} accessible accessibilityRole="header" accessibilityLabel="Pockymoe">
            <Image source={require('../../../assets/brand.png')} style={{ width: 30, height: 30 }} accessibilityIgnoresInvertColors />
            <AppText variant="headline" numberOfLines={1}>Pockymoe</AppText>
          </View>
        ) : <View style={{ flex: 1 }} />}
        <LanguageButton />
      </View>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: card ? 'flex-start' : 'center', paddingTop: 12, paddingBottom: insets.bottom + 32,
        paddingLeft: Math.max(16, insets.left), paddingRight: Math.max(16, insets.right) }} keyboardShouldPersistTaps="handled">
        {card ? <View style={{ marginBottom: -18, zIndex: 1 }}><PocketFriends size="card" /></View> : null}
        <View style={[{ width: '100%', maxWidth: 440, alignSelf: 'center' }, card ? {
          padding: 20, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.border, backgroundColor: t.c.panel,
          shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3,
        } : null]}>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
/** The card's heading, left-aligned as on the Web; the subtitle names the relay or the step. */
function CardTitle({ title, subtitle }: { title: string; subtitle?: string | null }) {
  // Plum Pocket centres it under its art in the display face, as its Web pack does.
  const { plum } = useTheme();
  return (
    <View style={{ marginBottom: 18, gap: 2 }}>
      <AppText variant={plum ? 'display' : 'title'} center={plum} accessibilityRole="header" style={{ fontSize: 24, lineHeight: 30 }}>{title}</AppText>
      {subtitle ? <AppText variant="footnote" tone="muted" center={plum} numberOfLines={2}>{subtitle}</AppText> : null}
    </View>
  );
}
function Brand({ title, subtitle }: { title: string; subtitle?: string | null }) {
  return (
    <View style={{ alignItems: 'center', marginBottom: 24, gap: 8 }}>
      {/* The product logo the Web and desktop show (the basket with the three pets). */}
      <Image source={require('../../../assets/brand.png')} style={{ width: 76, height: 76 }} accessibilityIgnoresInvertColors accessible={false} />
      <AppText variant="display" center>{title}</AppText>
      {subtitle ? <AppText variant="callout" tone="muted" center>{subtitle}</AppText> : null}
    </View>
  );
}
const message = (e: unknown) => String((e as Error)?.message ?? e);
/** What the relay's sign-in answer means for the reader (the Web's RelayPortalPage rules):
 *  a wrong password belongs to the password field; account states are a visible notice. */
function signInOutcome(e: unknown): { field?: string; notice?: { tone: 'info' | 'warning' | 'danger'; text: string } } {
  const code = (e as { code?: string })?.code;
  if (code === 'unauthorized' || code === 'invalid_credentials') return { field: translate('auth.invalid_credentials') };
  if (code === 'registration_pending') return { notice: { tone: 'info', text: translate('auth.ui.accountPendingApproval') } };
  if (code === 'registration_rejected') return { notice: { tone: 'warning', text: translate('auth.ui.registrationRejected') } };
  if (code === 'account_disabled') return { notice: { tone: 'warning', text: translate('auth.ui.accountDisabled') } };
  return { notice: { tone: 'danger', text: message(e) } };
}

export function ConnectChoice({ onRelay, onDirect }: { onRelay: () => void; onDirect: () => void }) {
  const t = useTheme();
  const tile = (Icon: typeof Cloud, title: string, body: string, onPress: () => void, testID: string) => (
    <Press onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={`${title}. ${body}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.borderStrong, backgroundColor: t.c.panel }}>
      <View style={{ width: 44, height: 44, borderRadius: t.radius.md, backgroundColor: t.c.accentSoft, alignItems: 'center', justifyContent: 'center' }}><Icon size={22} color={t.c.accentStrong} /></View>
      <View style={{ flex: 1 }}><AppText variant="headline">{title}</AppText><AppText variant="footnote" tone="muted">{body}</AppText></View>
    </Press>
  );
  return (
    <Frame card={false} logo={false}>
      <Brand title="Pockymoe" subtitle={translate('native.connectSubtitle')} />
      <View style={{ gap: 12 }}>
        {tile(Cloud, translate('native.relayAccount'), translate('native.relayAccountBody'), onRelay, 'choose-relay')}
        {tile(Laptop, translate('native.thisNetwork'), translate('native.thisNetworkBody'), onDirect, 'choose-direct')}
      </View>
    </Frame>
  );
}

export function RelayAddress({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [value, setValue] = useState(accountStore.get().origin ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setError(null);
    try { const { origin, registrationEnabled } = await probeRelay(value); await chooseRelay(origin, registrationEnabled); onDone(); }
    catch (e) { setError(translate('native.notARelay')); setDetail(message(e)); } finally { setBusy(false); }
  };
  return (
    <Frame onBack={onBack}>
      <CardTitle title={translate('native.relayAccount')} />
      <Field label={translate('native.relayAddress')} value={value} onChangeText={setValue} placeholder="https://relay.example.com" keyboardType="url" autoFocus
        returnKeyType="go" onSubmitEditing={() => void go()} error={error} errorDetail={detail} testID="relay-address" />
      <Button label={translate('native.continue')} kind="primary" busy={busy} disabled={!value.trim()} onPress={() => void go()} testID="relay-continue" />
    </Frame>
  );
}

export function SignIn({ onBack, onRegister }: { onBack: () => void; onRegister: () => void }) {
  const t = useTheme();
  const account = accountStore.useValue(s => s);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const challenge = account.phase === 'challenge';
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [retrying, setRetrying] = useState(false);
  const host = account.origin?.replace(/^https?:\/\//, '') ?? '';
  // Why the reader is here although they signed in before: a visible line at the top of the
  // card, as the Web's AuthNotice (docs/ui-principles.md §11).
  const notice = account.phase === 'offline' ? (
    <Banner tone="offline" text={translate('native.relayOffline', { origin: host })}
      action={{ label: translate('common.retry'), onPress: () => { setRetrying(true); void restoreAccount().finally(() => setRetrying(false)); } }} />
  ) : account.phase === 'pendingApproval' ? <Banner tone="info" text={translate('auth.ui.accountPendingApproval')} /> : null;
  const [fieldError, setFieldError] = useState<string | null>(null);
  useEffect(() => { setFieldError(null); }, [password, identifier]);
  const [notice2, setNotice2] = useState<{ tone: 'info' | 'warning' | 'danger'; text: string } | null>(null);
  const run = async (task: () => Promise<unknown>) => {
    setBusy(true); setError(null); setFieldError(null); setNotice2(null);
    try { await task(); }
    catch (e) { const outcome = signInOutcome(e); setFieldError(outcome.field ?? null); setNotice2(outcome.notice ?? null); setError(outcome.field ?? outcome.notice?.text ?? message(e)); }
    finally { setBusy(false); }
  };
  return (
    <Frame onBack={onBack}>
      <CardTitle title={challenge ? translate('native.secondFactor') : translate('auth.signIn')} subtitle={host} />
      {notice ? <View style={{ marginBottom: 16, opacity: retrying ? 0.6 : 1 }}>{notice}</View> : null}
      {challenge ? (
        <>
          <Field label={translate('native.authenticatorCode')} value={code} onChangeText={setCode} keyboardType="number-pad" autoFocus textContentType="oneTimeCode" error={error} />
          <Button label={translate('native.verify')} kind="primary" busy={busy} disabled={code.trim().length < 6} onPress={() => void run(() => completeChallenge(code))} />
        </>
      ) : (
        <>
          <Field label={translate('native.emailOrUsername')} value={identifier} onChangeText={setIdentifier} autoComplete="username" textContentType="username" autoFocus={account.phase !== 'offline'} testID="identifier"
            returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordRef.current?.focus()} />
          {/* As on the Web: the way back into the account sits beside the Password label. */}
          {recovery ? <Field ref={passwordRef} label={translate('native.recoveryCode')} value={password} onChangeText={setPassword} autoCapitalize="characters" placeholder="XXXX-XXXX-…" testID="recovery" error={fieldError}
              labelAccessory={<AppText variant="subhead" tone="accent" onPress={() => { setRecovery(false); setPassword(''); }} accessibilityRole="button">{translate('native.usePassword')}</AppText>}
              returnKeyType="go" onSubmitEditing={() => void run(() => signInWithRecovery(identifier, password))} />
            : <Field ref={passwordRef} label={translate('native.password')} value={password} onChangeText={setPassword} secret autoComplete="password" textContentType="password" returnKeyType="go"
              labelAccessory={<AppText variant="subhead" tone="accent" onPress={() => { setRecovery(true); setPassword(''); }} accessibilityRole="button" accessibilityHint={translate('native.useRecoveryCode')}>{translate('auth.ui.forgotPassword')}</AppText>}
              onSubmitEditing={() => void run(() => signIn(identifier, password))} testID="password" error={fieldError} />}
          {notice2 ? <View style={{ marginBottom: 12 }}><Banner tone={notice2.tone} text={notice2.text} /></View> : null}
          <Button label={translate('auth.signIn')} kind="primary" busy={busy} disabled={!identifier.trim() || !password} testID="sign-in"
            onPress={() => void run(() => recovery ? signInWithRecovery(identifier, password) : signIn(identifier, password))} />
          {account.registrationEnabled ? (
            <View style={{ marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.c.border, flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 4 }}>
              <AppText variant="callout" tone="soft">{translate('auth.ui.newHere')}</AppText>
              <AppText variant="callout" tone="accent" onPress={onRegister} accessibilityRole="button" testID="go-register">{translate('native.createAccount')}</AppText>
            </View>
          ) : null}
        </>
      )}
    </Frame>
  );
}

export function Register({ onBack }: { onBack: () => void }) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [check, setCheck] = useState('');
  const [pending, setPending] = useState(false);
  const short = [...password.normalize('NFC')].length < 12;
  // Next moves down the form; the last field submits.
  const refs = [useRef<ComponentRef<typeof TextInput>>(null), useRef<ComponentRef<typeof TextInput>>(null), useRef<ComponentRef<typeof TextInput>>(null), useRef<ComponentRef<typeof TextInput>>(null)];
  const next = (i: number) => ({ returnKeyType: 'next' as const, submitBehavior: 'submit' as const, onSubmitEditing: () => refs[i]?.current?.focus() });
  const submit = async () => {
    if (password !== confirm) { setError(translate('auth.ui.passwordMismatch')); return; }
    setBusy(true); setError(null);
    try { const r = await register({ email, username, password, inviteCode: invite }); setRecovery(r.recoveryCode); setPending(r.pending); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  if (recovery) {
    const groups = recovery.split('-');
    return (
      <Frame>
        <CardTitle title={translate('native.saveRecoveryCode')} subtitle={translate('native.saveRecoveryCodeBody')} />
        <View accessibilityRole="text" accessibilityLabel={recovery} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', padding: 14, borderRadius: t.radius.lg, backgroundColor: t.c.surface, borderWidth: 1, borderColor: t.c.border }}>
          {groups.map((g, i) => <AppText key={i} variant="mono" weight="bold" style={{ fontSize: 17, letterSpacing: 1 }}>{g}</AppText>)}
          <CopyButton value={recovery} />
        </View>
        <View style={{ height: 16 }} />
        <Field label={translate('native.typeLastFour')} value={check} onChangeText={v => setCheck(v.toUpperCase())} autoCapitalize="characters" maxLength={4} />
        <Button label={translate('native.savedIt')} kind="primary" disabled={check !== recovery.replace(/-/g, '').slice(-4)} busy={busy}
          onPress={() => { if (pending) { setRecovery(null); onBack(); return; } setBusy(true); void finishRegistration().finally(() => setBusy(false)); }} />
      </Frame>
    );
  }
  return (
    <Frame onBack={onBack}>
      <CardTitle title={translate('native.createAccount')} />
      <Field label={translate('native.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" autoFocus {...next(0)} />
      <Field ref={refs[0]} label={translate('native.username')} value={username} onChangeText={setUsername} autoComplete="username-new" {...next(1)} />
      <Field ref={refs[1]} {...next(2)} label={translate('native.password')} value={password} onChangeText={setPassword} secret autoComplete="password-new" hint={translate('native.passwordRule')} error={password && short ? translate('native.passwordRule') : null} />
      <Field ref={refs[2]} {...next(3)} label={translate('native.confirmPassword')} value={confirm} onChangeText={setConfirm} secret error={confirm && confirm !== password ? translate('auth.ui.passwordMismatch') : null} />
      <Field ref={refs[3]} label={`${translate('native.inviteCode')} ${translate('files.optional')}`} value={invite} onChangeText={setInvite}
        returnKeyType="go" onSubmitEditing={() => { if (email.trim() && username.trim().length >= 3 && !short && password === confirm) void submit(); }} />
      {error ? <View style={{ marginBottom: 12 }}><Banner tone="danger" text={error} /></View> : null}
      <Button label={translate('native.createAccount')} kind="primary" busy={busy} disabled={!email.trim() || username.trim().length < 3 || short || password !== confirm} onPress={() => void submit()} />
      {busy ? <AppText variant="footnote" tone="muted" center style={{ marginTop: 10 }}>{translate('native.creatingKeys')}</AppText> : null}
    </Frame>
  );
}

export function DirectConnect({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [passcode, setPasscode] = useState('');
  const [needs, setNeeds] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => { setError(null); setDetail(null); }, [url]);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const add = async () => {
    setBusy(true); setError(null);
    // The Supervisor just added is the one the reader goes to (D8).
    try { const r = await addDirect(url, label); if (r.needsPasscode) setNeeds(r.url); else { selectDevice(`direct:${r.url}`); onDone(); } }
    catch (e) { setError(translate('native.supervisorUnreachable')); setDetail(message(e)); } finally { setBusy(false); }
  };
  const login = async () => {
    setBusy(true); setError(null);
    try { await signInDirect(needs!, passcode); selectDevice(`direct:${needs}`); onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  return (
    <Frame onBack={needs ? () => setNeeds(null) : onBack}>
      <CardTitle title={translate('native.thisNetwork')} subtitle={needs ? needs : translate('native.thisNetworkHint')} />
      {needs ? (
        <>
          <Field label={translate('native.passcode')} value={passcode} onChangeText={setPasscode} secret autoFocus error={error} returnKeyType="go" onSubmitEditing={() => void login()} />
          <Button label={translate('auth.signIn')} kind="primary" icon={KeyRound} busy={busy} disabled={!passcode} onPress={() => void login()} />
        </>
      ) : (
        <>
          <Field label={translate('native.supervisorUrl')} value={url} onChangeText={setUrl} placeholder="http://192.168.1.20:45679" keyboardType="url" autoFocus error={error} errorDetail={detail} testID="direct-url"
            returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => nameRef.current?.focus()} />
          <Field ref={nameRef} label={`${translate('native.name')} ${translate('files.optional')}`} value={label} onChangeText={setLabel}
            returnKeyType="go" onSubmitEditing={() => { if (url.trim()) void add(); }} />
          <Button label={translate('native.connect')} kind="primary" busy={busy} disabled={!url.trim()} onPress={() => void add()} testID="direct-connect" />
        </>
      )}
    </Frame>
  );
}

export function RegisterScreen() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { useNavigation } = require('@react-navigation/native') as typeof import('@react-navigation/native');
  const nav = useNavigation();
  return <Register onBack={() => nav.goBack()} />;
}
