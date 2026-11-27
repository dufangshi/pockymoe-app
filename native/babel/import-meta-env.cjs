// Vite code reads `import.meta.env.X`. Hermes has no import.meta; the vendored Web code
// only reads `env`, so it becomes the app's build-time environment object.
module.exports = function importMetaEnv({ types: t }) {
  return {
    name: 'pockymoe-import-meta-env',
    visitor: {
      MemberExpression(path) {
        const { object, property } = path.node;
        if (t.isMetaProperty(object) && object.meta.name === 'import' && object.property.name === 'meta' &&
            t.isIdentifier(property, { name: 'env' })) {
          path.replaceWith(t.memberExpression(t.identifier('globalThis'), t.identifier('__POCKYMOE_ENV__')));
        }
      },
    },
  };
};
