// Settings: appearance (theme, mode, one-hand dock), language, account, devices, about.
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Check, LogIn, LogOut, UserRound, Plus, Trash2, Globe, KeyRound, Cloud, Fingerprint, Activity } from 'lucide-react-native';
import { AppBar } from '../../design/AppBar';
import { AppText } from '../../design/AppText';
import { Row, SavedMark, Section } from '../../design/List';
import { Checkbox, SelectButton, SettingBlock } from '../../design/Choice';
import { CopyButton } from '../../design/Copy';
import { AccountAvatar } from '../../design/AccountAvatar';
import { Press } from '../../design/Press';
import { confirmAsync, showToast } from '../../design/Overlay';
import { PRESETS, setModePref, setOneHand, setPreset, themePrefs, useTheme, type PresetId } from '../../design/theme';
import { clearLocaleOverride, hasLocaleOverride, setLocale, translate, useI18n } from '../../i18n';
import { accountStore, ensureBrowserKey, forgetRelay, signOut } from '../../connection/account';
import { allDevices, devicesStore } from '../../connection/devices';
import { DeviceRow, deviceMenu } from '../devices/DeviceSwitcher';
import { DeviceDetail } from '../devices/DeviceDetail';
import { Segmented } from '../thread/ModelPicker';
import { runSelfTest } from './selfTest';
import { enableNotifications, notifyStore } from '../notifications/notifications';
import { NotificationScopeRows } from '../notifications/NotificationScope';
import SOURCE from '../../../vendor/pockymoe/SOURCE.json';

const PRESET_NAME: Record<PresetId, { en: string; zh: string }> = {
  classic: { en: 'Classic', zh: '经典' }, 'plum-pocket': { en: 'Plum Pocket', zh: '梅子口袋' }, terminal: { en: 'Terminal', zh: '终端' },
};

/** The Web's theme cards: four swatches, the name and where it comes from (themePacks registry). */
const SWATCHES: Record<PresetId, string[]> = {
  classic: ['#e2e7e2', '#0f1317', '#008650', '#a2afb9'],
  'plum-pocket': ['#2f1a3b', '#fbf4e8', '#e8a93a', '#f0e0f4'],
  terminal: ['#ffffff', '#0a0a0a', '#0a47c4', '#0b0d0c', '#4de3a2'],
};
const ORIGIN: Record<PresetId, string | null> = { classic: null, 'plum-pocket': '1.0.0', terminal: '0.1.0' };

