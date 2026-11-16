async function verifyReleaseFuses(app) {
  const { getCurrentFuseWire, FuseVersion, FuseV1Options, FuseState } = await import('@electron/fuses');
  const wire = await getCurrentFuseWire(app);
  if (wire.version !== FuseVersion.V1
    || wire[FuseV1Options.EnableNodeCliInspectArguments] !== FuseState.DISABLE
    || wire[FuseV1Options.RunAsNode] !== FuseState.ENABLE) {
    throw new Error('Release requires EnableNodeCliInspectArguments=off and RunAsNode=on');
  }
  const states = Object.fromEntries(Object.entries(wire).filter(([key]) => key !== 'version')
    .map(([key, value]) => [FuseV1Options[key] ?? key, value === FuseState.ENABLE ? 'on' : value === FuseState.DISABLE ? 'off' : `unsupported(${value})`]));
  console.log(`Release fuses: ${JSON.stringify(states)}`);
  return wire;
}

async function flipReleaseInspectorFuse(app) {
  const { flipFuses, getCurrentFuseWire, FuseVersion, FuseV1Options } = await import('@electron/fuses');
  const before = await getCurrentFuseWire(app);
  // Do not reset the ad-hoc signature here: release_client.py signs next,
  // and electron-builder signs after this hook when signing is configured.
  await flipFuses(app, { version: FuseVersion.V1, [FuseV1Options.EnableNodeCliInspectArguments]: false });
  const after = await verifyReleaseFuses(app);
  for (const key of Object.keys(before)) {
    if (key !== String(FuseV1Options.EnableNodeCliInspectArguments) && before[key] !== after[key]) {
      throw new Error(`Release unexpectedly changed fuse ${key}`);
    }
  }
}

module.exports = { flipReleaseInspectorFuse, verifyReleaseFuses };
if (require.main === module) {
  if (process.argv.length !== 3) throw new Error('Usage: node release-fuses.cjs APP_OR_EXE');
  verifyReleaseFuses(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
