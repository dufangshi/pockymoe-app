# Desktop pet

`createPetController` is owned by main and consumes only the frozen bridge types:

```ts
import { createPetController } from '../pet/controller';
const pet = createPetController({ hub, settings,
  dispatch: command => windows.dispatch(command),
  shouldSpeak: event => notifications.shouldSpeak(event),
  petDirectories: [bundledPetsDirectory, userPetsDirectory],
});
// On shutdown: pet.dispose(). Settings changes are observed automatically.
```

The build has two extra entries: `src/pet/preload.ts` → `out/preload/pet.js`
and `src/pet/index.html` → `out/renderer/pet/index.html`. In development the
renderer uses `ELECTRON_RENDERER_URL/pet/index.html`. No relay credentials enter
this window. Its `rcDesktop.pet` methods accept only named, sender-checked actions.
The panel becomes focusable only while the user explicitly opens quick chat.

The native Settings screen can call the additional `importPetPack({ settings,
petDirectories, parent })` export. Import validates dimensions/limits and decodes
pixels before atomic installation under `app.getPath('userData')/pets`. ZIP paths
are never extracted directly; only validated manifest/atlas bytes are installed.
Codex v1 timings follow the Apache-2.0 hatch-pet contract linked in `animation.ts`.
Undocumented atlas v2 is rejected explicitly. The optional bundled Moe sleeping
strip is an independently validated extension; other manifest fields are ignored.

Run the focused checks from `desktop/`:

```sh
pnpm exec vitest run --config src/pet/vitest.config.ts
pnpm typecheck
pnpm exec eslint src/pet
pnpm exec electron-vite build --config src/pet/tools/electron.config.ts
node src/pet/tools/capture.mjs
```

The last two commands use a mock ActivityHub, an isolated temporary userData, and
an independent Electron process. Screenshots/results go to
`/tmp/rc-desktop/evidence/pet/`; no Supervisor or real account is accessed.
`node src/pet/tools/generate-placeholder.mjs` recreates the original procedural
atlas for tests. Production packaging must exclude `assets/pets/placeholder/**`.
