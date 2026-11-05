import { realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { stripVTControlCharacters } from 'node:util';

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const baseConfig = resolve(packageRoot, 'tsconfig.json');
const formatHost = {
  getCurrentDirectory: () => process.cwd(),
  getCanonicalFileName: (file) => file,
  getNewLine: () => '\n',
};

export async function resolveProject(entry = 'game.ts', options = {}) {
  const root = await realpath(resolve(options.root ?? process.cwd()));
  const source = resolve(root, entry);
  if (!source.endsWith('.ts') || source.endsWith('.d.ts')) {
    throw new Error('Meshpad requires a TypeScript entry file (.ts). Rename your game to game.ts.');
  }
  let info;
  try { info = await stat(source); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Game file not found: ${source}. Run "meshpad init" to create game.ts.`);
  }
  if (!info.isFile()) throw new Error(`Game entry must be a TypeScript file: ${source}.`);
  return { root, source };
}

/** Check without emitting; Vite owns transpilation and bundling. */
export async function checkProject(entry, options = {}) {
  const { root, source } = await resolveProject(entry, options);
  const configPath = resolve(root, 'tsconfig.json');
  const hasConfig = ts.sys.fileExists(configPath);
  const config = ts.readConfigFile(hasConfig ? configPath : baseConfig, ts.sys.readFile);
  if (config.error) throw new Error(ts.formatDiagnosticsWithColorAndContext([config.error], formatHost));
  const raw = { ...config.config };
  // Resolve our preset even when using the CLI from npx, outside an installed project.
  const preset = (value) => value === 'meshpad/tsconfig' ? baseConfig : value;
  if (raw.extends) raw.extends = Array.isArray(raw.extends) ? raw.extends.map(preset) : preset(raw.extends);
  const parsed = ts.parseJsonConfigFileContent(raw, ts.sys, root, undefined, configPath);
  if (parsed.errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, formatHost));
  const compilerOptions = {
    ...parsed.options,
    noEmit: true, noCheck: false, allowJs: false,
    paths: {
      ...parsed.options.paths,
      meshpad: [resolve(packageRoot, 'index.d.ts')],
      'meshpad/three': [resolve(packageRoot, 'three.d.ts')],
      'meshpad/addons': [resolve(packageRoot, 'addons.d.ts')],
    },
  };
  const program = ts.createProgram({ rootNames: [...new Set([...parsed.fileNames, source])], options: compilerOptions });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length) throw new Error(`TypeScript check failed.\n${ts.formatDiagnosticsWithColorAndContext(diagnostics, formatHost)}`);
  return { root, source };
}

export function watchProject(server, source, root) {
  let timer;
  let closed = false;
  let hadError = false;
  const changed = (path) => {
    if (!path.endsWith('.ts') && !path.endsWith('.json')) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await checkProject(source, { root });
        if (closed) return;
        // Clear a previous error overlay, including errors in files not imported by Vite.
        if (hadError) server.ws.send({ type: 'full-reload' });
        hadError = false;
      } catch (error) {
        if (closed) return;
        hadError = true;
        server.config.logger.error(error.message);
        server.ws.send({ type: 'error', err: { message: stripVTControlCharacters(error.message), stack: '', plugin: 'meshpad-typecheck' } });
      }
    }, 100);
  };
  const events = ['change', 'add', 'unlink'];
  for (const event of events) server.watcher.on(event, changed);
  server.httpServer.once('close', () => {
    closed = true;
    clearTimeout(timer);
    for (const event of events) server.watcher.off(event, changed);
  });
}
