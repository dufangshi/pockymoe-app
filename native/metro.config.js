const { getDefaultConfig } = require('expo/metro-config');
const { resolveTarget } = require('./resolver.cjs');

const config = getDefaultConfig(__dirname);
const upstream = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = resolveTarget(moduleName, context.originModulePath);
  if (target) return { type: 'sourceFile', filePath: target };
  return upstream ? upstream(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
};
module.exports = config;
