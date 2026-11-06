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
        return { update(dt, elapsed) { if (elapsed > 1) context.fail(); } };
      },
    })) });
    await window.game.ready;
  });
  assert.equal(await page.locator('h1').textContent(), 'Level 1');
  assert.equal(await page.locator('.meshpad-bottom, select, progress, .meshpad-score, .meshpad-message, .meshpad-hint').count(), 0);
  assert.equal(await page.locator('.meshpad-top button').count(), 2);
  assert.equal(await page.locator('[data-action="levels"]').isVisible(), true);
  assert.equal(await page.getByRole('button', { name: 'Restart level', exact: true }).isVisible(), true);
  assert.deepEqual(await page.evaluate(() => ({ ratio: window.game.renderer.getPixelRatio(), width: window.game.renderer.domElement.width })), { ratio: 2, width: 780 });
  assert.equal(await page.evaluate(() => window.game.win()), true);
  assert.equal(await page.evaluate(() => window.game.fail()), false);
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  assert.equal(await page.getByRole('dialog').getByRole('button').count(), 1);
  assert.equal(await page.locator('.meshpad-primary').evaluate((element) => document.activeElement === element), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.meshpad-primary').evaluate((element) => document.activeElement === element), true);
  await page.getByRole('dialog').getByRole('button', { name: 'Next level', exact: true }).click();
  await page.waitForFunction(() => window.game.state.index === 1 && window.game.state.status === 'playing');
  assert.equal(await page.evaluate(() => window.disposals), 1);
  assert.equal(await page.evaluate(() => window.signals[0].aborted), true);
  assert.equal(await page.evaluate(() => window.callbacks[0].win()), false);
  assert.equal(await page.locator('h1').textContent(), 'Level 2');
  assert.equal(await page.getByRole('dialog').isVisible(), false);
  assert.equal(await page.locator('.meshpad-top').evaluate((element) => element.contains(document.activeElement)), true);
  assert.equal(await page.getByRole('button', { name: 'Next level', exact: true }).count(), 0);
  await page.evaluate(() => window.game.step(2));
  assert.equal(await page.evaluate(() => window.game.state.status), 'failed');
  assert.equal(await page.getByRole('dialog').getByRole('heading').textContent(), 'Try again!');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => window.game.state.status === 'playing');
  await page.evaluate(() => window.game.win());
  assert.equal(await page.getByRole('button', { name: 'Play again' }).isVisible(), true);
  await page.getByRole('button', { name: 'Play again' }).click();
  await page.waitForFunction(() => window.game.state.status === 'playing');
  await page.locator('[data-action="levels"]').click();
  await page.getByRole('button', { name: 'Level 1: Stage 1', exact: true }).click();
  await page.waitForFunction(() => window.game.state.index === 0);
  await page.locator('[data-action="levels"]').click();
  await page.getByRole('button', { name: 'Level 2: Stage 2', exact: true }).click();
  await page.waitForFunction(() => window.game.state.index === 1);
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
        return { dispose() { cleanupCalls++; } };
      } },
      { name: 'Fast', setup() {} },
    ] });
    // Allow the deferred initial setup to start before superseding it.
    await Promise.resolve();
    await game.loadLevel(1);
    unblock();
    const oldResult = await game.ready;
    const result = { oldResult, aborted: stale.signal.aborted, staleWin: stale.win(), released, cleanupCalls, index: game.state.index, title: document.querySelector('h1').textContent };
    game.dispose();
    return result;
  });
  assert.deepEqual(result, { oldResult: false, aborted: true, staleWin: false, released: 1, cleanupCalls: 1, index: 1, title: 'Level 2' });
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
  assert.equal(await page.getByRole('dialog').getByRole('heading').textContent(), 'Level complete!');
  await page.getByRole('dialog').getByRole('button', { name: 'Next level', exact: true }).click();
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

test('initial setup is deferred and early loads or disposal supersede it', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async () => {
    const calls = [];
    const game = window.fixture.createGame({ levels: [
      { setup() { calls.push(new Later().value); } },
      { setup() { calls.push('replacement'); } },
    ] });
    const before = game.state.status;
    class Later { value = 'ready'; }
    await game.ready;
    game.dispose();
    const replacement = window.fixture.createGame({ levels: [
      { setup() { calls.push('should not load'); } },
      { setup() { calls.push('replacement'); } },
    ] });
    await replacement.loadLevel(1);
    const superseded = await replacement.ready;
    replacement.dispose();
    const disposed = window.fixture.createGame({ levels: [{ setup() { calls.push('disposed'); } }] });
    disposed.dispose();
    return { before, calls, superseded, disposedReady: await disposed.ready };
  });
  assert.deepEqual(result, { before: 'loading', calls: ['ready', 'replacement'], superseded: false, disposedReady: false });
});

