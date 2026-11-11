// Comandos de manutenção, rodados pela linha de comando (úteis se alguém esquecer a senha do administrador):
//   PizzariaERP.exe --redefinir-senha email@exemplo.com NovaSenha123
//   PizzariaERP.exe --restaurar C:\caminho\pizzaria-20261109-120000.db
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import Database from './db/sqlite.js';
import { abrirBanco } from './db/index.js';
import { normalizarEmail, validarSenha } from './services/authService.js';

// Devolve true se tratou algum comando (e então o servidor NÃO deve iniciar).
export async function tratarComandos(argv) {
  const [comando, ...args] = argv;

  if (comando === '--redefinir-senha') {
    const [emailBruto, novaSenha] = args;
    if (!emailBruto || !novaSenha) { console.log('Uso: --redefinir-senha <email> <nova-senha>'); return true; }
    const email = normalizarEmail(emailBruto);
    try { validarSenha(novaSenha, email); } catch (e) { console.log(`✘ ${e.message}`); return true; }
    const db = abrirBanco();
    const hash = await bcrypt.hash(novaSenha, Number(process.env.BCRYPT_CUSTO) || 12);
    const info = db.prepare('UPDATE usuarios SET senha_hash = ?, ativo = 1, token_versao = token_versao + 1 WHERE email = ?').run(hash, email);
    db.close();
    console.log(info.changes ? `✔ Senha de ${email} redefinida.` : `✘ Nenhum usuário com o e-mail ${email}.`);
    return true;
  }

  if (comando === '--restaurar') {
    const [arquivo] = args;
    if (!arquivo || !fs.existsSync(arquivo)) { console.log('Uso: --restaurar <arquivo-de-backup.db> (o arquivo precisa existir)'); return true; }
    const copia = new Database(arquivo);
    const ok = copia.pragma('integrity_check', { simple: true }) === 'ok';
    copia.close();
    if (!ok) { console.log('✘ Este backup está danificado. Nada foi alterado.'); return true; }

    const atual = config.dbArquivo;
    if (fs.existsSync(atual)) {
      const guardado = path.join(path.dirname(atual), `antes-da-restauracao-${Date.now()}.db`);
      fs.copyFileSync(atual, guardado);
      console.log(`Banco atual guardado em: ${guardado}`);
    }
    for (const sufixo of ['-wal', '-shm']) fs.rmSync(atual + sufixo, { force: true });
    fs.copyFileSync(arquivo, atual);
    console.log('✔ Backup restaurado. Abra o sistema normalmente.');
    return true;
  }
  return false;
}
