# Install the native iOS app with a free Apple ID

Without an Apple Developer Program membership, Xcode can still sign the app for your own iPhone with
the **Personal Team** of a free Apple ID and install it over a cable. This builds a Release app with
the JavaScript bundled, so no Metro server is needed.

## What a Personal Team can sign

Apple's [Supported capabilities (iOS)](https://developer.apple.com/help/account/reference/supported-capabilities-ios)
table has a column for free "Apple Developer" accounts ("No cost is associated with this agreement and
developers can't distribute apps"). In that column:

| Capability | Free Apple ID | Used by the app for |
|---|---|---|
| Push notifications | **no** | relay push (APNs) and push-updated Live Activities |
| App groups | yes | the Live Activity widget's thread titles |
| Keychain sharing | yes | (not needed; the app uses its own keychain items) |
| Background modes | yes | (not needed) |

Widget extensions and Live Activities are not capabilities in that table: they need no entitlement
(`NSSupportsLiveActivities` in Info.plist), only push updates do.

So the Personal Team build (`POCKYMOE_IOS_SIGNING=personal`, read by `app.config.ts`):

- leaves out `aps-environment`; the app never asks for an APNs token, and Settings → Notifications
  says this build cannot receive relay push. Notices still come from the app's own connections
  while it runs;
- keeps the Live Activity, started and updated by the app while it runs; without push it is not
  updated while the app is closed;
- keeps the app group (`group.<bundle id>`) for the widget's titles.

## Steps from a clean Mac

1. Install **Xcode 26.4 or later** from the App Store (Expo SDK 58 needs it), open it once and let
   it install the iOS platform. Install [Homebrew](https://brew.sh), then:

   ```sh
   brew install node@22 cocoapods git
   ```

   The native app uses npm (it comes with Node); pnpm is only for `desktop/`.
2. In Xcode → Settings → Accounts, add your Apple ID. A team "Your Name (Personal Team)" appears.
   Its **Team ID** (10 characters) is shown when you select the team, or later in the project's
   Signing & Capabilities pane.
3. Get the code:

   ```sh
   git clone https://github.com/dufangshi/pockymoe-app.git   # or: git -C pockymoe-app pull
   cd pockymoe-app
   ```

4. Connect the iPhone by cable, unlock it and tap **Trust This Computer**. Turn on **Developer
   Mode**: Settings → Privacy & Security → Developer Mode → On, then restart the phone (the switch
   appears after Xcode has seen the phone once).
5. Build and install with one command:

   ```sh
   POCKYMOE_IOS_TEAM_ID=YOURTEAMID native/scripts/ios-device-install.sh
   ```

   It runs `npm ci`, `npx expo prebuild --platform ios --clean` (which also runs `pod install`) with
   `POCKYMOE_IOS_SIGNING=personal` and `APP_VARIANT=production`, then
   `npx expo run:ios --configuration Release --device`, which asks which connected device to use.
   If Xcode reports that the bundle id `com.pockymoe.app` is not available to your team, choose your
   own, for example `POCKYMOE_IOS_BUNDLE_ID=com.yourname.pockymoe`.

   Or do it in Xcode:

   ```sh
   cd native
   npm ci
   POCKYMOE_IOS_SIGNING=personal APP_VARIANT=production npx expo prebuild --platform ios --clean
   open ios/Pockymoe.xcworkspace
   ```

   (If prebuild skipped CocoaPods, run `cd ios && pod install` first.) In Xcode select the
   **Pockymoe** target → Signing & Capabilities → Team: your Personal Team, and the same for the
   **PockymoeLiveActivity** target. Product → Scheme → Edit Scheme → Run → Build Configuration:
   **Release**. Pick your iPhone as the run destination and press Run.
6. The first launch is refused until you trust your developer certificate on the phone:
   Settings → General → VPN & Device Management → your Apple ID under Developer App → Trust.
7. Open Pockymoe, add your Supervisor or sign in to your relay.

## Every seven days

Xcode's free provisioning profile for a Personal Team expires after 7 days; the app then stops
opening. Connect the phone and run the command (or press Run in Xcode) again. Your data stays.

## What to expect

- No relay push: turn notices arrive only while the app is open (or briefly in the background).
- The Live Activity shows running threads from the app; it does not update while the app is closed.
- Everything else (relay and direct Supervisors, threads, Git, files, settings) is the same as in
  a developer-signed build.

With a paid membership later, build without `POCKYMOE_IOS_SIGNING` (the standard signing): push
and push-updated Live Activities need the relay's APNs key and topic (owner step).
