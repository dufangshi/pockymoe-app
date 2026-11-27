module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [require.resolve('./babel/import-meta-env.cjs'), require.resolve('./babel/vendor-dynamic-import.cjs')],
  };
};
