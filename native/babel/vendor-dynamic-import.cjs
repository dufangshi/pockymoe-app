// The vendored Web modules use import() to break load cycles. In the app they live in
// the main bundle: `import('x')` becomes `Promise.resolve().then(() => require('x'))`, so
// a development reload never waits on a lazily served chunk and release behaves the same.
module.exports = function vendorDynamicImport({ types: t }) {
  return {
    name: 'pockymoe-vendor-dynamic-import',
    visitor: {
      CallExpression(path, state) {
        const file = state.filename || '';
        if (!/[\\/]vendor(-overlay)?[\\/]pockymoe[\\/]|[\\/]vendor[\\/]pockymoe[\\/]/.test(file) && !/[\\/]vendor[\\/]/.test(file)) return;
        if (path.node.callee.type !== 'Import') return;
        const [source] = path.node.arguments;
        if (!t.isStringLiteral(source)) return;
        path.replaceWith(t.callExpression(
          t.memberExpression(t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('resolve')), []), t.identifier('then')),
          [t.arrowFunctionExpression([], t.callExpression(t.identifier('require'), [t.stringLiteral(source.value)]))],
        ));
      },
    },
  };
};