function ThemeCard({ id, selected, onPress, locale }: { id: PresetId; selected: boolean; onPress: () => void; locale: string }) {
  const t = useTheme();
  const name = PRESET_NAME[id][locale === 'zh-CN' ? 'zh' : 'en'];
  const origin = ORIGIN[id] ? translate('native.themeVersion', { value1: ORIGIN[id] }) : translate('files.themeBuiltIn');
  return (
    <Press onPress={onPress} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${name}, ${origin}`} testID={`theme-${id}`} radius={t.radius.md}
      style={{ width: '48.5%', padding: 12, gap: 10, borderRadius: t.radius.md, borderWidth: selected ? 2 : 1, borderColor: selected ? t.c.primarySolid : t.c.border, backgroundColor: t.c.panel,
        margin: selected ? 0 : 1 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {SWATCHES[id].slice(0, 4).map((color, i) => <View key={i} style={{ flex: 1, height: 22, borderRadius: t.terminal ? 0 : 4, backgroundColor: color, borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' }} />)}
      </View>
      <View>
        <AppText variant="callout" weight="semibold" numberOfLines={1}>{name}</AppText>
        <AppText variant="footnote" tone="soft" numberOfLines={1}>{origin}</AppText>
      </View>
    </Press>
  );
}

/** The account at the top of its section: initial, name, email and relay. */
function AccountHeader({ name, email, origin, signedIn }: { name: string; email?: string | null; origin: string; signedIn: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }} accessible accessibilityLabel={[name, email, origin].filter(Boolean).join(', ')}>
      {signedIn ? <AccountAvatar name={name} size={44} /> : (
        <View style={{ width: 44, height: 44, borderRadius: t.terminal ? 0 : 22, backgroundColor: t.c.panel, borderWidth: 1, borderColor: t.c.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
          <Cloud size={20} color={t.c.fgSoft} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="headline" numberOfLines={1}>{name}</AppText>
        {email && email !== name ? <AppText variant="footnote" tone="muted" numberOfLines={1}>{email}</AppText> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
          <Cloud size={12} color={t.c.fgMuted} />
          <AppText variant="footnote" tone="muted" numberOfLines={1}>{origin.replace(/^https?:\/\//, '')}</AppText>
        </View>
      </View>
    </View>
  );
}

type Tab = 'preferences' | 'notifications' | 'account';

export function SettingsView({ onBack, onAddSupervisor, onSwitchRelay, onSignIn }: { onBack?: () => void; onAddSupervisor: () => void; onSwitchRelay: () => void; onSignIn?: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { locale } = useI18n();
  const prefs = themePrefs.useValue(s => s);
  const account = accountStore.useValue(s => s);
  const devices = devicesStore.useValue(allDevices, (a, b) => a.length === b.length && a.every((d, i) => d === b[i]));
  const [test, setTest] = useState<string[] | null>(null);
  const [tab, setTab] = useState<Tab>('preferences');
  const [detail, setDetail] = useState<string | null>(null);
  // When each group of preferences last changed, for its "Saved" mark.
  const [saved, setSaved] = useState({ appearance: 0, language: 0 });
  const mark = (key: keyof typeof saved) => setSaved(s => ({ ...s, [key]: Date.now() }));
  const notify = notifyStore.useValue(s => s);
  const langValue = hasLocaleOverride() ? locale : 'system';
  const name = account.user?.username ?? account.user?.email ?? translate('native.signedOut');
  const showing = t.mode === 'dark' ? translate('files.dark') : translate('files.light');
  const modeHint = prefs.mode === 'light' ? translate('files.alwaysUseTheBrightTheme') : prefs.mode === 'dark' ? translate('files.alwaysUseTheDarkTheme') : translate('files.followTheOperatingSystemAppearance');
  const tabs: { key: Tab; label: string; account?: boolean }[] = [
    { key: 'preferences', label: translate('files.preferences') },
    { key: 'notifications', label: translate('settings.notificationsTab'), account: true },
    { key: 'account', label: translate('native.account') },
  ];
  return (
    <View style={{ flex: 1, backgroundColor: t.c.panel }}>
      <AppBar onBack={onBack} title={translate('workbench.settings')} subtitle={translate('native.settingsDescription')} />
      {/* The Web's settings tabs: Preferences, Notifications (account-wide, the person mark), Account. */}
      <View style={{ backgroundColor: t.c.bg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.c.border, paddingLeft: insets.left, paddingRight: insets.right }}>
        <View style={{ flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 6, width: '100%', maxWidth: 680, alignSelf: 'center' }} accessibilityRole="tablist">
          {tabs.map(x => {
            const on = tab === x.key;
            return (
              <Press key={x.key} onPress={() => setTab(x.key)} feedback="dim" accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={x.account ? `${x.label}, ${translate('settings.accountScope')}` : x.label} testID={`settings-tab-${x.key}`}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 10, borderRadius: t.radius.md, borderWidth: 1,
                  borderColor: on ? t.c.border : 'transparent', backgroundColor: on ? t.c.panel : 'transparent' }}>
                <AppText variant="subhead" weight="medium" color={on ? t.c.accentStrong : t.c.fgSoft}>{x.label}</AppText>
                {x.account ? <UserRound size={13} color={on ? t.c.accentStrong : t.c.fgMuted} /> : null}
              </Press>
            );
          })}
        </View>
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24, paddingLeft: insets.left, paddingRight: insets.right }}>
        <View style={{ width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 14 }}>
          {tab === 'preferences' ? (
            <>
              <SettingBlock first title={translate('files.preferences')} description={translate('files.appearanceAndConversationDisplayTailoredToYou')} accessory={<SavedMark at={Math.max(saved.appearance, saved.language)} />} />
              <SettingBlock title={translate('common.language')} description={translate('native.languageDescription')}
                inline={<SelectButton label={translate('common.language')} value={langValue} onChange={v => { if (v === 'system') clearLocaleOverride(); else setLocale(v); mark('language'); }}
                  options={[{ value: 'system', label: translate('native.system') }, { value: 'en', label: 'English' }, { value: 'zh-CN', label: '简体中文' }]} />} />
              <SettingBlock title={translate('files.themePreset')} description={translate('native.themeDescription')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 }} accessibilityRole="radiogroup" accessibilityLabel={translate('files.themePreset')}>
                  {PRESETS.map(id => <ThemeCard key={id} id={id} selected={prefs.preset === id} onPress={() => { if (prefs.preset !== id) { setPreset(id); mark('appearance'); } }} locale={locale} />)}
                </View>
              </SettingBlock>
              <SettingBlock title={translate('files.colorMode')} description={translate('native.colorModeShowing', { value1: showing })}>
                <Segmented label={translate('files.colorMode')} value={prefs.mode} onChange={v => { setModePref(v); mark('appearance'); }}
                  options={[{ value: 'light', label: translate('files.light') }, { value: 'dark', label: translate('files.dark') }, { value: 'system', label: translate('files.system') }]} />
                <AppText variant="footnote" tone="soft">{modeHint}</AppText>
              </SettingBlock>
              <SettingBlock title={translate('workbench.phoneDockSetting')} description={translate('workbench.phoneDockSettingHint')}
                inline={<Checkbox value={prefs.oneHand} onValueChange={v => { setOneHand(v); mark('appearance'); }} label={translate('workbench.phoneDockSetting')} />} />
            </>
          ) : tab === 'notifications' ? (
            <>
              {account.phase === 'ready' ? (
                <SettingBlock first title={translate('settings.notificationsTab')} description={translate('settings.notificationsDescription')}>
                  <AppText variant="callout" tone="soft">{translate('settings.accountScope')}</AppText>
                  <NotificationScopeRows />
                </SettingBlock>
              ) : null}
              <SettingBlock first={account.phase !== 'ready'} title={translate('native.systemNotifications')}
                description={notify.permission === 'denied' ? translate('native.notificationsDenied') : notify.native === 'unavailable' ? translate('native.apnsUnavailable') : notify.native === 'registered' ? translate('native.apnsRegistered') : translate('native.systemNotificationsBody')}
                inline={<Checkbox value={notify.permission === 'granted'} onValueChange={v => { if (v) void enableNotifications(); }} label={translate('native.systemNotifications')} />} />
            </>
          ) : (
            <View style={{ paddingTop: 12 }}>
              {account.origin ? (
                <Section title={translate('native.account')} footer={account.safetyCode ? translate('native.safetyCodeHint') : undefined} style={{ marginHorizontal: -12 }}>
                  <AccountHeader name={name} email={account.user?.email} origin={account.origin} signedIn={!!account.user} />
                  <View style={{ height: 1, backgroundColor: t.c.border, marginLeft: 14 }} />
                  {account.safetyCode ? <Row title={translate('native.safetyCode')} icon={Fingerprint} numberOfLines={2}
                    trailing={<View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <AppText variant="mono" weight="semibold" tone="soft" selectable>{account.safetyCode}</AppText>
                      <CopyButton value={account.safetyCode} label={translate('native.copySafetyCode')} />
                    </View>} /> : null}
                  {account.phase === 'ready' ? <Row title={translate('native.appKey')} subtitle={account.hasBrowserKey ? translate('native.appKeyOk') : translate('native.appKeyMissing')} icon={KeyRound}
                    trailing={account.hasBrowserKey ? <Check size={18} color={t.c.success} /> : undefined}
                    onPress={account.hasBrowserKey ? undefined : () => void ensureBrowserKey().catch(e => showToast(String(e?.message ?? e), 'error'))} /> : null}
                  {account.phase !== 'ready' && onSignIn ? <Row title={translate('auth.signIn')} icon={LogIn} onPress={onSignIn} chevron /> : null}
                  <Row title={translate('native.switchRelay')} icon={Globe} onPress={onSwitchRelay} chevron />
                  {account.phase === 'ready' ? <Row title={translate('auth.logOut')} icon={LogOut} destructive last onPress={async () => {
                    if (await confirmAsync({ title: translate('auth.logOut'), message: translate('native.signOutBody'), confirmLabel: translate('auth.logOut'), destructive: true })) await signOut();
                  }} /> : <Row title={translate('native.forgetRelay')} icon={Trash2} destructive last onPress={() => void forgetRelay()} />}
                </Section>
              ) : null}
              <Section title={translate('files.deviceManagement')} style={{ marginHorizontal: -12 }}>
                <View style={{ paddingHorizontal: 4, paddingVertical: 4 }}>
                  {devices.map(d => <DeviceRow key={d.key} device={d} role="button" onPress={() => setDetail(d.key)} onMore={anchor => deviceMenu(d, () => setDetail(d.key), anchor)} />)}
                </View>
                <View style={{ height: 1, backgroundColor: t.c.border }} />
                <Row title={translate('native.addSupervisor')} icon={Plus} onPress={onAddSupervisor} last />
              </Section>
              <Section title={translate('native.about')} style={{ marginHorizontal: -12 }}>
                <Row title="Pockymoe" value={`${Constants.expoConfig?.version ?? ''} (${Constants.expoConfig?.extra?.variant ?? 'dev'})`} />
                <Row title={translate('native.protocolSource')} value={SOURCE.sources.map(s => s.commit.slice(0, 8)).join(' · ')} />
                <Row title={translate('native.selfTest')} icon={Activity} last onPress={() => { setTest(['…']); void runSelfTest().then(setTest); }}
                  subtitle={test ? test.join('\n') : translate('native.selfTestBody')} numberOfLines={1} />
              </Section>
            </View>
          )}
        </View>
      </ScrollView>
      <DeviceDetail deviceKey={detail} onClose={() => setDetail(null)} />
    </View>
  );
}
