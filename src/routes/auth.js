// Rotas públicas de login (/auth/*). As demais rotas do sistema ficam em /api e exigem token.
import { Router } from 'express';
import {
  autenticarGoogle, autenticarUsuario, criarUsuario, emitirToken, limparFalhas, middlewareAutenticacao,
  registrarFalha, trocarSenha, usuarioPublico, verificarBloqueio, normalizarEmail, validarSenha,
} from '../services/authService.js';
import { asyncH, ErroHttp } from '../utils/erros.js';

export function authRouter(db, { segredo, googleClientId = '', buscarChavesGoogle }) {
  const r = Router();
  const quantosUsuarios = () => db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  const resposta = (usuario, lembrar = false) => ({ token: emitirToken(usuario, segredo, { lembrar }), usuario: usuarioPublico(usuario) });

  // A tela de login usa isto para saber se mostra "Criar administrador" e o botão do Google.
  r.get('/estado', (req, res) => {
    res.json({ precisa_criar_admin: quantosUsuarios() === 0, google_client_id: googleClientId || null });
  });

  // Primeiro acesso: só funciona enquanto NÃO existe nenhum usuário.
  r.post('/primeiro-acesso', asyncH(async (req, res) => {
    if (quantosUsuarios() > 0) throw new ErroHttp(403, 'O sistema já foi configurado.');
    const usuario = await criarUsuario(db, { ...req.body, perfil: 'admin' });
    res.status(201).json(resposta(usuario));
  }));

  r.post('/login', asyncH(async (req, res) => {
    const chave = `${req.ip}|${normalizarEmail(req.body.email)}`;
    verificarBloqueio(chave);
    try {
      const usuario = await autenticarUsuario(db, req.body);
      limparFalhas(chave);
      res.json(resposta(usuario, req.body.lembrar === true));
    } catch (e) {
      if (e.status === 401) registrarFalha(chave);
      throw e;
    }
  }));

  r.post('/google', asyncH(async (req, res) => {
    const usuario = await autenticarGoogle(db, req.body.token, { clientId: googleClientId, buscarChaves: buscarChavesGoogle });
    res.json(resposta(usuario, req.body.lembrar === true));
  }));

  // ---- exigem login ----
  const logado = middlewareAutenticacao(db, segredo);
  r.get('/eu', logado, (req, res) => res.json(req.usuario));

  r.post('/trocar-senha', logado, asyncH(async (req, res) => {
    const { senha_atual: atual, nova_senha: nova } = req.body;
    const confere = await autenticarUsuario(db, { email: req.usuario.email, senha: atual }).catch(() => null);
    if (!confere) throw new ErroHttp(401, 'A senha atual está incorreta.');
    validarSenha(nova, req.usuario.email);
    const atualizado = await trocarSenha(db, req.usuario.id, nova);
    res.json(resposta(atualizado)); // devolve um token novo (o antigo deixou de valer)
  }));

  return r;
}
