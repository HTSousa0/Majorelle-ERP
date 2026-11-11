// Monta o app Express. Recebe as dependências como parâmetro (banco, impressora, fiscal, backup, segredo do login)
// para ser fácil de testar com banco em memória e impressora falsa.
//
//   /auth/*      login (público)
//   /cardapio    cardápio somente leitura (público)
//   /n8n/*       pedidos vindos do WhatsApp (exige x-api-key)
//   /api/*       todo o resto do sistema (exige login)
//   /            interface web (pasta public/)
import express from 'express';
import { authRouter } from './routes/auth.js';
import { backupRouter } from './routes/backup.js';
import { cardapioRouter } from './routes/cardapio.js';
import { clientesRouter } from './routes/clientes.js';
import { configuracoesRouter } from './routes/configuracoes.js';
import { dashboardRouter } from './routes/dashboard.js';
import { impressoraRouter } from './routes/impressora.js';
import { insumosRouter } from './routes/insumos.js';
import { n8nRouter } from './routes/n8n.js';
import { pedidosRouter } from './routes/pedidos.js';
import { produtosRouter } from './routes/produtos.js';
import { sistemaRouter } from './routes/sistema.js';
import { usuariosRouter } from './routes/usuarios.js';
import { exigirAdmin, middlewareAutenticacao } from './services/authService.js';
import { pastaPublica } from './utils/caminhos.js';
import { naoEncontrado, tratarErros } from './utils/erros.js';

export function criarApp(db, { impressora, fiscal, apiKey, segredo, servicoBackup, googleClientId = '', buscarChavesGoogle }) {
  const app = express();
  app.disable('x-powered-by');

  // Cabeçalhos de segurança. A página só carrega scripts, estilos e fontes do próprio servidor
  // (e o login do Google, se estiver configurado).
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://accounts.google.com; script-src 'self' https://accounts.google.com; connect-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(express.json({ limit: '200kb' }));

  app.get('/saude', (req, res) => res.json({ status: 'ok' }));
  app.use('/auth', authRouter(db, { segredo, googleClientId, buscarChavesGoogle }));
  app.use('/cardapio', cardapioRouter(db));
  app.use('/n8n', n8nRouter(db, { impressora, apiKey }));
  app.use(express.static(pastaPublica())); // interface web

  // ---- tudo abaixo exige login ----
  app.use('/api', middlewareAutenticacao(db, segredo));
  app.use('/api/dashboard', dashboardRouter(db));
  app.use('/api/clientes', clientesRouter(db));
  app.use('/api/produtos', produtosRouter(db));
  app.use('/api/insumos', insumosRouter(db));
  app.use('/api/pedidos', pedidosRouter(db, { impressora, fiscal }));
  app.use('/api/configuracoes', configuracoesRouter(db));
  app.use('/api/sistema', sistemaRouter(db, { apiKey }));
  // somente administradores
  app.use('/api/usuarios', exigirAdmin, usuariosRouter(db));
  app.use('/api/impressora', exigirAdmin, impressoraRouter(db, impressora));
  app.use('/api/backup', exigirAdmin, backupRouter(db, servicoBackup));

  app.use(naoEncontrado);
  app.use(tratarErros);
  return app;
}
