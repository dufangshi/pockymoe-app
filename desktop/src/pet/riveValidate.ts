import { RiveDrawer, type RivePack } from './rive';
Object.assign(window, { verifyRive: async (bytes: number[] | string, config: RivePack) => {
  const drawer = await RiveDrawer.load(document.querySelector('canvas')!, typeof bytes === 'string' ? Uint8Array.from(atob(bytes), c => c.charCodeAt(0)) : new Uint8Array(bytes), config);
  try { for (let i = 0; i < 7; i++) { drawer.set('state', i); drawer.draw(1 / 60); } } finally { drawer.dispose(); }
} });
