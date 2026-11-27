// App-wide overlays: the object menu, confirmations and toasts. One host renders them
// above everything (§4: secondary windows render at the root, never inside a row).
import { useEffect, useState, type ComponentType } from 'react';
import { Modal, Platform, Pressable, useWindowDimensions, View, AccessibilityInfo } from 'react-native';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import { Check, AlertTriangle } from 'lucide-react-native';
import type { LucideProps } from 'lucide-react-native';
import { createStore } from '../state/store';
import { Press } from './Press';
import { AppText } from './AppText';
import { Button } from './Button';
import { Sheet, setOverlayRenderer, useModalKey, useNoSheetOpen } from './Sheet';
import { useTheme } from './theme';
import { haptic } from './haptics';
import { translate } from '../i18n';

export interface MenuItem {
  label: string; icon?: ComponentType<LucideProps>; onPress?: () => void | Promise<void>; destructive?: boolean; disabled?: boolean;
  checked?: boolean; hint?: string;
  /** A copy item gives feedback on itself (§2): check and "Copied", then the menu closes. */
  copy?: string;
}
export interface Anchor { x: number; y: number; width: number; height: number }
interface MenuRequest { title?: string; subtitle?: string; items: MenuItem[]; anchor?: Anchor }
interface ConfirmRequest { title: string; message?: string; confirmLabel: string; cancelLabel?: string; destructive?: boolean; resolve: (ok: boolean) => void }
interface Toast { id: number; text: string; tone: 'info' | 'error' | 'success' }

const overlay = createStore<{ menu: MenuRequest | null; confirm: ConfirmRequest | null; toasts: Toast[] }>({ menu: null, confirm: null, toasts: [] });
export function showMenu(request: MenuRequest) { overlay.set({ menu: request }); }
export function closeMenu() { overlay.set({ menu: null }); }
/** The `confirmAsync` of the Web: resolves true only on the confirm button. */
export function confirmAsync(request: Omit<ConfirmRequest, 'resolve'>) {
  return new Promise<boolean>(resolve => overlay.set({ confirm: { ...request, resolve } }));
}
let toastId = 0;
export function showToast(text: string, tone: Toast['tone'] = 'info') {
  const toast = { id: ++toastId, text, tone };
  overlay.set(s => ({ toasts: [...s.toasts.slice(-2), toast] }));
  AccessibilityInfo.announceForAccessibility(text);
  setTimeout(() => overlay.set(s => ({ toasts: s.toasts.filter(x => x.id !== toast.id) })), tone === 'error' ? 5000 : 2600);
}

function MenuRow({ item, onDone }: { item: MenuItem; onDone: (after?: () => void) => void }) {
  const t = useTheme();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const Icon = state === 'copied' ? Check : state === 'failed' ? AlertTriangle : item.icon;
  const color = state === 'failed' || item.destructive ? t.c.failed : t.c.fg;
  const run = async () => {
    if (item.copy !== undefined) {
      try { await Clipboard.setStringAsync(item.copy); setState('copied'); AccessibilityInfo.announceForAccessibility(translate('common.copied')); setTimeout(onDone, 700); }
      catch { setState('failed'); }
      return;
    }
    // The action runs once the menu's window is gone: on iOS a picker, sheet or confirmation it
    // presents while the menu is still dismissing never shows.
    onDone(item.onPress ? () => void item.onPress?.() : undefined);
  };
  return (
    <Press onPress={() => void run()} disabled={item.disabled}
      // "menuitem" has no trait on iOS: VoiceOver would read the row as plain text, not a button.
      accessibilityRole={Platform.OS === 'ios' ? 'button' : 'menuitem'} accessibilityLabel={item.label}
      accessibilityState={{ disabled: !!item.disabled, checked: item.checked }}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 14, borderRadius: t.radius.sm }}>
      {Icon ? <Icon size={18} color={color} /> : <View style={{ width: 18 }} />}
      <View style={{ flex: 1 }}>
        <AppText variant="callout" color={color} numberOfLines={1}>{state === 'copied' ? translate('common.copied') : state === 'failed' ? translate('common.copyFailed') : item.label}</AppText>
        {item.hint ? <AppText variant="footnote" tone="muted" numberOfLines={1}>{item.hint}</AppText> : null}
      </View>
      {item.checked ? <Check size={18} color={t.c.accentStrong} /> : null}
    </Press>
  );
}

