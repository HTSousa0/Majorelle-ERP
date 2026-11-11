import { spawn } from 'node:child_process';
import path from 'node:path';
import { criarApp } from './app.js';
import { tratarComandos } from './cli.js';
import { config } from './config.js';
import { abrirBanco } from './db/index.js';
import { enderecosNaRede } from './routes/sistema.js';
import { obterSegredoJwt } from './services/authService.js';
import { criarServicoBackup } from './services/backupService.js';
import { criarServicoFiscal } from './services/fiscalService.js';
import { criarImpressora, lerConfigImpressora } from './services/impressaoService.js';
import { empacotado, pastaDados, pastaExecutavel } from './utils/caminhos.js';

// Num executável (duplo clique no Windows) a janela fecha sozinha ao dar erro: espera Enter para você ler a mensagem.
function falhar(mensagem) {
  console.error('\n❌ ' + mensagem);
  if (empacotado) {
    console.error('\nPressione Enter para fechar.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else process.exit(1);
}

function abrirNavegador(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch { /* sem navegador: tudo bem */ }
}

async function iniciar() {
  if (await tratarComandos(process.argv.slice(2))) return; // comandos de manutenção (--redefinir-senha, --restaurar)

  const db = abrirBanco();
  const servicoBackup = criarServicoBackup(db, { pastaBackups: path.join(pastaDados(), 'backups') });
  const app = criarApp(db, {
    impressora: criarImpressora(db),
    fiscal: criarServicoFiscal({ ativo: config.fiscalAtivo }),
    apiKey: config.apiKey,
    segredo: obterSegredoJwt(),
    servicoBackup,
    googleClientId: config.googleClientId,
  });

  const servidor = app.listen(config.porta, () => {
    const local = `http://localhost:${config.porta}`;
    console.log('🍕 Majorelle ERP está rodando!\n');
    console.log(`   Neste computador:   ${local}`);
    for (const url of enderecosNaRede(config.porta)) console.log(`   Outros aparelhos:   ${url}  (mesma rede Wi-Fi)`);
    console.log(`\n   Dados salvos em:    ${config.dbArquivo}`);
    console.log(`   Backups em:         ${servicoBackup.pastaBackups}`);
    console.log(`   Impressora:         ${{ console: 'modo teste (o cupom aparece aqui no terminal)', windows: 'impressora do Windows', rede: 'impressora de rede' }[lerConfigImpressora(db).modo]}`);
    console.log('\n   Para encerrar, feche esta janela ou pressione Ctrl+C.\n');
    servicoBackup.iniciarAgendador();
    if (empacotado && process.env.ABRIR_NAVEGADOR !== 'false') abrirNavegador(local);
  });

  servidor.on('error', (erro) => {
    falhar(erro.code === 'EADDRINUSE'
      ? `A porta ${config.porta} já está em uso (o programa talvez já esteja aberto). Mude PORTA no arquivo .env em ${pastaExecutavel()}.`
      : `Erro ao iniciar o servidor: ${erro.message}`);
  });

  for (const sinal of ['SIGINT', 'SIGTERM']) process.on(sinal, () => { db.close(); process.exit(0); });
}

iniciar().catch((erro) => falhar(`Não consegui iniciar: ${erro.message}`));