test('custom and manually managed projections survive resizing; prepasses run before every draw', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    const { createGame, THREE } = window.fixture;
    window.draws = [];
    window.prepared = false;
    window.game = createGame({ levels: [
      { setup({ renderer }) {
        const camera = new THREE.OrthographicCamera(-2, 2, 4, -4, 0.1, 100);
        camera.position.z = 10;
        camera.projectionMatrix.elements[8] = 0.25; // Oblique projection.
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        const render = renderer.render.bind(renderer);
        renderer.render = (...args) => {
          window.draws.push(window.prepared);
          window.prepared = false;
          render(...args);
        };
        return { camera, beforeRender() { window.prepared = true; }, debug: () => ({ custom: true }) };
      } },
      { setup({ camera }) {
        camera.projectionMatrix.elements[8] = 0.4;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        return { autoResizeCamera: false, beforeRender() { window.prepared = true; } };
      } },
      { setup() { return { beforeRender() { throw new Error('prepass broke'); } }; } },
    ] });
    await window.game.ready;
    window.projection = window.game.camera.projectionMatrix.toArray();
    window.game.step(0);
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForFunction(() => window.game.renderer.domElement.height === 780);
  assert.equal(await page.evaluate(() => JSON.stringify(window.projection) === JSON.stringify(window.game.camera.projectionMatrix.toArray())), true);
  assert.deepEqual(await page.evaluate(() => window.game.debug()), { custom: true });
  await page.evaluate(async () => {
    await window.game.loadLevel(1);
    window.projection = window.game.camera.projectionMatrix.toArray();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => window.game.renderer.domElement.height === 1688);
  assert.equal(await page.evaluate(() => JSON.stringify(window.projection) === JSON.stringify(window.game.camera.projectionMatrix.toArray())), true);
  assert.equal(await page.evaluate(() => window.draws.length >= 5 && window.draws.every(Boolean)), true);
  assert.equal(await page.evaluate(() => window.game.debug()), null);
  await page.evaluate(() => window.game.loadLevel(2));
  assert.equal(await page.evaluate(() => window.game.state.status), 'error');
  assert.equal(await page.getByRole('dialog').isVisible(), true);
  await page.evaluate(() => window.game.dispose());
});