function MenuHost() {
  const t = useTheme();
  const modalKey = useModalKey();
  const current = overlay.useValue(s => s.menu);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // The last menu stays rendered while its sheet slides away, so closing animates.
  const [last, setLast] = useState<MenuRequest | null>(current);
  useEffect(() => { if (current) setLast(current); }, [current]);
  const menu = current ?? last;
  // A row's action, run after the menu has closed (Sheet onClosed, or the popover's unmount).
  const [after, setAfter] = useState<(() => void) | null>(null);
  const popover = !!menu?.anchor;
  // Android has no Modal onDismiss and no presentation limit: run it on the next frame there.
  useEffect(() => {
    if (Platform.OS === 'ios' || current || !after || !popover) return;
    const id = requestAnimationFrame(() => { const fn = after; setAfter(null); fn(); });
    return () => cancelAnimationFrame(id);
  }, [current, after, popover]);
  const popoverDismissed = () => { if (after) { const fn = after; setAfter(null); fn(); } };
  if (!menu) return null;
  const close = (fn?: () => void) => { if (fn) setAfter(() => fn); closeMenu(); };
  const sheetClosed = () => { if (after) { const fn = after; setAfter(null); fn(); } };
  const rows = menu.items.map((item, i) => <MenuRow key={`${i}:${item.label}`} item={item} onDone={close} />);
  // A menu opened from a button is a popover anchored to it at every width, as on the Web
  // phone; one without an anchor (a long press) or too tall for the window rises as a sheet.
  const menuWidth = Math.min(280, width - 16);
  const estimated = menu.items.length * 46 + 16 + (menu.title ? (menu.subtitle ? 54 : 38) : 0);
  if (!menu.anchor || estimated > height - insets.top - insets.bottom - 16) {
    return <Sheet visible={!!current} onClose={() => close()} onClosed={sheetClosed} overlayLayer={false} title={menu.title} subtitle={menu.subtitle}><View style={{ marginHorizontal: -6 }}>{rows}</View></Sheet>;
  }
  // iOS: keep the popover's Modal mounted, hidden, until UIKit reports it dismissed (onDismiss).
  if (!current && !(Platform.OS === 'ios' && after)) return null;
  const below = menu.anchor.y + menu.anchor.height + 6;
  const top = below + estimated < height - insets.bottom - 8 ? below : Math.max(insets.top + 8, menu.anchor.y - estimated - 6);
  const left = Math.min(Math.max(8, menu.anchor.x + menu.anchor.width - menuWidth), width - menuWidth - 8);
  return (
    <Modal key={modalKey} transparent visible={!!current} onDismiss={popoverDismissed} animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <Pressable style={{ flex: 1 }} onPress={() => close()} accessibilityLabel={translate('workbench.close')} />
      <Animated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)} accessibilityRole="menu"
        style={{ position: 'absolute', top, left, width: menuWidth, padding: 6, backgroundColor: t.c.panel, borderRadius: t.radius.lg, borderWidth: 1, borderColor: t.c.borderStrong,
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 12 }}>
        {menu.title ? (
          // The Web menu header: the object's name, an optional second line, then a rule.
          <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, marginBottom: 4, borderBottomWidth: 1, borderBottomColor: t.c.border }}>
            <AppText variant="subhead" weight="semibold" numberOfLines={1} accessibilityRole="header">{menu.title}</AppText>
            {menu.subtitle ? <AppText variant="footnote" tone="muted" numberOfLines={1}>{menu.subtitle}</AppText> : null}
          </View>
        ) : null}
        {rows}
      </Animated.View>
    </Modal>
  );
}

function ConfirmHost() {
  const confirm = overlay.useValue(s => s.confirm);
  if (!confirm) return null;
  const finish = (ok: boolean) => { overlay.set({ confirm: null }); confirm.resolve(ok); };
  return (
    <Sheet visible overlayLayer={false} onClose={() => finish(false)} title={confirm.title}
      footer={<>
        <Button label={confirm.cancelLabel ?? translate('workbench.cancel')} onPress={() => finish(false)} style={{ flex: 1, maxWidth: 200 }} />
        <Button label={confirm.confirmLabel} kind={confirm.destructive ? 'danger' : 'primary'} onPress={() => { if (confirm.destructive) haptic.warning(); finish(true); }} style={{ flex: 1, maxWidth: 200 }} testID="confirm-ok" />
      </>}>
      {confirm.message ? <AppText variant="callout" tone="soft">{confirm.message}</AppText> : null}
    </Sheet>
  );
}

function ToastHost() {
  const t = useTheme();
  const toasts = overlay.useValue(s => s.toasts);
  const insets = useSafeAreaInsets();
  if (!toasts.length) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 84, alignItems: 'center', gap: 8 }}>
      {toasts.map(toast => (
        <Animated.View key={toast.id} entering={SlideInDown.springify().damping(20)} exiting={SlideOutDown.duration(160)} accessibilityLiveRegion="polite"
          style={{ maxWidth: 520, marginHorizontal: 16, paddingHorizontal: 14, paddingVertical: 10, borderRadius: t.radius.md, backgroundColor: toast.tone === 'error' ? t.c.dangerSolid : t.c.fg,
            shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, elevation: 8 }}>
          <AppText variant="subhead" color={toast.tone === 'error' ? '#fff' : t.c.bg}>{toast.text}</AppText>
        </Animated.View>
      ))}
    </View>
  );
}

const Hosts = () => <><MenuHost /><ConfirmHost /><ToastHost /></>;
setOverlayRenderer(() => <Hosts />);
export function OverlayHost() {
  useEffect(() => () => { overlay.set({ menu: null, confirm: null }); }, []);
  // With a Sheet open, the topmost Sheet renders the overlays inside its Modal (Sheet.tsx).
  return useNoSheetOpen() ? <Hosts /> : null;
}
