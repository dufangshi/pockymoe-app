import * as Haptics from 'expo-haptics';
// The Web host contract (docs/mobile-host.md): haptics mark a sent prompt, a new request
// that needs the reader, and a dangerous confirmation. Selection ticks mark discrete
// choices (segmented controls, swipe thresholds), as native controls do.
export const haptic = {
  sent: () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}),
  attention: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {}),
  warning: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}),
  success: () => void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}),
  selection: () => void Haptics.selectionAsync().catch(() => {}),
};
