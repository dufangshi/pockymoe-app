// Release APKs signed with the client release keystore: the same key as the WebView app (same
// developer identity, different package). Reads the environment the client release passes to the
// WebView build (REMOTE_CODEX_ANDROID_STORE_FILE, _STORE_PASSWORD, _KEY_ALIAS, _KEY_PASSWORD, set by
// scripts/client_release_ci.py from CLIENT_ANDROID_KEYSTORE_BASE64 and friends), or the CLIENT_ANDROID_*
// secrets themselves. Without them a release build keeps React Native's debug signing (local use).
// No key is ever generated, stored in the repository or printed here.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARK = '// pockymoe release signing (plugins/withReleaseSigning.js)';
const BLOCK = `
${MARK}
def pockymoeEnv = { String... names -> names.collect { System.getenv(it) }.find { it } }
def pockymoeStore = pockymoeEnv('REMOTE_CODEX_ANDROID_STORE_FILE')
if (!pockymoeStore && pockymoeEnv('CLIENT_ANDROID_KEYSTORE_BASE64')) {
    def decoded = new File(buildDir, 'pockymoe-signing/release.keystore')
    decoded.parentFile.mkdirs()
    decoded.bytes = pockymoeEnv('CLIENT_ANDROID_KEYSTORE_BASE64').trim().decodeBase64()
    pockymoeStore = decoded.path
}
if (pockymoeStore) {
    // Assigned as properties, never through names that could be read as method calls: Gradle's
    // errors would echo the argument.
    def pockymoeStorePassword = pockymoeEnv('REMOTE_CODEX_ANDROID_STORE_PASSWORD', 'CLIENT_ANDROID_STORE_PASSWORD')
    def pockymoeAlias = pockymoeEnv('REMOTE_CODEX_ANDROID_KEY_ALIAS', 'CLIENT_ANDROID_KEY_ALIAS') ?: 'remote-codex-release'
    def pockymoeKeyPassword = pockymoeEnv('REMOTE_CODEX_ANDROID_KEY_PASSWORD', 'CLIENT_ANDROID_KEY_PASSWORD') ?: pockymoeStorePassword
    def pockymoeConfig = android.signingConfigs.create('pockymoeRelease')
    pockymoeConfig.storeFile = file(pockymoeStore)
    pockymoeConfig.storePassword = pockymoeStorePassword
    pockymoeConfig.keyAlias = pockymoeAlias
    pockymoeConfig.keyPassword = pockymoeKeyPassword
    android.buildTypes.release.signingConfig = pockymoeConfig
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, cfg => {
    if (cfg.modResults.language !== 'groovy') throw new Error('withReleaseSigning expects a Groovy app/build.gradle');
    if (!cfg.modResults.contents.includes(MARK)) cfg.modResults.contents += BLOCK;
    return cfg;
  });
};
