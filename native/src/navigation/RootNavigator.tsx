import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { accountStore } from '../connection/account';
import { devicesStore } from '../connection/devices';
import { ConnectChoice, DirectConnect, RegisterScreen, RelayAddress, SignIn } from '../features/connect/screens';
import { SettingsView } from '../features/settings/SettingsView';
import { NewThreadView } from '../features/thread/NewThreadView';
import { ThreadScreen, Workbench } from '../layout/Workbench';
import { PullRequestScreen, PullRequestsShell } from '../layout/PullRequestsShell';
import { useLayout } from '../layout/layout';
import { Loading } from '../design/States';
import { modalRoute, pageRoute, rootRoute } from './presets';
import type { RootStack } from './routes';

const Stack = createNativeStackNavigator<RootStack>();
type Nav = NativeStackNavigationProp<RootStack>;

function ConnectScreen() { const nav = useNavigation<Nav>(); return <ConnectChoice onRelay={() => nav.push('RelayAddress')} onDirect={() => nav.push('DirectConnect')} />; }
function RelayAddressScreen() { const nav = useNavigation<Nav>(); return <RelayAddress onBack={() => nav.goBack()} onDone={() => nav.navigate('SignIn')} />; }
function SignInScreen() { const nav = useNavigation<Nav>(); return <SignIn onBack={() => nav.canGoBack() ? nav.goBack() : nav.navigate('RelayAddress')} onRegister={() => nav.push('Register')} />; }
function DirectScreen() { const nav = useNavigation<Nav>(); return <DirectConnect onBack={() => nav.goBack()} onDone={() => nav.canGoBack() && nav.goBack()} />; }
function ThreadRoute({ route }: NativeStackScreenProps<RootStack, 'Thread'>) { return <ThreadScreen deviceKey={route.params.deviceKey} threadId={route.params.threadId} />; }
function NewThreadRoute({ route, navigation }: NativeStackScreenProps<RootStack, 'NewThread'>) {
  return <NewThreadView deviceKey={route.params.deviceKey} workspaceId={route.params.workspaceId} onBack={() => navigation.goBack()}
    onCreated={threadId => navigation.replace('Thread', { deviceKey: route.params.deviceKey, threadId })} />;
}
function PullRequestsRoute({ route }: NativeStackScreenProps<RootStack, 'PullRequests'>) { return <PullRequestsShell deviceKey={route.params.deviceKey} />; }
function PullRequestRoute({ route }: NativeStackScreenProps<RootStack, 'PullRequest'>) { return <PullRequestScreen deviceKey={route.params.deviceKey} url={route.params.url} />; }
function SettingsScreen() {
  const nav = useNavigation<Nav>();
  return <SettingsView onBack={() => nav.goBack()} onAddSupervisor={() => nav.push('DirectConnect')} onSwitchRelay={() => nav.push('RelayAddress')} onSignIn={() => nav.push('SignIn')} />;
}

export function RootNavigator() {
  const phase = accountStore.useValue(s => s.phase);
  const hasDirect = devicesStore.useValue(s => s.direct.length > 0);
  const layout = useLayout();
  if (phase === 'checking') return <Loading />;
  const signedIn = phase === 'ready' || phase === 'setupOnWeb' || hasDirect;
  const needsSignIn = !signedIn && (phase === 'signedOut' || phase === 'challenge' || phase === 'offline' || phase === 'pendingApproval');
  // Signing in (or out) starts a new stack: the signed-in group also has SignIn, and without
  // a new key React Navigation would keep the reader on the page they just finished.
  const authKey = `${signedIn ? 'in' : 'out'}:${phase === 'ready' ? 'account' : 'none'}`;
  return (
    <Stack.Navigator screenOptions={pageRoute}>
      {signedIn ? (
        <Stack.Group navigationKey={authKey}>
          <Stack.Screen name="Workbench" component={Workbench} options={rootRoute} />
          <Stack.Screen name="Thread" component={ThreadRoute} />
          <Stack.Screen name="NewThread" component={NewThreadRoute} />
          <Stack.Screen name="Settings" component={SettingsScreen} options={layout.split ? modalRoute : pageRoute} />
          <Stack.Screen name="PullRequests" component={PullRequestsRoute} />
          <Stack.Screen name="PullRequest" component={PullRequestRoute} />
          <Stack.Screen name="DirectConnect" component={DirectScreen} />
          <Stack.Screen name="RelayAddress" component={RelayAddressScreen} />
          <Stack.Screen name="SignIn" component={SignInScreen} />
          <Stack.Screen name="Register" component={RegisterScreen} />
        </Stack.Group>
      ) : (
        <Stack.Group navigationKey={authKey}>
          {needsSignIn ? <Stack.Screen name="SignIn" component={SignInScreen} options={rootRoute} /> : <Stack.Screen name="Connect" component={ConnectScreen} options={rootRoute} />}
          <Stack.Screen name="RelayAddress" component={RelayAddressScreen} />
          {needsSignIn ? <Stack.Screen name="Connect" component={ConnectScreen} /> : <Stack.Screen name="SignIn" component={SignInScreen} />}
          <Stack.Screen name="Register" component={RegisterScreen} />
          <Stack.Screen name="DirectConnect" component={DirectScreen} />
        </Stack.Group>
      )}
    </Stack.Navigator>
  );
}
