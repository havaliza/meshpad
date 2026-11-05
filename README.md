# Meshpad

Build mobile-first 3D game prototypes in one TypeScript file. Meshpad includes TypeScript, Three.js, Vite, a portrait game shell, a HUD, level navigation, win/fail screens, and headless PNG rendering.

Requires Node.js 22.12 or newer and a WebGL 2 browser.

```sh
npx meshpad init my-game
cd my-game
npm install
npm run dev
```

The HUD shows only `← Level 1 →` at the top, with previous/next navigation. The shell uses Baloo 2, rounded arrow icons, outlined text and icons with crisp shadows, and a toy-brick palette of indigo, purple, cream, and yellow. Win/fail popups show a short title and one button: next level, replay, or retry. Baloo 2 loads from Google Fonts, with rounded system fonts as a fallback.

The generated project has one dependency, `meshpad`, and one implementation file, `game.ts`. No HTML, CSS, Vite config, or separate TypeScript or Three.js install is required. `package.json`, `tsconfig.json`, `.gitignore`, and `vercel.json` are provided. The starter is a three-level tap-the-cube game with a countdown.

For an empty directory:

```sh
npx meshpad init
npm install
```

If a `package.json` already exists, install `meshpad`, add `game.ts`, and run `npx meshpad dev`. Initialization refuses to overwrite existing files.

```ts
import { createGame, THREE } from 'meshpad';

createGame({
  title: 'My game',
  levels: [{
    name: 'Hello, world',
    setup({ scene, win, fail }) {
      const cube = new THREE.Mesh(
        new THREE.BoxGeometry(),
        new THREE.MeshStandardMaterial({ color: '#f9c203' }),
      );
      scene.add(cube);
      return {
        update(dt, elapsed) {
          cube.rotation.y += dt;
          if (elapsed >= 10) fail();
        },
        pointer({ type, hits }) {
          if (type === 'pointerdown' && hits([cube]).length) win();
        },
      };
    },
  }],
});
```

`THREE` is the included Three.js namespace. Named imports are also available from `meshpad/three`.

### TypeScript projects

Game entries must be `.ts` files; JavaScript and declaration-only entries are rejected. `game.ts` is the default for dev, build, rendering, and type checking. Custom entries such as `src/main.ts` also work. Builds and renders check types before starting, and development checks types at startup and after edits, displaying errors in the terminal and browser.

```sh
npx meshpad typecheck
# or in generated projects:
npm run typecheck
```

The generated `tsconfig.json` extends `meshpad/tsconfig`, which provides strict checking, DOM types, bundler module resolution, and no JavaScript emission. Editors use the same preset. With no project config, the CLI uses these defaults. Checks cover the project's TypeScript files and the entry's imports; type errors stop production builds. Meshpad bundles the compiler, so projects keep a single dependency. For separate setup helpers, import `type LevelContext` and `type LevelHooks` from `meshpad`.

### Game API

`createGame({ levels, title?, root?, initialLevel?, background?, maxPixelRatio?, maxWidth?, renderer?, onError? })` returns a game. Level indexes in JavaScript start at **0**. The CLI's `--level` starts at **1**.

Each level is `{ name?, setup(context) }`. Setup may be asynchronous. Context provides:

| Value | Purpose |
| --- | --- |
| `scene`, `camera`, `renderer` | Fresh scene, perspective camera, and shared renderer. Default lighting is included. |
| `level`, `index` | Current level and index. |
| `width`, `height` | Current stage dimensions in CSS pixels. |
| `win()`, `fail()` | Finish the level and display a minimal popup with one action. Repeated results are ignored. |
| `signal` | Aborted on level exit. Use for fetches and event listeners. |

Setup can return `{ update(dt, elapsed), pointer(event), resize(width, height), dispose() }`; every hook is optional. Time values are seconds. Pointer events provide `type`, `originalEvent`, normalized `point`, `raycaster`, and `hits(objects?)` for recursive picking. The canvas captures pointers for dragging and forwards cancellation.

The game exposes `ready`, `loadLevel(index)`, `restart()`, `next()`, `previous()`, `win()`, `fail()`, `pause()`, `resume()`, `step(seconds)`, and `dispose()`, plus `scene`, `camera`, `renderer`, and read-only `state`. Await `game.ready` before interacting programmatically. Loading returns a promise and resolves `false` if a newer load supersedes it. Navigation stops at the first/last level. `state.status` is `loading`, `playing`, `paused`, `won`, `failed`, `error`, or `disposed`.

Each level owns its scene: Meshpad disposes geometry, materials, textures, skeletons, and shadows on exit. Avoid sharing these resources across levels. Use `dispose()` for controls, timers, audio, or render targets. Use `signal` for listeners (`element.addEventListener('click', handler, { signal })`) and async work; check `signal.aborted` after awaiting work that cannot be cancelled. Old level callbacks cannot alter the active level. Setup failures reject the load promise and show a retry screen; runtime hook failures show the same screen and call `onError`.

### Mobile defaults

The stage fills the available height and stays portrait, centered on wider screens. The default maximum width is 540px and pixel ratio is capped at 2. Included styles handle dynamic viewport height, safe-area insets, fixed positioning, overscroll, text selection, tap highlights, and touch gestures. Viewport resizing follows `visualViewport`, orientation, and page restoration. Rendering sleeps in hidden tabs, clamps frame deltas after interruptions, and resumes after WebGL context restoration. `pause()` remains in effect across tab changes.

The generated HTML includes mobile viewport and standalone-web-app metadata. The supplied camera updates its aspect automatically; use `resize` for custom projection settings. Styles apply a full-page game layout; pass `root` to mount in a specific element with its own dimensions.

### Commands

```sh
meshpad dev [game.ts] --host 0.0.0.0 --port 5173
meshpad build [game.ts] --out-dir dist
meshpad typecheck [game.ts]
meshpad preview --port 4173
meshpad --help
```

Put static assets in `public/` and load them using paths such as `/models/piece.glb`. Imported assets and `new URL('./asset.png', import.meta.url)` work through Vite. Builds target Safari 15+ and Chrome 96+ with WebGL 2. Development on a phone uses your computer's LAN address and `--host 0.0.0.0`.

### Headless rendering

Install the bundled Playwright Chromium browser once:

```sh
npx meshpad browsers
# Linux CI machines can also install system dependencies:
npx meshpad browsers --with-deps

npx meshpad render game.ts --output renders/level.png \
  --width 390 --height 844 --level 1 --time 1.5
```

The renderer starts a local Vite server, loads the actual game in headless Chromium with software WebGL, waits for setup, advances simulation in fixed substeps, and saves a PNG plus adjacent JSON containing state and draw statistics. Animation starts at time zero; `--time` advances game hooks up to 60 seconds. Keep randomness seeded and animations in `update` for reproducible captures. Browser timers, external services, and asynchronously loaded assets outside setup are not deterministic; await required assets in setup. `--timeout` bounds setup (default 30000ms).

`--scene-only` omits the HUD. The output captures the portrait stage within the requested viewport; on a wide viewport the PNG is narrower than the viewport. Rendering needs Chromium locally or in CI; deployed games are static and need no server or browser installation.

### Deploy

```sh
npm run build
```

Deploy the generated project to Vercel using the included `vercel.json`, which sets `npm run build` and `dist`. The output is a static site and can also be hosted anywhere that serves `dist/`. The toolkit repository itself builds its hello-world example with the same commands.

### Development

```sh
npm install
npm run typecheck
npm test
npm run test:browser  # requires meshpad browsers first
npm run dev
npm run render -- --time 1
```
