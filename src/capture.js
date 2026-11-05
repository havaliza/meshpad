import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { chromium } from 'playwright';
import { startDev } from './tooling.js';

export async function captureGame(entry, options = {}) {
  const width = options.width ?? 390;
  const height = options.height ?? 844;
  const time = options.time ?? 0;
  const level = options.level ?? 1;
  const timeout = options.timeout ?? 30000;
  for (const [name, size] of Object.entries({ width, height })) {
    if (!Number.isInteger(size) || size < 1 || size > 4096) throw new RangeError(`${name} must be an integer from 1 to 4096.`);
  }
  if (!Number.isFinite(time) || time < 0 || time > 60) throw new RangeError('time must be between 0 and 60 seconds.');
  if (!Number.isInteger(level) || level < 1) throw new RangeError('level must be a positive integer (starting at 1).');
  if (!Number.isInteger(timeout) || timeout < 1) throw new RangeError('timeout must be a positive integer in milliseconds.');
  const output = resolve(options.output ?? 'renders/game.png');
  if (extname(output).toLowerCase() !== '.png') throw new Error('Render output must end in .png.');
  const server = await startDev(entry, { root: options.root, port: 0 });
  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    } catch (error) {
      throw new Error('Could not launch Chromium. Run "meshpad browsers" once (Linux CI: "meshpad browsers --with-deps").', { cause: error });
    }
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(timeout);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const address = server.httpServer.address();
    await page.goto(`http://127.0.0.1:${address.port}/?__meshpad_capture`, { waitUntil: 'load', timeout });
    await page.waitForFunction(() => Boolean(window.__MESHPAD__), null, { timeout });
    // Bound asynchronous user setup as well as browser navigation.
    const result = await page.evaluate(async ({ level, time, timeout }) => {
      const run = async () => {
        const game = window.__MESHPAD__;
        await game.ready;
        if (game.state.index !== level - 1) await game.loadLevel(level - 1);
        await document.fonts.ready;
        game.step(time);
        if (game.state.status === 'error') throw game.state.error;
        return {
          state: { ...game.state, error: null },
          three: { calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles },
        };
      };
      let timer;
      try {
        return await Promise.race([run(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Game setup timed out.')), timeout); })]);
      } finally { clearTimeout(timer); }
    }, { level, time, timeout });
    if (errors.length) throw new Error(`Game failed: ${errors.join('\n')}`);
    await mkdir(dirname(output), { recursive: true });
    if (options.sceneOnly) await page.locator('.meshpad-hud').evaluate((element) => { element.style.display = 'none'; });
    await page.locator(options.sceneOnly ? '.meshpad-canvas' : '.meshpad-stage').screenshot({ path: output, timeout });
    const metadata = { width, height, level, time, ...result };
    await writeFile(output.slice(0, -4) + '.json', JSON.stringify(metadata, null, 2) + '\n');
    return { output, ...metadata };
  } finally {
    try { await browser?.close(); } finally { await server.close(); }
  }
}
