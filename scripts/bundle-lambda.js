import * as esbuild from 'esbuild';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const entryPoint = path.join(rootDir, 'src', 'index.ts');
const bundleDir = path.join(rootDir, 'bundle');
const outfile = path.join(bundleDir, 'index.mjs');
const zipPath = path.join(rootDir, 'lambda-echo.zip');

// Clean previous output
if (fs.existsSync(bundleDir)) fs.rmSync(bundleDir, { recursive: true });
if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
fs.mkdirSync(bundleDir, { recursive: true });

// Bundle with esbuild
console.log('Bundling echo worker...');
const result = await esbuild.build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  external: ['@aws-sdk/*'],
  minify: false,
  metafile: true,
});

const bundleSize = fs.statSync(outfile).size;
console.log(`Bundle size: ${(bundleSize / 1024).toFixed(1)} KB`);

// Smoke test: verify bundle exports handler
const bundleUrl = pathToFileURL(outfile).href;
const bundled = await import(bundleUrl);
if (typeof bundled.handler !== 'function') {
  console.error('ERROR: Bundle does not export a "handler" function');
  process.exit(1);
}
console.log('Smoke test passed: handler is a function');

// Create zip
execSync(`zip -j "${zipPath}" "${outfile}"`, { stdio: 'inherit' });

const zipSize = fs.statSync(zipPath).size;
console.log(`Lambda package created: lambda-echo.zip (${(zipSize / 1024).toFixed(1)} KB)`);
