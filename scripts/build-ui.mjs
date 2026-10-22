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
