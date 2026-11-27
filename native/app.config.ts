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

// Releases carry the same version as the WebView client: read from its Gradle file, which the
// client release checks against the release version, so v0.4.0 ships native 0.4.0 (versionCode
// too). Outside the repo (a copied native/ folder) the fallback applies.
function clientVersion(): { name: string; code: number } {
  try {
    const gradle = require('node:fs').readFileSync(require('node:path').join(__dirname, '../android/app/build.gradle.kts'), 'utf8') as string;
    const name = /versionName = "([^"]+)"/.exec(gradle)?.[1];
    const code = Number(/versionCode = (\d+)/.exec(gradle)?.[1]);
    if (name && code) return { name, code };
  } catch { /* not in the repository */ }
  return { name: '0.1.0', code: 1 };
}
const version = clientVersion();

// iOS signing. `standard` needs a paid Apple Developer Program team (push, production APNs).
// `personal`: a free Apple ID's Personal Team, which cannot sign Push Notifications (Apple's
// "Supported capabilities (iOS)" table; App Groups and Keychain sharing are allowed), so the
// build leaves out aps-environment, the app skips push registration and the Live Activity runs
// without push updates. A free team may need its own bundle id (POCKYMOE_IOS_BUNDLE_ID) and its
// team id (POCKYMOE_IOS_TEAM_ID). See docs/ios-install-personal.md.
const iosSigning = process.env.POCKYMOE_IOS_SIGNING === 'personal' ? 'personal' : 'standard';
const iosBundleId = process.env.POCKYMOE_IOS_BUNDLE_ID?.trim() || ids.id;
const iosTeamId = process.env.POCKYMOE_IOS_TEAM_ID?.trim() || undefined;
const iosPush = iosSigning !== 'personal';

// Android ABIs: release builds for phones only (arm64-v8a; Android phones of the last years are
// 64-bit ARM); development and preview builds also run on x86_64 emulators and 32-bit ARM.
// POCKYMOE_ANDROID_ABIS (comma-separated) overrides, e.g. to try a release build on an emulator.
const androidAbis = process.env.POCKYMOE_ANDROID_ABIS?.split(',').map((abi: string) => abi.trim()).filter(Boolean)
  ?? (variant === 'production' ? ['arm64-v8a'] : ['arm64-v8a', 'armeabi-v7a', 'x86_64']);

const config: ExpoConfig = {
  name: ids.name,
  slug: 'pockymoe-native',
  version: version.name,
  scheme: ids.scheme,
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  // Classic's page colour (the default preset), so launch does not flash a second colour.
  backgroundColor: '#e0e4e0',
  ios: {
    bundleIdentifier: iosBundleId,
    ...(iosTeamId ? { appleTeamId: iosTeamId } : {}),
    buildNumber: String(version.code),
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
      // The account Live Activity (targets/live-activity), kept current by the relay over APNs.
      NSSupportsLiveActivities: true,
      // Whether this build may ask APNs for tokens (LiveActivityManager, notifications.ts).
      PockymoeNativePush: iosPush,
      // Direct Supervisors: LAN names and IP addresses are local networking; Tailscale
      // MagicDNS names (*.ts.net) are the other plain-HTTP case a self-hosted Supervisor has.
      NSAppTransportSecurity: {
        NSAllowsArbitraryLoads: false,
        NSAllowsLocalNetworking: true,
        NSExceptionDomains: { 'ts.net': { NSIncludesSubdomains: true, NSExceptionAllowsInsecureHTTPLoads: true } },
      },
    },
    // Shared with the Live Activity widget for thread titles (ActivityMetadataCache). Device builds
    // need this app group registered for the app id in the owner's Apple account.
    entitlements: { 'com.apple.security.application-groups': [`group.${iosBundleId}`] },
  },
  locales: { 'zh-Hans': './locales/zh-Hans.json' },
  android: {
    package: ids.id,
    versionCode: version.code,
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
      android: {
        usesCleartextTraffic: true, minSdkVersion: 26, buildArchs: androidAbis,
        // Release APKs: R8 removes unused code and resources, and native libraries are stored
        // compressed (a smaller download; Android extracts them at install).
        enableMinifyInReleaseBuilds: true,
        enableShrinkResourcesInReleaseBuilds: true,
        useLegacyPackaging: true,
      },
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
    // The Live Activity widget extension (targets/live-activity).
    '@bacons/apple-targets',
    // Status-bar icon: the >_ badge of the basket logo as a white disc (the full logo is a blob
    // at 24 dp); tinted with Classic's primary fill. aps-environment: Apple's sandbox for
    // development builds, production for preview and release, none for a Personal Team.
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#008650', mode: variant === 'development' ? 'development' : 'production', enableRemoteNotifications: iosPush }],
    // Release APKs signed with the client release keystore (plugins/withReleaseSigning.js).
    './plugins/withReleaseSigning',
    'react-native-quick-crypto',
  ],
  experiments: { reactCompiler: true },
  extra: { variant, iosSigning },
};

export default config;
