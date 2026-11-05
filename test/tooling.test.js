import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildProject, initProject, packageRoot, projectConfig, startDev } from '../src/tooling.js';
import { checkProject } from '../src/typecheck.js';
import { captureGame } from '../src/capture.js';

const exec = promisify(execFile);
async function temporary(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'meshpad-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('starter has one dependency and one implementation file; init never overwrites', async (t) => {
  const root = await temporary(t);
  await initProject(root);
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json')));
  assert.deepEqual(Object.keys(manifest.dependencies), ['meshpad']);
  assert.deepEqual((await readdir(root)).filter((file) => file.endsWith('.ts')), ['game.ts']);
  assert.equal((await readdir(root)).some((file) => file.endsWith('.js')), false);
  assert.equal(manifest.scripts.build, 'meshpad build');
  assert.equal(manifest.scripts.typecheck, 'meshpad typecheck');
  assert.equal(JSON.parse(await readFile(resolve(root, 'tsconfig.json'))).extends, 'meshpad/tsconfig');
  const deploy = JSON.parse(await readFile(resolve(root, 'vercel.json')));
  assert.equal(deploy.outputDirectory, 'dist');
  const before = await readFile(resolve(root, 'game.ts'), 'utf8');
  await assert.rejects(initProject(root), /Refusing to overwrite/);
  assert.equal(await readFile(resolve(root, 'game.ts'), 'utf8'), before);
});

test('init preflights every destination before writing any files', async (t) => {
  const root = await temporary(t);
  await writeFile(resolve(root, 'tsconfig.json'), '// keep me');
  await assert.rejects(initProject(root), /Refusing to overwrite/);
  assert.deepEqual(await readdir(root), ['tsconfig.json']);
});

test('single-file project builds a self-contained static site with styles and public assets', async (t) => {
  const root = await temporary(t);
  await initProject(root);
  await mkdir(resolve(root, 'public'));
  await mkdir(resolve(root, 'node_modules'));
  await symlink(packageRoot, resolve(root, 'node_modules/meshpad'), 'dir');
  await writeFile(resolve(root, 'public/asset.txt'), 'hello');
  await buildProject(undefined, { root });
  const html = await readFile(resolve(root, 'dist/index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /\.\/assets\/index-.*\.js/);
  assert.match(html, /stylesheet.*\.css/);
  assert.doesNotMatch(html, /@fs|\/Users\/|node_modules/);
  assert.equal(await readFile(resolve(root, 'dist/asset.txt'), 'utf8'), 'hello');
  const assets = await readdir(resolve(root, 'dist/assets'));
  const css = await readFile(resolve(root, 'dist/assets', assets.find((file) => file.endsWith('.css'))), 'utf8');
  assert.match(css, /safe-area-inset/);
  assert.match(css, /meshpad-root/);
});

test('build output cannot erase source or project directories', async (t) => {
  const root = await temporary(t);
  await initProject(root);
  for (const outDir of ['.', '..', 'public', 'node_modules/cache', '.git/output']) {
    await assert.rejects(projectConfig('game.ts', { root, outDir }), /Output must be/);
  }
  await mkdir(resolve(root, 'source'));
  await writeFile(resolve(root, 'source/game.ts'), '');
  await assert.rejects(projectConfig('source/game.ts', { root, outDir: 'source' }), /Output must be/);
  await assert.rejects(projectConfig('missing.ts', { root }), /Game file not found/);
});

test('JavaScript and declaration-only entries are rejected by every game command', async (t) => {
  const root = await temporary(t);
  for (const entry of ['game.js', 'game.mjs', 'game.d.ts']) {
    await writeFile(resolve(root, entry), 'export {};');
    for (const command of [projectConfig, buildProject, startDev, checkProject, captureGame]) {
      await assert.rejects(command(entry, { root }), /requires a TypeScript entry file/);
    }
  }
});

test('type errors block builds, dev, rendering, and the standalone check without erasing dist', async (t) => {
  const root = await temporary(t);
  await initProject(root);
  await mkdir(resolve(root, 'dist'));
  await writeFile(resolve(root, 'dist/keep.txt'), 'last good build');
  await writeFile(resolve(root, 'game.ts'), "import { createGame } from 'meshpad';\nconst count: number = 'wrong';\ncreateGame({ levels: [{ setup() {} }] });\n");
  for (const command of [buildProject, startDev, captureGame, checkProject]) {
    await assert.rejects(command(undefined, { root }), (error) => {
      assert.match(error.message, /TypeScript check failed/);
      assert.match(error.message, /game\.ts/);
      assert.match(error.message, /not assignable to type 'number'/);
      return true;
    });
  }
  await assert.rejects(exec(process.execPath, [resolve(packageRoot, 'bin/meshpad.js'), 'typecheck'], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /TypeScript check failed/);
    return true;
  });
  assert.equal(await readFile(resolve(root, 'dist/keep.txt'), 'utf8'), 'last good build');
});

test('a single TS file works without config; imported TypeScript is checked too', async (t) => {
  const root = await temporary(t);
  await writeFile(resolve(root, 'main.ts'), "import { createGame } from 'meshpad';\ncreateGame({ levels: [{ setup() {} }] });\n");
  await checkProject('main.ts', { root });
  await writeFile(resolve(root, 'value.ts'), "export const value: number = 'wrong';");
  await writeFile(resolve(root, 'main.ts'), "import { value } from './value.ts'; console.log(value);");
  await assert.rejects(checkProject('main.ts', { root }), /value\.ts/);
});

test('Vite asset imports and import.meta.env are typed without a second dependency', async (t) => {
  const root = await temporary(t);
  await writeFile(resolve(root, 'badge.svg'), '<svg xmlns="http://www.w3.org/2000/svg" />');
  await writeFile(resolve(root, 'game.ts'), "import { createGame } from 'meshpad';\nimport badge from './badge.svg';\nconst url: string = badge;\nconst base: string = import.meta.env.BASE_URL;\ncreateGame({ title: url + base, levels: [{ setup() {} }] });\n");
  await checkProject(undefined, { root });
});

test('capture validates bounds before starting a server or browser', async () => {
  for (const options of [{ width: 0 }, { height: 4097 }, { time: -1 }, { level: 0 }, { timeout: 0 }, { output: 'game.js' }]) {
    await assert.rejects(captureGame('missing.ts', options));
  }
});

test('CLI reports invalid commands and flags with a nonzero exit code', async () => {
  for (const args of [['unknown'], ['dev', '--port', 'wat'], ['--unknown'], ['preview', 'extra.js']]) {
    await assert.rejects(exec(process.execPath, [resolve(packageRoot, 'bin/meshpad.js'), ...args]), (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /meshpad:/);
      return true;
    });
  }
  const { stdout } = await exec(process.execPath, [resolve(packageRoot, 'bin/meshpad.js'), '--help']);
  assert.match(stdout, /meshpad render/);
});

