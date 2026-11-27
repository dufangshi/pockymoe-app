// Plum Pocket's "pocket friends" art, where the Web pack draws it (themes/plum-pocket/styles/
// pages.css): above the sign-in card (176×124) and in empty states (132×92). Appearance only;
// other presets draw nothing.
import { Image } from 'expo-image';
import { useTheme } from './theme';

const FRIENDS = require('../../vendor/pockymoe/runtime/themes/plum-pocket/assets/pocket-friends.webp');

export function PocketFriends({ size = 'empty' }: { size?: 'empty' | 'card' }) {
  const t = useTheme();
  if (!t.plum) return null;
  const [width, height] = size === 'card' ? [176, 124] : [132, 92];
  return <Image source={FRIENDS} style={{ width, height, alignSelf: 'center' }} contentFit="contain" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}
