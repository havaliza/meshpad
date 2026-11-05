import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { initProject, startDev } from '../../src/tooling.js';
import { captureGame } from '../../src/capture.js';
import { packageRoot } from '../../src/tooling.js';

let server;
let browser;
let url;
before(async () => {
  server = await startDev('test/fixtures/harness.ts', { port: 0 });
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => { try { await browser?.close(); } finally { await server?.close(); } });

async function pageFor(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, ...options });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  await page.goto(`${url}/?__meshpad_capture`);
  await page.waitForFunction(() => Boolean(window.fixture));
  return page;
}

test('mobile sizing, HUD navigation, results, retry, and final-level boundaries', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    const { createGame, THREE } = window.fixture;
    window.disposals = 0;
    window.signals = [];
    window.callbacks = [];
    window.game = createGame({ levels: [0, 1].map((index) => ({
      name: `Stage ${index + 1}`,
      setup(context) {
        window.signals.push(context.signal); window.callbacks.push(context);
        const geometry = new THREE.BoxGeometry();
        geometry.addEventListener('dispose', () => window.disposals++);
        context.scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
        context.hud({ score: 4, progress: 0.5, hint: 'Tap something' });
        return { update(dt, elapsed) { if (elapsed > 1) context.fail('Too slow'); } };
      },
    })) });
    await window.game.ready;
  });
  assert.equal(await page.locator('h1').textContent(), 'Stage 1');
  assert.equal(await page.locator('progress').getAttribute('value'), '0.5');
  assert.equal(await page.getByRole('button', { name: 'Previous level', exact: true }).isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => ({ ratio: window.game.renderer.getPixelRatio(), width: window.game.renderer.domElement.width })), { ratio: 2, width: 780 });
  assert.equal(await page.evaluate(() => window.game.win('Done')), true);
  assert.equal(await page.evaluate(() => window.game.fail()), false);
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.getByRole('button', { name: 'Next level →' }).click();
  await page.waitForFunction(() => window.game.state.index === 1 && window.game.state.status === 'playing');
  assert.equal(await page.evaluate(() => window.disposals), 1);
  assert.equal(await page.evaluate(() => window.signals[0].aborted), true);
  assert.equal(await page.evaluate(() => window.callbacks[0].win()), false);
  await page.evaluate(() => window.callbacks[0].hud({ title: 'stale' }));
  assert.equal(await page.locator('h1').textContent(), 'Stage 2');
  assert.equal(await page.getByRole('button', { name: 'Next level', exact: true }).isDisabled(), true);
  await page.evaluate(() => window.game.step(2));
  assert.equal(await page.evaluate(() => window.game.state.status), 'failed');
  assert.equal(await page.locator('.meshpad-result-message').textContent(), 'Too slow');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => window.game.state.status === 'playing');
  await page.evaluate(() => window.game.win());
  assert.equal(await page.getByRole('button', { name: 'Play again' }).isVisible(), true);
  await page.getByRole('button', { name: 'Play again' }).click();
  await page.waitForFunction(() => window.game.state.status === 'playing');
  await page.getByRole('combobox', { name: 'Choose level' }).selectOption('0');
  await page.waitForFunction(() => window.game.state.index === 0);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.game.renderer.domElement.height === 780);
  const bounds = await page.locator('.meshpad-stage').boundingBox();
  assert.equal(bounds.height, 390);
  assert.ok(bounds.width <= 220);
  await page.evaluate(() => { window.game.dispose(); window.game.dispose(); });
  assert.equal(await page.locator('.meshpad-stage').count(), 0);
  assert.equal(await page.evaluate(() => window.game.state.status), 'disposed');
});

test('async setup races cannot update or retain the replacement level', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async () => {
    const { createGame, THREE } = window.fixture;
    let released = 0;
    let cleanupCalls = 0;
    let unblock;
    let stale;
    const game = createGame({ levels: [
      { name: 'Slow', async setup(context) {
        stale = context;
        await new Promise((resolve) => { unblock = resolve; });
        const geometry = new THREE.BoxGeometry();
        geometry.addEventListener('dispose', () => released++);
        context.scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
        context.hud({ title: 'Wrong level' });
        return { dispose() { cleanupCalls++; } };
      } },
      { name: 'Fast', setup({ hud }) { hud({ message: 'Ready' }); } },
    ] });
    await game.loadLevel(1);
    unblock();
    const oldResult = await game.ready;
    const result = { oldResult, aborted: stale.signal.aborted, staleWin: stale.win(), released, cleanupCalls, index: game.state.index, title: document.querySelector('h1').textContent };
    game.dispose();
    return result;
  });
  assert.deepEqual(result, { oldResult: false, aborted: true, staleWin: false, released: 1, cleanupCalls: 1, index: 1, title: 'Fast' });
});

