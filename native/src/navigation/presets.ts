// Route presets (T3 layer 1): what a route is decides its presentation; screens never set
// header or animation options themselves. Bars are drawn in-tree on both platforms.
import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

export const pageRoute: NativeStackNavigationOptions = { headerShown: false, animation: 'default', gestureEnabled: true, fullScreenGestureEnabled: true };
export const rootRoute: NativeStackNavigationOptions = { headerShown: false, animation: 'fade' };
/** Full-height modal pages (settings on phones). */
export const modalRoute: NativeStackNavigationOptions = { headerShown: false, presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: true };
