// Installs the native session transport before any vendored module issues a request.
import './idb/install';
import { installRelayFetch } from './relaySession';
import { relayTokens } from '../connection/secrets';

installRelayFetch(relayTokens);
