// Gera dist/: o código inteiro (e as bibliotecas) num único arquivo + migrações + interface.
// Depois o "pkg" transforma o dist/app.cjs em executáveis (Windows, Linux e macOS).
import { build } from 'esbuild';
import fs from 'node:fs';

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist', { recursive: true });

await build({
  entryPoints: ['src/server.js'],
  outfile: 'dist/app.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  logLevel: 'warning',
  logOverride: { 'empty-import-meta': 'silent' }, // import.meta só é usado fora do executável
});

// Arquivos lidos em tempo de execução (ficam embutidos no executável pelo pkg "assets")
fs.cpSync('src/db/migrations', 'dist/migrations', { recursive: true });
fs.copyFileSync('src/db/indices.sql', 'dist/indices.sql');
fs.cpSync('public', 'dist/public', { recursive: true });
// package.json de dentro do dist: diz ao pkg qual é o programa e quais arquivos embutir
fs.writeFileSync('dist/package.json', JSON.stringify({
  name: 'pizzaria-erp',
  version: JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  bin: 'app.cjs',
  pkg: { assets: ['migrations/**/*', 'public/**/*', 'indices.sql'] },
}, null, 2));
console.log('✔ dist/ pronto');
