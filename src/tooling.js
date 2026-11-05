import { readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, build, preview } from 'vite';
import { checkProject, resolveProject, watchProject } from './typecheck.js';

export const packageRoot = fileURLToPath(new URL('../', import.meta.url));
export const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

const escapeHTML = (text) => text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export function shell(entry, title = 'Meshpad') {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <meta name="theme-color" content="#221e4e" />
    <meta name="format-detection" content="telephone=no, date=no, address=no, email=no" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <link rel="icon" href="data:," />
    <title>${escapeHTML(title)}</title>
  </head>
  <body><script type="module" src="${escapeHTML(entry)}"></script></body>
</html>`;
}

export async function projectConfig(entry = 'game.ts', options = {}) {
  // Vite canonicalizes roots; the virtual HTML entry must use the same path.
  const { root, source } = await resolveProject(entry, options);
  const index = resolve(root, 'index.html');
  const html = shell(`/@fs/${source.replaceAll('\\', '/')}`, options.title);
  const outDir = resolve(root, options.outDir ?? 'dist');
  const outPath = relative(root, outDir);
  const sourceInOutput = relative(outDir, source);
  if (!outPath || outPath.startsWith('..') || isAbsolute(outPath) || ['public', 'node_modules', '.git'].includes(outPath.split(/[\\/]/)[0]) || (!sourceInOutput.startsWith('..') && !isAbsolute(sourceInOutput))) {
    throw new Error('Output must be a separate directory inside the project, away from the game source, public, node_modules, and .git.');
  }
  return {
    root, configFile: false, base: './', publicDir: resolve(root, 'public'),
    appType: 'spa',
    resolve: {
      // Also supports working on Meshpad's own example without installing itself.
      alias: [
        { find: /^meshpad$/, replacement: resolve(packageRoot, 'index.js') },
        { find: /^meshpad\/three$/, replacement: resolve(packageRoot, 'src/three.js') },
      ],
      dedupe: ['three'],
    },
    plugins: [{
      name: 'meshpad-shell', enforce: 'pre',
      resolveId(id) { if (id === index) return index; },
      load(id) { if (id === index) return html; },
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const pathname = req.url?.split('?')[0];
          if (pathname !== '/' && pathname !== '/index.html') return next();
          try {
            const result = await server.transformIndexHtml(req.url, html);
            res.statusCode = 200; res.setHeader('Content-Type', 'text/html'); res.end(result);
          } catch (error) { next(error); }
        });
      },
    }],
    optimizeDeps: { entries: [source] },
    server: {
      host: options.host ?? '127.0.0.1', port: options.port ?? 5173,
      fs: { allow: [root, packageRoot, dirname(source)] },
    },
    preview: { host: options.host ?? '127.0.0.1', port: options.port ?? 4173 },
    build: {
      outDir, emptyOutDir: true,
      target: ['es2022', 'safari15', 'chrome96'],
      rolldownOptions: { input: index },
      chunkSizeWarningLimit: 650,
    },
  };
}

export async function startDev(entry, options = {}) {
  const config = await projectConfig(entry, options);
  const { source } = await checkProject(entry, { root: config.root });
  const server = await createServer(config);
  watchProject(server, source, config.root);
  try { await server.listen(); } catch (error) { await server.close(); throw error; }
  return server;
}

export async function buildProject(entry, options = {}) {
  const config = await projectConfig(entry, options);
  await checkProject(entry, { root: config.root });
  return build(config);
}

export async function previewProject(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  const outDir = resolve(root, options.outDir ?? 'dist');
  try { await access(resolve(outDir, 'index.html')); } catch { throw new Error('No built game found. Run "meshpad build" first.'); }
  return preview({ root, configFile: false, build: { outDir }, preview: { host: options.host ?? '127.0.0.1', port: options.port ?? 4173 } });
}

export async function initProject(directory = '.', version = manifest.version) {
  const root = resolve(directory);
  const files = {
    'package.json': JSON.stringify({
      name: root.split(/[\\/]/).at(-1).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'meshpad-game',
      version: '0.0.0', private: true, type: 'module',
      scripts: { dev: 'meshpad dev', build: 'meshpad build', preview: 'meshpad preview', render: 'meshpad render', typecheck: 'meshpad typecheck' },
      engines: { node: '>=22.12.0' },
      dependencies: { meshpad: `^${version}` },
    }, null, 2) + '\n',
    'game.ts': await readFile(new URL('../templates/game.ts', import.meta.url), 'utf8'),
    'tsconfig.json': JSON.stringify({ extends: 'meshpad/tsconfig', include: ['**/*.ts'], exclude: ['node_modules', 'dist', 'renders'] }, null, 2) + '\n',
    'vercel.json': JSON.stringify({ $schema: 'https://openapi.vercel.sh/vercel.json', framework: null, buildCommand: 'npm run build', outputDirectory: 'dist' }, null, 2) + '\n',
    '.gitignore': 'node_modules/\ndist/\nrenders/\n.vercel/\n.DS_Store\n',
  };
  for (const name of Object.keys(files)) {
    let exists = false;
    try { await access(resolve(root, name)); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (exists) throw new Error(`Refusing to overwrite ${resolve(root, name)}. Choose an empty directory.`);
  }
  await mkdir(root, { recursive: true });
  for (const [name, content] of Object.entries(files)) await writeFile(resolve(root, name), content, { flag: 'wx' });
  return root;
}
