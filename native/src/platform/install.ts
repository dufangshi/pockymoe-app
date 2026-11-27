// Installs the native session transport before any vendored module issues a request.
import './idb/install';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { installRelayFetch } from './relaySession';
import { relayTokens } from '../connection/secrets';

// Read straight from the module: this file runs before the app's other modules load.
const native = requireOptionalNativeModule<{ clearCookies?(url: string): Promise<void> }>('PockymoeNative');
installRelayFetch(relayTokens, { clear: native?.clearCookies ? url => native.clearCookies!(url) : undefined });