test('hello-world starter is playable with touch and pauses simulation explicitly', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async (entry) => {
    await import(entry);
    window.game = window.__MESHPAD__;
    await window.game.ready;
  }, `/@fs/${packageRoot}templates/game.ts`);
  const point = await page.evaluate(() => {
    const game = window.game;
    game.scene.updateMatrixWorld(true); game.camera.updateMatrixWorld(true);
    const cube = game.scene.children.find((object) => object.geometry?.type === 'BoxGeometry');
    const point = cube.position.clone().project(game.camera);
    const rect = game.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (point.x + 1) / 2 * rect.width, y: rect.top + (1 - point.y) / 2 * rect.height };
  });
  await page.evaluate(() => { window.game.pause(); window.game.step(2); });
  assert.equal(await page.evaluate(() => window.game.state.elapsed), 0);
  await page.evaluate(() => window.game.resume());
  for (let i = 0; i < 3; i++) await page.touchscreen.tap(point.x, point.y);
  assert.equal(await page.evaluate(() => window.game.state.status), 'won');
  assert.equal(await page.locator('.meshpad-score').textContent(), '3 / 3');
  await page.getByRole('button', { name: 'Next level →' }).click();
  await page.waitForFunction(() => window.game.state.index === 1 && window.game.state.status === 'playing');
  await page.evaluate(() => window.game.step(21));
  assert.equal(await page.evaluate(() => window.game.state.status), 'failed');
});

test('setup and frame errors show a retry screen and release resources once', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async () => {
    let broken = true;
    let cleanupCalls = 0;
    const reports = [];
    const game = window.fixture.createGame({ onError(error) { reports.push(error.message); }, levels: [{ setup() {
      if (broken) throw new Error('setup broke');
      return { update() { throw new Error('frame broke'); }, dispose() { cleanupCalls++; } };
    } }] });
    let rejection;
    try { await game.ready; } catch (error) { rejection = error.message; }
    const initialStatus = game.state.status;
    broken = false;
    await game.restart();
    game.step(0.1);
    const frameStatus = game.state.status;
    await game.restart(); game.dispose();
    return { rejection, initialStatus, frameStatus, reports, cleanupCalls };
  });
  assert.deepEqual(result, { rejection: 'setup broke', initialStatus: 'error', frameStatus: 'error', reports: ['setup broke', 'frame broke'], cleanupCalls: 2 });
});

test('headless captures include real geometry, requested time, and level metadata', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'meshpad-render-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = resolve(root, 'level.png');
  const result = await captureGame('examples/hello-world/game.ts', { output, time: 1.5, level: 2 });
  assert.equal(result.state.index, 1);
  assert.equal(result.state.status, 'playing');
  assert.ok(Math.abs(result.state.elapsed - 1.5) < 1e-8);
  assert.ok(result.three.triangles > 100);
  const png = await readFile(output);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 390);
  assert.equal(png.readUInt32BE(20), 844);
  const metadata = JSON.parse(await readFile(resolve(root, 'level.json')));
  assert.equal(metadata.level, 2);
  assert.equal(metadata.three.calls, result.three.calls);
});

test('dev reports type errors after edits and recovers when they are fixed', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'meshpad-watch-test-'));
  let liveServer;
  let context;
  t.after(async () => {
    await context?.close();
    await liveServer?.close();
    await rm(root, { recursive: true, force: true });
  });
  await initProject(root);
  await mkdir(resolve(root, 'node_modules'));
  await symlink(packageRoot, resolve(root, 'node_modules/meshpad'), 'dir');
  const valid = "import { createGame } from 'meshpad';\ncreateGame({ levels: [{ name: 'Live types', setup() {} }] });\n";
  await writeFile(resolve(root, 'game.ts'), valid);
  liveServer = await startDev(undefined, { root, port: 0 });
  context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${liveServer.httpServer.address().port}/?__meshpad_capture`);
  await page.waitForFunction(() => window.__MESHPAD__?.state.status === 'playing');
  await writeFile(resolve(root, 'game.ts'), valid + "const wrong: number = 'bad';\n");
  await page.locator('vite-error-overlay').waitFor({ state: 'attached' });
  assert.match(await page.locator('vite-error-overlay .message').textContent(), /TypeScript check failed/);
  await writeFile(resolve(root, 'game.ts'), valid);
  await page.waitForFunction(() => !document.querySelector('vite-error-overlay') && window.__MESHPAD__?.state.status === 'playing');
});
