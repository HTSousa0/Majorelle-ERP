// Gera o executável do Windows em executaveis/windows/ (pronto para levar a outro computador).
//   node scripts/gerar-executaveis.mjs          -> Windows (o oficial)
//   node scripts/gerar-executaveis.mjs linux    -> só para testar o empacotamento no Linux (não é entregue)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const alvos = {
  windows: { pkg: 'node22-win-x64', exe: 'MajorelleERP.exe' },
  linux: { pkg: 'node22-linux-x64', exe: 'MajorelleERP' },
};
const nome = process.argv[2] ?? 'windows';
const alvo = alvos[nome];
if (!alvo) { console.error('Use: windows ou linux'); process.exit(1); }

const destino = `executaveis/${nome}`;
fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(destino, { recursive: true });
console.log(`▶ Gerando ${nome} (${alvo.pkg})…`);
execFileSync('npx', ['pkg', 'dist', '--targets', alvo.pkg, '--output', `${destino}/${alvo.exe}`, '--compress', 'GZip', '--no-bytecode', '--public'], { stdio: 'inherit', shell: process.platform === 'win32' });
fs.copyFileSync('.env.example', `${destino}/.env.example`);
fs.copyFileSync('LEIA-ME-EXECUTAVEL.txt', `${destino}/LEIA-ME.txt`);
console.log(`✔ Pronto em ${destino}/`);
