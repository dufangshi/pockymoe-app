// OVERLAY (native): the exports of the Web's api.ts that vendored modules use
// (gitApi.ts, the pull request modules), on the native transport. `deviceId` is the app's device key.
export { ApiError, deviceRequest, request } from '../../../../../../../src/protocol/webApiShim';
