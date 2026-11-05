#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { buildProject, initProject, manifest, previewProject, startDev } from '../src/tooling.js';
import { checkProject } from '../src/typecheck.js';

const help = `Meshpad · single-file 3D game prototypes

Usage:
  meshpad init [directory]          Create a TypeScript hello-world project
  meshpad dev [game.ts]             Start Vite with live type checking
  meshpad build [game.ts]           Type check and build into dist/
  meshpad typecheck [game.ts]       Check project types without building
  meshpad preview                  Serve a production build locally
  meshpad browsers [--with-deps]    Install Chromium for rendering
  meshpad render [game.ts]          Type check and render to PNG + JSON
  meshpad play [game.ts] --script <steps.json>
                                   Run scripted input; print capture JSON

Options:
  --host <host>                    Dev/preview host (default: 127.0.0.1)
  --port <number>                  Dev/preview port
  --out-dir <path>                 Build/preview output directory
  --output, -o <path.png>           Render output (default: renders/game.png)
  --width <pixels>                 Render viewport width (default: 390)
  --height <pixels>                Render viewport height (default: 844)
  --dpr <number>                   Capture pixel ratio, 0.25–4 (default: 1)
  --script <steps.json>            Pointer, advance, screenshot, and state steps
  --json                          Print render result as JSON (play default)
  --level <number>                 Render level, starting at 1
  --time <seconds>                 Advance simulation before capture (0–60)
  --timeout <milliseconds>         Render setup timeout (default: 30000)
  --scene-only                    Capture without the HUD
  --help, -h                      Show help
  --version, -v                   Show version
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      host: { type: 'string' }, port: { type: 'string' }, 'out-dir': { type: 'string' },
      output: { type: 'string', short: 'o' }, width: { type: 'string' }, height: { type: 'string' },
      level: { type: 'string' }, time: { type: 'string' }, timeout: { type: 'string' },
      dpr: { type: 'string' }, script: { type: 'string' }, json: { type: 'boolean' },
      'scene-only': { type: 'boolean' }, 'with-deps': { type: 'boolean' },
    },
  });
  const [command = 'dev', entry, ...extra] = positionals;
  if (values.version) console.log(manifest.version);
  else if (values.help) console.log(help);
  else {
    if (extra.length || (entry && ['preview', 'browsers'].includes(command))) throw new Error('Too many arguments. Run "meshpad --help".');
    const options = { host: values.host, outDir: values['out-dir'] };
    if (values.port != null) {
      options.port = Number(values.port);
      if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error('port must be an integer from 0 to 65535.');
    }
    switch (command) {
      case 'init': {
        const directory = await initProject(entry);
        console.log(`Created ${directory}\n\nNext: cd ${JSON.stringify(directory)}\n      npm install\n      npm run dev`);
        break;
      }
      case 'dev': {
        const server = await startDev(entry, options);
        server.printUrls();
        break;
      }
      case 'build': await buildProject(entry, options); break;
      case 'typecheck': {
        await checkProject(entry);
        console.log('TypeScript check passed.');
        break;
      }
      case 'preview': {
        const server = await previewProject(options);
        server.printUrls();
        break;
      }
      case 'browsers': {
        const require = createRequire(import.meta.url);
        const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
        const child = spawn(process.execPath, [cli, 'install', 'chromium', ...(values['with-deps'] ? ['--with-deps'] : [])], { stdio: 'inherit' });
        process.exitCode = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => resolve(code ?? 1)); });
        break;
      }
      case 'render': case 'play': {
        if (command === 'play' && !values.script) throw new Error('play requires --script <steps.json>.');
        const { captureGame } = await import('../src/capture.js');
        const renderOptions = { output: values.output, sceneOnly: values['scene-only'], script: values.script };
        for (const name of ['width', 'height', 'level', 'time', 'timeout', 'dpr']) if (values[name] != null) renderOptions[name] = Number(values[name]);
        const result = await captureGame(entry, renderOptions);
        if (command === 'play' || values.json) console.log(JSON.stringify(result, null, 2));
        else console.log(`Rendered level ${result.level} → ${result.output}\n${result.three.calls} draw calls · ${result.three.triangles} triangles`);
        break;
      }
      default: throw new Error(`Unknown command: ${command}. Run "meshpad --help".`);
    }
  }
} catch (error) {
  console.error(`meshpad: ${error.message}`);
  process.exitCode = 1;
}
