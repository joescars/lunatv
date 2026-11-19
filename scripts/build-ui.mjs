import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';

await build({
  entryPoints: ['frontend/material.js'],
  outfile: 'public/vendor/material-web.js',
  bundle: true,
  minify: true,
  format: 'esm',
  target: ['es2020'],
  legalComments: 'linked',
});

await mkdir('public/fonts', { recursive: true });
await copyFile('node_modules/@fontsource-variable/roboto/files/roboto-latin-wght-normal.woff2', 'public/fonts/roboto-latin.woff2');
await copyFile('node_modules/@fontsource-variable/roboto/LICENSE', 'public/fonts/Roboto-LICENSE.txt');

// Browser runtime libraries are vendored so the LAN-only app works offline.
const vendor = 'public/vendor';
await mkdir(`${vendor}/bootstrap-icons/fonts`, { recursive: true });
const copies = [
  ['node_modules/bootstrap/dist/css/bootstrap.min.css', `${vendor}/bootstrap.min.css`],
  ['node_modules/bootstrap/dist/js/bootstrap.bundle.min.js', `${vendor}/bootstrap.bundle.min.js`],
  ['node_modules/bootstrap/LICENSE', `${vendor}/bootstrap-LICENSE.txt`],
  ['node_modules/bootstrap-icons/font/bootstrap-icons.min.css', `${vendor}/bootstrap-icons/bootstrap-icons.min.css`],
  ['node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff2', `${vendor}/bootstrap-icons/fonts/bootstrap-icons.woff2`],
  ['node_modules/bootstrap-icons/font/fonts/bootstrap-icons.woff', `${vendor}/bootstrap-icons/fonts/bootstrap-icons.woff`],
  ['node_modules/bootstrap-icons/LICENSE', `${vendor}/bootstrap-icons/LICENSE`],
  ['node_modules/htmx.org/dist/htmx.min.js', `${vendor}/htmx.min.js`],
  ['node_modules/htmx.org/LICENSE', `${vendor}/htmx-LICENSE.txt`],
  ['node_modules/hls.js/dist/hls.min.js', `${vendor}/hls.min.js`],
  ['node_modules/hls.js/LICENSE', `${vendor}/hls-LICENSE.txt`],
];
for (const [from, to] of copies) await copyFile(from, to);