test('play CLI drags at world positions, records debug snapshots, and captures at requested DPR', async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const root = await mkdtemp(resolve(tmpdir(), 'meshpad-play-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const script = resolve(root, 'steps.json');
  await writeFile(script, JSON.stringify([
    { type: 'pointerdown', world: [-1, 0, 0] },
    { type: 'state', label: 'grabbed' },
    { type: 'pointermove', world: [1, 0, 0] },
    { type: 'advance', seconds: 0.5 },
    { type: 'screenshot', output: 'dragging.png' },
    { type: 'pointerup' },
    { type: 'state', label: 'released' },
  ]));
  const output = resolve(root, 'final.png');
  const { stdout } = await promisify(execFile)(process.execPath, [resolve(packageRoot, 'bin/meshpad.js'), 'play', 'test/fixtures/scripted.ts', '--script', script, '--level', '2', '--dpr', '2', '--output', output, '--scene-only'], { cwd: packageRoot });
  const result = JSON.parse(stdout);
  assert.equal(result.state.index, 1);
  assert.equal(result.state.status, 'won');
  assert.ok(Math.abs(result.state.elapsed - 0.5) < 1e-8);
  assert.ok(Math.abs(result.debug.x - 1) < 0.02);
  assert.equal(result.debug.dragging, false);
  assert.ok(result.debug.events.includes('pointerdown'));
  assert.equal(result.debug.events.at(-1), 'pointerup');
  assert.equal(result.snapshots[0].label, 'grabbed');
  assert.equal(result.snapshots[0].debug.dragging, true);
  assert.equal(result.snapshots[1].debug.dragging, true);
  assert.equal(result.snapshots[2].label, 'released');
  for (const path of [output, resolve(root, 'dragging.png')]) {
    const png = await readFile(path);
    assert.equal(png.readUInt32BE(16), 780);
    assert.equal(png.readUInt32BE(20), 1688);
    assert.equal(JSON.parse(await readFile(path.slice(0, -4) + '.json')).dpr, 2);
  }
});

test('headless failures report invalid debug snapshots and the offending script step', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'meshpad-play-errors-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(resolve(root, 'game.ts'), `
    import { createGame } from 'meshpad';
    createGame({ levels: [{ setup() { return { debug: () => ({ value: 1n }) }; } }] });
  `);
  await assert.rejects(captureGame('game.ts', { root, output: resolve(root, 'bad-debug.png') }), /debug\(\) must return JSON-serializable state/);
  const script = resolve(root, 'steps.json');
  await writeFile(script, JSON.stringify([{ type: 'pointerdown', world: [0, 0, 20] }]));
  await assert.rejects(captureGame('test/fixtures/scripted.ts', { script, output: resolve(root, 'bad-pointer.png') }), /Script step 1 \(pointerdown\).*outside the camera depth range/);
});

test('hearts lose one per mistake; play on preserves the board and retry refills it', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    window.setups = 0;
    window.continues = 0;
    window.game = window.fixture.createGame({ failure: { type: 'hearts', hearts: 5 }, levels: [{ setup(context) {
      window.setups++;
      window.levelContext = context;
      return { onPlayOn() { window.continues++; }, pointer() { context.mistake(); } };
    } }, { failure: { type: 'hearts', hearts: 3 }, setup() {} }] });
    await window.game.ready;
    window.savedScene = window.game.scene;
  });
  assert.equal(await page.locator('.meshpad-heart').count(), 5);
  await page.locator('.meshpad-resource').tap();
  assert.equal(await page.evaluate(() => window.game.state.failure.remaining), 5);
  assert.equal(await page.evaluate(() => window.game.move()), false);
  await page.evaluate(() => {
    window.game.step(1);
    for (let i = 0; i < 4; i++) window.levelContext.mistake();
  });
  assert.equal(await page.evaluate(() => window.game.state.status), 'playing');
  assert.equal(await page.locator('.meshpad-heart-empty').count(), 4);
  await page.evaluate(() => window.game.mistake());
  assert.equal(await page.getByRole('dialog').getByRole('heading').textContent(), 'Out of hearts!');
  assert.equal(await page.evaluate(() => window.game.mistake()), false);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Retry', exact: true }).evaluate((button) => button === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.getByRole('button', { name: 'Play on', exact: true }).evaluate((button) => button === document.activeElement), true);
  await page.getByRole('button', { name: 'Play on', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => ({ remaining: window.game.state.failure.remaining, setups: window.setups,
    continues: window.continues, sameScene: window.game.scene === window.savedScene, aborted: window.levelContext.signal.aborted,
    elapsed: Math.round(window.game.state.elapsed), status: window.game.state.status })),
  { remaining: 5, setups: 1, continues: 1, sameScene: true, aborted: false, elapsed: 1, status: 'playing' });
  assert.equal(await page.evaluate(() => window.game.playOn()), false);
  await page.evaluate(() => { window.game.fail(); window.game.playOn(); window.game.mistake(); });
  await page.getByRole('button', { name: 'Restart level', exact: true }).click();
  await page.waitForFunction(() => window.setups === 2 && window.game.state.status === 'playing');
  assert.equal(await page.evaluate(() => window.game.state.failure.remaining), 5);
  await page.evaluate(async () => { await window.game.loadLevel(1); });
  assert.equal(await page.locator('.meshpad-heart').count(), 3);
  assert.equal(await page.evaluate(() => window.levelContext.mistake()), false);
  assert.equal(await page.evaluate(() => window.game.state.failure.remaining), 3);
});

test('timer formats MM:SS, pauses with gameplay and levels list, and grants configurable extra time', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    window.game = window.fixture.createGame({ failure: { type: 'time', seconds: 65, playOnSeconds: 7 }, levels: [{ setup() {} }] });
    await window.game.ready;
  });
  assert.equal(await page.locator('.meshpad-resource-value').textContent(), '01:05');
  await page.evaluate(() => { window.game.step(5); window.game.pause(); window.game.step(10); });
  assert.equal(await page.locator('.meshpad-resource-value').textContent(), '01:00');
  await page.locator('[data-action="levels"]').click();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.game.state.status), 'paused');
  await page.evaluate(() => window.game.resume());
  await page.locator('[data-action="levels"]').click();
  await page.evaluate(() => { window.game.step(10); window.game.resume(); });
  assert.equal(await page.evaluate(() => window.game.state.status), 'paused');
  assert.ok(Math.abs(await page.evaluate(() => window.game.state.failure.remaining) - 60) < 1e-8);
  await page.getByRole('button', { name: 'Back to game', exact: true }).click();
  assert.equal(await page.evaluate(() => window.game.state.status), 'playing');
  await page.evaluate(() => window.game.step(60));
  assert.equal(await page.locator('.meshpad-resource-value').textContent(), '00:00');
  assert.equal(await page.getByRole('dialog').getByRole('heading').textContent(), 'Time’s up!');
  assert.match(await page.locator('.meshpad-result-detail').textContent(), /\+7 seconds/);
  await page.getByRole('button', { name: 'Play on', exact: true }).click();
  assert.equal(await page.evaluate(() => window.game.state.failure.remaining), 7);
  await page.evaluate(() => window.game.step(7));
  assert.equal(await page.evaluate(() => window.game.state.status), 'failed');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForFunction(() => window.game.state.status === 'playing');
  assert.equal(await page.locator('.meshpad-resource-value').textContent(), '01:05');
});

test('moves count only explicit moves and per-level modes override the game default', async (t) => {
  const page = await pageFor(t);
  const results = await page.evaluate(async () => {
    const game = window.game = window.fixture.createGame({ failure: { type: 'moves', moves: 2 }, levels: [
      { setup(context) { window.levelContext = context; } },
      { failure: { type: 'moves', moves: 1, playOnMoves: 4 }, setup() {} },
      { failure: { type: 'default' }, setup() {} },
      { failure: { type: 'time', seconds: 1 }, setup() {} },
    ] });
    await game.ready;
    game.step(3);
    const initial = game.state.failure.remaining;
    window.levelContext.move(); game.move();
    const failed = game.state.status;
    game.playOn();
    const defaultBonus = game.state.failure.remaining;
    await game.loadLevel(1);
    game.move(); game.playOn();
    const customBonus = game.state.failure.remaining;
    await game.loadLevel(2);
    game.fail();
    const noPlayOn = game.playOn();
    const defaultButtons = [...document.querySelectorAll('.meshpad-panel button')].filter((button) => button.offsetParent !== null).map((button) => button.textContent);
    await game.loadLevel(3);
    game.step(1); game.playOn();
    const defaultTimeBonus = game.state.failure.remaining;
    await game.loadLevel(0);
    game.move(); game.win(); game.move();
    return { initial, failed, defaultBonus, customBonus, noPlayOn, defaultButtons, defaultTimeBonus, winningStatus: game.state.status };
  });
  assert.deepEqual(results, { initial: 2, failed: 'failed', defaultBonus: 10, customBonus: 4, noPlayOn: false, defaultButtons: ['Retry'], defaultTimeBonus: 20, winningStatus: 'won' });
  await page.evaluate(() => window.game.restart());
  assert.equal(await page.locator('.meshpad-resource-label').textContent(), 'Moves');
  assert.equal(await page.locator('.meshpad-resource-value').textContent(), '2');
});

test('all four HUDs keep the constraint truly centered, level left, and actions right in one row', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    window.game = window.fixture.createGame({ levels: [
      { setup() {} },
      { failure: { type: 'hearts', hearts: 5 }, setup() {} },
      { failure: { type: 'time', seconds: 125 }, setup() {} },
      { failure: { type: 'moves', moves: 25 }, setup() {} },
    ] });
    await window.game.ready;
  });
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(() => Math.abs(document.querySelector('.meshpad-stage').getBoundingClientRect().height - innerHeight) < 1);
    for (let index = 0; index < 4; index++) {
      await page.evaluate((index) => window.game.loadLevel(index), index);
      const layout = await page.locator('.meshpad-top nav').evaluate((nav) => {
        const outer = nav.getBoundingClientRect();
        const elements = [...nav.querySelectorAll('h1, .meshpad-resource, .meshpad-hud-actions button')].filter((element) => !element.hidden).map((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, centerY: rect.top + rect.height / 2, clipped: element.scrollWidth > element.clientWidth + 1 };
        });
        const resource = nav.querySelector('.meshpad-resource');
        const constraint = resource.getBoundingClientRect();
        const actions = nav.querySelector('.meshpad-hud-actions').getBoundingClientRect();
        return { centered: resource.hidden || Math.abs((constraint.left + constraint.right - outer.left - outer.right) / 2) < 0.5,
          levelLeft: elements[0].left < outer.left + outer.width / 4,
          actionsRight: actions.left > outer.left + outer.width / 2,
          inside: elements.every((element) => element.left >= outer.left && element.right <= outer.right),
          aligned: elements.every((element) => Math.abs(element.centerY - elements[0].centerY) < 1),
          overlap: elements.some((element, i) => i > 0 && element.left < elements[i - 1].right), clipped: elements.some((element) => element.clipped) };
      });
      assert.deepEqual(layout, { centered: true, levelLeft: true, actionsRight: true, inside: true, aligned: true, overlap: false, clipped: false }, `${viewport.width}x${viewport.height}, mode ${index}`);
    }
  }
});

test('play-on errors offer retry only and cannot revive an error or disposed game', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(async () => {
    const errors = [];
    const game = window.fixture.createGame({ failure: { type: 'hearts' }, onError: (error) => errors.push(error.message), levels: [{ setup() {
      return { onPlayOn() { throw new Error('continue broke'); } };
    } }] });
    await game.ready;
    game.fail();
    const continued = game.playOn();
    const status = game.state.status;
    const again = game.playOn();
    const visible = [...document.querySelectorAll('.meshpad-panel button')].filter((button) => button.offsetParent !== null).map((button) => button.textContent);
    game.dispose();
    return { continued, status, again, visible, errors, disposed: game.playOn() };
  });
  assert.deepEqual(result, { continued: false, status: 'error', again: false, visible: ['Retry'], errors: ['continue broke'], disposed: false });
});

test('opening the levels list during async setup keeps the timer paused after setup completes', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    window.game = window.fixture.createGame({ failure: { type: 'time', seconds: 30 }, levels: [{ async setup() {
      await new Promise((resolve) => { window.finishSetup = resolve; });
    } }] });
    await Promise.resolve();
  });
  await page.locator('[data-action="levels"]').click();
  await page.evaluate(async () => { window.finishSetup(); await window.game.ready; window.game.step(5); });
  assert.equal(await page.evaluate(() => window.game.state.status), 'paused');
  assert.equal(await page.evaluate(() => window.game.state.failure.remaining), 30);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => window.game.state.status), 'playing');
});

test('level dropdown shows scrollable rows with difficulties and reveals the current selection', async (t) => {
  const page = await pageFor(t);
  await page.evaluate(async () => {
    window.game = window.fixture.createGame({ levels: Array.from({ length: 40 }, (_, index) => ({
      name: `Puzzle ${index + 1}`,
      difficulty: [undefined, 'hard', 'very-hard', 'ultra-hard'][index % 4],
      setup() {},
    })) });
    await window.game.ready;
  });
  const chooser = page.getByRole('button', { name: 'Level 1, choose level', exact: true });
  assert.equal(await chooser.getAttribute('aria-expanded'), 'false');
  await chooser.click();
  assert.equal(await page.locator('[data-action="levels"]').getAttribute('aria-expanded'), 'true');
  assert.deepEqual(await page.locator('.meshpad-difficulty').allTextContents(), Array.from({ length: 40 }, (_, i) => ['Normal', 'Hard', 'Very hard', 'Ultra hard'][i % 4]));
  assert.equal(await page.locator('.meshpad-levels button').first().getAttribute('aria-describedby'), await page.locator('.meshpad-difficulty').first().getAttribute('id'));
  assert.equal(await page.locator('.meshpad-levels').evaluate((list) => list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY === 'auto'), true);
  const last = page.getByRole('button', { name: 'Level 40: Puzzle 40', exact: true });
  await last.focus();
  assert.ok(await page.locator('.meshpad-levels').evaluate((list) => list.scrollTop) > 0);
  await last.click();
  await page.waitForFunction(() => window.game.state.index === 39 && window.game.state.status === 'playing');
  assert.equal(await page.getByRole('button', { name: 'Level 40, choose level', exact: true }).isVisible(), true);
  await page.locator('[data-action="levels"]').click();
  assert.equal(await page.locator('.meshpad-levels [aria-current]').getAttribute('aria-label'), 'Level 40: Puzzle 40');
  assert.equal(await page.locator('.meshpad-levels [aria-current]').evaluate((button) => {
    const row = button.getBoundingClientRect();
    const list = button.parentElement.getBoundingClientRect();
    return row.top >= list.top && row.bottom <= list.bottom;
  }), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-action="levels"]').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('[data-action="levels"]').evaluate((button) => document.activeElement === button), true);
});

test('unsupported difficulties fail before creating a game', async (t) => {
  const page = await pageFor(t);
  const result = await page.evaluate(() => {
    let message;
    try { window.fixture.createGame({ levels: [{ difficulty: 'extreme', setup() {} }] }); }
    catch (error) { message = error.message; }
    return { message, stages: document.querySelectorAll('.meshpad-stage').length };
  });
  assert.match(result.message, /difficulty must be normal, hard, very-hard, or ultra-hard/);
  assert.equal(result.stages, 0);
});