test('script validation rejects malformed steps before starting a game', async () => {
  const { validateSteps } = await import('../src/capture.js');
  for (const script of [{}, [null], [{ type: 'drag' }], [{ type: 'pointerdown', world: [1, 2] }], [{ type: 'pointermove', world: [0, NaN, 0] }], [{ type: 'advance', seconds: 61 }], [{ type: 'screenshot', output: 'bad.jpg' }], [{ type: 'state', label: 2 }]]) {
    assert.throws(() => validateSteps(script), /Script/);
  }
  assert.deepEqual(validateSteps([{ type: 'pointerup' }, { type: 'state' }]), [{ type: 'pointerup' }, { type: 'state' }]);
  await assert.rejects(captureGame('missing.ts', { dpr: 0 }), /dpr/);
  await assert.rejects(captureGame('missing.ts', { dpr: 5 }), /dpr/);
  await assert.rejects(exec(process.execPath, [resolve(packageRoot, 'bin/meshpad.js'), 'play']), /requires --script/);
});

test('add-ons typecheck and build in a single dependency project', async (t) => {
  const root = await temporary(t);
  await initProject(root);
  await mkdir(resolve(root, 'node_modules'));
  await symlink(packageRoot, resolve(root, 'node_modules/meshpad'), 'dir');
  await writeFile(resolve(root, 'game.ts'), `
    import { createGame, THREE } from 'meshpad';
    import { BufferGeometryUtils, OrbitControls } from 'meshpad/addons';
    createGame({ levels: [{ setup({ scene, camera, renderer }) {
      const controls = new OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.Mesh(BufferGeometryUtils.mergeVertices(new THREE.BoxGeometry())));
      return { beforeRender() { controls.update(); }, debug: () => ({ ok: true }), dispose() { controls.dispose(); } };
    } }] });
  `);
  await buildProject(undefined, { root, logLevel: 'error' });
  const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', "console.log(import.meta.resolve('meshpad/addons'));"], { cwd: root });
  assert.match(stdout.trim(), /src\/addons\.js$/);
});
