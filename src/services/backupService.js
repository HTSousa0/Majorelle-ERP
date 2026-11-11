// Backup automático do banco. Usa VACUUM INTO (cópia consistente mesmo com o sistema em uso),
// confere a integridade da cópia, mantém só os N mais recentes e, se configurado, copia também para outra pasta.
import fs from 'node:fs';
import path from 'node:path';
import { lerConfig } from '../db/index.js';
import Database from '../db/sqlite.js';
import { ErroHttp } from '../utils/erros.js';

export const PADRAO_NOME = /^pizzaria-\d{8}-\d{6}\.db$/;

const doisDigitos = (n) => String(n).padStart(2, '0');
function carimbo(d = new Date()) {
  return `${d.getFullYear()}${doisDigitos(d.getMonth() + 1)}${doisDigitos(d.getDate())}-${doisDigitos(d.getHours())}${doisDigitos(d.getMinutes())}${doisDigitos(d.getSeconds())}`;
}

function gravarConfig(db, chave, valor) {
  db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
}

function apagarAntigos(pasta, manter) {
  const nomes = fs.readdirSync(pasta).filter((n) => PADRAO_NOME.test(n)).sort().reverse();
  for (const nome of nomes.slice(manter)) fs.rmSync(path.join(pasta, nome), { force: true });
}

export function criarServicoBackup(db, { pastaBackups }) {
  fs.mkdirSync(pastaBackups, { recursive: true });
  let emAndamento = false;

  function listar() {
    return fs.readdirSync(pastaBackups).filter((n) => PADRAO_NOME.test(n)).sort().reverse().map((nome) => {
      const info = fs.statSync(path.join(pastaBackups, nome));
      return { nome, tamanho: info.size, criado_em: info.mtime.toISOString() };
    });
  }

  function caminhoDoBackup(nome) {
    if (!PADRAO_NOME.test(String(nome))) throw new ErroHttp(400, 'Nome de backup inválido.'); // impede "../" e afins
    const caminho = path.join(pastaBackups, nome);
    if (!fs.existsSync(caminho)) throw new ErroHttp(404, 'Backup não encontrado.');
    return caminho;
  }

  // Cria um backup agora. Nunca lança erro para quem chama o agendador: devolve { ok, ... }.
  function criarBackup() {
    if (emAndamento) return { ok: false, erro: 'Já existe um backup em andamento.' };
    emAndamento = true;
    try {
      // se já existe um backup neste mesmo segundo, usa o segundo seguinte (o nome continua ordenável)
      let momento = new Date();
      while (fs.existsSync(path.join(pastaBackups, `pizzaria-${carimbo(momento)}.db`))) momento = new Date(momento.getTime() + 1000);
      const nome = `pizzaria-${carimbo(momento)}.db`;
      const destino = path.join(pastaBackups, nome);
      db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

      // confere se a cópia abre e está íntegra
      const copia = new Database(destino);
      const resultado = copia.pragma('integrity_check', { simple: true });
      copia.close();
      if (resultado !== 'ok') { fs.rmSync(destino, { force: true }); throw new Error('A cópia do banco falhou na verificação de integridade.'); }

      const manter = Math.max(1, Number(lerConfig(db, 'backup_manter', '20')) || 20);
      apagarAntigos(pastaBackups, manter);

      // segunda cópia (pendrive, OneDrive...): se falhar, avisa mas não invalida o backup local
      let avisoExtra = '';
      const extra = lerConfig(db, 'backup_pasta_extra', '').trim();
      if (extra) {
        try {
          fs.mkdirSync(extra, { recursive: true });
          fs.copyFileSync(destino, path.join(extra, nome));
          apagarAntigos(extra, manter);
        } catch (e) { avisoExtra = `Não consegui copiar para "${extra}": ${e.message}`; }
      }
      gravarConfig(db, 'backup_ultimo', new Date().toISOString());
      gravarConfig(db, 'backup_ultimo_erro', avisoExtra);
      return { ok: true, nome, aviso: avisoExtra || undefined };
    } catch (e) {
      gravarConfig(db, 'backup_ultimo_erro', e.message);
      return { ok: false, erro: e.message };
    } finally { emAndamento = false; }
  }

  function estaNaHora() {
    if (lerConfig(db, 'backup_ativo', 'true') !== 'true') return false;
    const ultimo = Date.parse(lerConfig(db, 'backup_ultimo', ''));
    const horas = Math.max(1, Number(lerConfig(db, 'backup_intervalo_horas', '6')) || 6);
    return Number.isNaN(ultimo) || Date.now() - ultimo >= horas * 3600 * 1000;
  }

  // Verifica a cada 10 minutos se já passou o intervalo configurado.
  function iniciarAgendador() {
    const verificar = () => { if (estaNaHora()) criarBackup(); };
    setTimeout(verificar, 20 * 1000).unref();
    setInterval(verificar, 10 * 60 * 1000).unref();
  }

  return { pastaBackups, listar, criarBackup, caminhoDoBackup, estaNaHora, iniciarAgendador };
}
