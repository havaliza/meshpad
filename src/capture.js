import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startDev } from './tooling.js';

const pngPath = (path) => {
  if (typeof path !== 'string' || extname(path).toLowerCase() !== '.png') throw new Error('Screenshot output must end in .png.');
  return path;
};

/** Validate the whole script before launching a game or writing screenshots. */
export function validateSteps(steps) {
  if (!Array.isArray(steps)) throw new TypeError('Script must be a JSON array of steps.');
  for (const [index, step] of steps.entries()) {
    try {
      if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error('Expected a step object.');
      switch (step.type) {
        case 'pointerdown': case 'pointermove': case 'pointerup':
          if (step.type === 'pointerup' && step.world === undefined) break;
          if (!Array.isArray(step.world) || step.world.length !== 3 || !step.world.every(Number.isFinite)) {
            throw new Error('world must be [x, y, z] with finite coordinates.');
          }
          break;
        case 'advance':
          if (!Number.isFinite(step.seconds) || step.seconds < 0 || step.seconds > 60) throw new Error('seconds must be between 0 and 60.');
          break;
        case 'screenshot': pngPath(step.output); break;
        case 'state':
          if (step.label !== undefined && typeof step.label !== 'string') throw new Error('label must be a string.');
          break;
        default: throw new Error(`Unknown step type: ${step.type}.`);
      }
    } catch (error) { throw new Error(`Script step ${index + 1}: ${error.message}`, { cause: error }); }
  }
  return steps;
}

/** Render and scripted play share the same browser, clock, input, and capture path. */
export async function captureGame(entry, options = {}) {
  const width = options.width ?? 390;
  const height = options.height ?? 844;
  const dpr = options.dpr ?? 1;
  const time = options.time ?? 0;
  const level = options.level ?? 1;
  const timeout = options.timeout ?? 30000;
  for (const [name, size] of Object.entries({ width, height })) {
    if (!Number.isInteger(size) || size < 1 || size > 4096) throw new RangeError(`${name} must be an integer from 1 to 4096.`);
  }
  if (!Number.isFinite(dpr) || dpr < 0.25 || dpr > 4) throw new RangeError('dpr must be between 0.25 and 4.');
  if (!Number.isFinite(time) || time < 0 || time > 60) throw new RangeError('time must be between 0 and 60 seconds.');
  if (!Number.isInteger(level) || level < 1) throw new RangeError('level must be a positive integer (starting at 1).');
  if (!Number.isInteger(timeout) || timeout < 1) throw new RangeError('timeout must be a positive integer in milliseconds.');
  const output = resolve(pngPath(options.output ?? 'renders/game.png'));
  const scriptPath = options.script ? resolve(options.script) : null;
  const steps = scriptPath ? validateSteps(JSON.parse(await readFile(scriptPath, 'utf8'))) : [];
  const server = await startDev(entry, { root: options.root, port: 0, logLevel: 'error' });
  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    } catch (error) {
      throw new Error('Could not launch Chromium. Run "meshpad browsers" once (Linux CI: "meshpad browsers --with-deps").', { cause: error });
    }
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    page.setDefaultTimeout(timeout);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const address = server.httpServer.address();
    await page.goto(`http://127.0.0.1:${address.port}/?__meshpad_capture&__meshpad_dpr=${dpr}`, { waitUntil: 'load', timeout });
    await page.waitForFunction(() => Boolean(window.__MESHPAD__), null, { timeout });
    // Bound asynchronous user setup as well as browser navigation.
    await page.evaluate(async ({ level, time, timeout }) => {
      const run = async () => {
        const game = window.__MESHPAD__;
        await game.ready;
        if (game.state.index !== level - 1) await game.loadLevel(level - 1);
        await document.fonts.ready;
        if (time > 0) game.step(time);
      };
      let timer;
      try {
        await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Game setup timed out.')), timeout); })]);
      } finally { clearTimeout(timer); }
    }, { level, time, timeout });

    const inspect = async () => {
      if (errors.length) throw new Error(`Game failed: ${errors.join('\n')}`);
      return page.evaluate(() => {
        const game = window.__MESHPAD__;
        if (game.state.status === 'error') throw game.state.error;
        let debug;
        try { debug = JSON.parse(JSON.stringify(game.debug())); }
        catch (error) { throw new Error(`debug() must return JSON-serializable state: ${error.message}`); }
        return {
          state: { ...game.state, error: null }, debug,
          three: { calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles },
        };
      });
    };
    const metadata = { width, height, dpr, level, time };
    if (options.sceneOnly) await page.locator('.meshpad-hud').evaluate((element) => { element.style.display = 'none'; });
    const save = async (path, extra = {}) => {
      await page.evaluate(() => window.__MESHPAD__.step(0));
      const result = { ...metadata, ...await inspect(), ...extra };
      await mkdir(dirname(path), { recursive: true });
      await page.locator(options.sceneOnly ? '.meshpad-canvas' : '.meshpad-stage').screenshot({ path, timeout, animations: 'disabled' });
      await writeFile(path.slice(0, -4) + '.json', JSON.stringify(result, null, 2) + '\n');
      return { output: path, ...result };
    };
    await inspect();
    const snapshots = [];
    for (const [index, step] of steps.entries()) {
      try {
        if (step.type.startsWith('pointer')) {
          if (step.world) {
            const point = await page.evaluate((world) => {
              const game = window.__MESHPAD__;
              game.camera.updateWorldMatrix(true, false);
              const point = game.camera.position.clone().set(...world).project(game.camera);
              if (![point.x, point.y, point.z].every(Number.isFinite) || Math.abs(point.z) > 1) throw new Error('World position is outside the camera depth range.');
              const rect = game.renderer.domElement.getBoundingClientRect();
              return { x: rect.left + (point.x + 1) * rect.width / 2, y: rect.top + (1 - point.y) * rect.height / 2 };
            }, step.world);
            await page.mouse.move(point.x, point.y);
          }
          if (step.type === 'pointerdown') await page.mouse.down();
          if (step.type === 'pointerup') await page.mouse.up();
        } else if (step.type === 'advance') {
          await page.evaluate((seconds) => window.__MESHPAD__.step(seconds), step.seconds);
        } else if (step.type === 'screenshot') {
          const capture = await save(resolve(dirname(scriptPath), step.output));
          snapshots.push({ step: index + 1, type: step.type, ...capture });
        } else if (step.type === 'state') {
          snapshots.push({ step: index + 1, type: step.type, ...(step.label === undefined ? {} : { label: step.label }), ...await inspect() });
        }
        await inspect();
      } catch (error) { throw new Error(`Script step ${index + 1} (${step.type}): ${error.message}`, { cause: error }); }
    }
    return await save(output, scriptPath ? { snapshots } : {});
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
}
