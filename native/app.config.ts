import type { ExpoConfig } from 'expo/config';

// The native client is `com.pockymoe.app` (owner decision 2026-11-26). The WebView shell keeps
// `com.remotecodex.app`, so both install side by side. Development and preview builds add a
// suffix so they install beside a release build too. The URL scheme stays apart from the
// shell's `pockymoe://` (its relay sign-in callback), or Android would ask which app opens it.
type Variant = 'development' | 'preview' | 'production';
const variant: Variant = process.env.APP_VARIANT === 'production' ? 'production' : process.env.APP_VARIANT === 'preview' ? 'preview' : 'development';
const ids = {
  development: { name: 'Pockymoe Dev', id: 'com.pockymoe.app.dev', scheme: 'pockymoe-app-dev' },
  preview: { name: 'Pockymoe Preview', id: 'com.pockymoe.app.preview', scheme: 'pockymoe-app-preview' },
  production: { name: 'Pockymoe', id: 'com.pockymoe.app', scheme: 'pockymoe-app' },
}[variant];

const config: ExpoConfig = {
  name: ids.name,
  slug: 'pockymoe-native',
  version: '0.1.0',
  scheme: ids.scheme,
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // Classic's page colour (the default preset), so launch does not flash a second colour.
  backgroundColor: '#e0e4e0',
  ios: {
    bundleIdentifier: ids.id,
    supportsTablet: true,
    requireFullScreen: false,
    infoPlist: {
      NSCameraUsageDescription: 'Take a photo to attach to a prompt.',
      NSPhotoLibraryUsageDescription: 'Attach photos to a prompt.',
      NSLocalNetworkUsageDescription: 'Connect to a Pockymoe Supervisor on your network.',
      ITSAppUsesNonExemptEncryption: false,
      // The status bar follows expo-status-bar (App.tsx), not each view controller; otherwise its
      // icons stay dark on every dark theme.
      UIViewControllerBasedStatusBarAppearance: false,
      // Direct Supervisors: LAN names and IP addresses are local networking; Tailscale
      // MagicDNS names (*.ts.net) are the other plain-HTTP case a self-hosted Supervisor has.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: { 'ts.net': { NSIncludesSubdomains: true, NSExceptionAllowsInsecureHTTPLoads: true } },
      },
    },
  },
  locales: { 'zh-Hans': './locales/zh-Hans.json' },
  android: {
    package: ids.id,
    // The basket logo the Web and desktop use (owner decision 2026-11-26); the purple is the
    // logo's own edge colour, so the adaptive mask never shows a seam.
    adaptiveIcon: {
      backgroundColor: '#341c42',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: true,
    softwareKeyboardLayoutMode: 'resize',
    permissions: ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'],
    blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.SYSTEM_ALERT_WINDOW'],
  },
  plugins: [
    ['expo-build-properties', {
      android: { usesCleartextTraffic: true, minSdkVersion: 26 },
      ios: { deploymentTarget: '17.0' },
    }],
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 160, backgroundColor: '#e0e4e0',
      dark: { image: './assets/splash-icon.png', backgroundColor: '#0c0f11' } }],
    'expo-font',
    'expo-localization',
    // No biometric gate on stored keys, so no Face ID prompt text.
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-sqlite',
    'expo-image',
    'expo-sharing',
    ['expo-image-picker', { cameraPermission: 'Take a photo to attach to a prompt.', microphonePermission: false }],
    // Status-bar icon: the >_ badge of the basket logo as a white disc (the full logo is a blob
    // at 24 dp); tinted with Classic's primary fill.
    // aps-environment: Apple's sandbox for development builds, production for preview and release.
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#008650', mode: variant === 'development' ? 'development' : 'production' }],
    'react-native-quick-crypto',
  ],
  experiments: { reactCompiler: true },
  extra: { variant },
};

export default config;
