// Login por e-mail e senha (e, opcionalmente, Google). Sessão = token JWT assinado.
//  - Senhas: bcrypt (a senha nunca é guardada).
//  - Segredo do token: gerado sozinho na primeira execução e guardado em data/jwt.key (nunca no código).
//  - Cada token guarda a "versão" do usuário: trocar a senha ou desativar a conta derruba os logins antigos.
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { pastaDados } from '../utils/caminhos.js';
import { ErroHttp } from '../utils/erros.js';

const CUSTO = Number(process.env.BCRYPT_CUSTO) || 12;
const HASH_FALSO = bcrypt.hashSync('senha-que-ninguem-usa', CUSTO); // para gastar o mesmo tempo quando o e-mail não existe
const SENHAS_FRACAS = new Set(['12345678', '123456789', '1234567890', '12341234', '11111111', 'password', 'senha123', 'qwertyui', 'abcd1234', 'majorelle']);

export function obterSegredoJwt() {
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32) return process.env.JWT_SECRET;
  const arquivo = path.join(pastaDados(), 'jwt.key');
  try { return fs.readFileSync(arquivo, 'utf8').trim(); } catch { /* ainda não existe: cria abaixo */ }
  fs.mkdirSync(pastaDados(), { recursive: true });
  const segredo = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(arquivo, segredo, { mode: 0o600 });
  return segredo;
}

// ---------- Validações ----------
export const normalizarEmail = (e) => String(e ?? '').trim().toLowerCase();

export function validarEmail(valor) {
  const email = normalizarEmail(valor);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErroHttp(400, 'E-mail inválido.');
  return email;
}

export function validarSenha(senha, email = '') {
  if (typeof senha !== 'string' || senha.length < 8) throw new ErroHttp(400, 'A senha precisa ter pelo menos 8 caracteres.');
  if (senha.length > 72) throw new ErroHttp(400, 'A senha pode ter no máximo 72 caracteres.');
  if (SENHAS_FRACAS.has(senha.toLowerCase()) || (email && senha.toLowerCase() === email.toLowerCase())) {
    throw new ErroHttp(400, 'Escolha uma senha menos óbvia.');
  }
}

const publico = (u) => ({ id: u.id, nome: u.nome, email: u.email, perfil: u.perfil });

// ---------- Limite de tentativas (contra adivinhação de senha) ----------
const falhas = new Map(); // "ip|email" -> { total, bloqueadoAte, desde }
export function verificarBloqueio(chave) {
  const f = falhas.get(chave);
  if (f?.bloqueadoAte > Date.now()) {
    const seg = Math.ceil((f.bloqueadoAte - Date.now()) / 1000);
    throw new ErroHttp(429, `Muitas tentativas. Aguarde ${seg} segundos e tente de novo.`);
  }
}
export function registrarFalha(chave) {
  const agora = Date.now();
  let f = falhas.get(chave);
  if (!f || agora - f.desde > 15 * 60 * 1000 || (f.bloqueadoAte && f.bloqueadoAte <= agora)) f = { total: 0, desde: agora };
  f.total += 1;
  if (f.total >= 5) f.bloqueadoAte = agora + 60 * 1000;
  falhas.set(chave, f);
  if (falhas.size > 1000) for (const [k, v] of falhas) if (agora - v.desde > 15 * 60 * 1000) falhas.delete(k);
}
export const limparFalhas = (chave) => falhas.delete(chave);

// ---------- Usuários ----------
export async function criarUsuario(db, { nome, email, senha, perfil = 'atendente' }) {
  const nomeLimpo = String(nome ?? '').trim();
  if (!nomeLimpo || nomeLimpo.length > 120) throw new ErroHttp(400, 'Informe o nome (até 120 caracteres).');
  const emailOk = validarEmail(email);
  validarSenha(senha, emailOk);
  if (!['admin', 'atendente'].includes(perfil)) throw new ErroHttp(400, 'Perfil inválido.');
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(emailOk)) throw new ErroHttp(409, 'Já existe um usuário com este e-mail.');
  const hash = await bcrypt.hash(senha, CUSTO);
  const info = db.prepare('INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES (?, ?, ?, ?)').run(nomeLimpo, emailOk, hash, perfil);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(info.lastInsertRowid));
}

export async function trocarSenha(db, usuarioId, novaSenha) {
  const u = db.prepare('SELECT email FROM usuarios WHERE id = ?').get(usuarioId);
  validarSenha(novaSenha, u?.email);
  const hash = await bcrypt.hash(novaSenha, CUSTO);
  // token_versao + 1: todos os logins antigos deixam de valer
  db.prepare('UPDATE usuarios SET senha_hash = ?, token_versao = token_versao + 1 WHERE id = ?').run(hash, usuarioId);
  return db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
}

export async function autenticarUsuario(db, { email, senha }) {
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(normalizarEmail(email));
  const confere = await bcrypt.compare(String(senha ?? ''), user?.senha_hash ?? HASH_FALSO);
  if (!user || !confere || !user.ativo) throw new ErroHttp(401, 'E-mail ou senha inválidos.');
  db.prepare("UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?").run(user.id);
  return user;
}

// ---------- Google (opcional) ----------
let cacheChaves = { em: 0, lista: [] };
async function buscarChavesGoogle() {
  if (Date.now() - cacheChaves.em < 60 * 60 * 1000 && cacheChaves.lista.length) return cacheChaves.lista;
  const resposta = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!resposta.ok) throw new ErroHttp(502, 'Não consegui falar com o Google agora.');
  cacheChaves = { em: Date.now(), lista: (await resposta.json()).keys ?? [] };
  return cacheChaves.lista;
}

// Só entra quem JÁ foi cadastrado por um administrador (nunca cria usuário sozinho).
export async function autenticarGoogle(db, idToken, { clientId, buscarChaves = buscarChavesGoogle }) {
  if (!clientId) throw new ErroHttp(400, 'Login com Google não está configurado.');
  const decodificado = jwt.decode(String(idToken ?? ''), { complete: true });
  if (!decodificado?.header?.kid) throw new ErroHttp(401, 'Token do Google inválido.');
  const jwk = (await buscarChaves()).find((k) => k.kid === decodificado.header.kid);
  if (!jwk) throw new ErroHttp(401, 'Token do Google inválido.');

  let dados;
  try {
    dados = jwt.verify(idToken, crypto.createPublicKey({ key: jwk, format: 'jwk' }), {
      algorithms: ['RS256'], audience: clientId, issuer: ['https://accounts.google.com', 'accounts.google.com'],
    });
  } catch { throw new ErroHttp(401, 'Token do Google inválido ou expirado.'); }

  if (!dados.email || dados.email_verified !== true) throw new ErroHttp(401, 'O e-mail da conta Google não está verificado.');
  const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(normalizarEmail(dados.email));
  if (!user || !user.ativo) throw new ErroHttp(403, 'Este e-mail não está autorizado. Peça a um administrador para cadastrá-lo.');
  db.prepare("UPDATE usuarios SET ultimo_login = datetime('now') WHERE id = ?").run(user.id);
  return user;
}

// ---------- Token e proteção das rotas ----------
export function emitirToken(usuario, segredo, { lembrar = false } = {}) {
  return jwt.sign({ sub: String(usuario.id), v: usuario.token_versao }, segredo, { algorithm: 'HS256', expiresIn: lembrar ? '30d' : '12h' });
}

export function middlewareAutenticacao(db, segredo) {
  return (req, res, next) => {
    const [tipo, token] = String(req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token) return res.status(401).json({ erro: 'Faça login para continuar.' });
    try {
      const dados = jwt.verify(token, segredo, { algorithms: ['HS256'] });
      const u = db.prepare('SELECT id, nome, email, perfil, ativo, token_versao FROM usuarios WHERE id = ?').get(Number(dados.sub));
      if (!u || !u.ativo || u.token_versao !== dados.v) throw new Error('sessão revogada');
      req.usuario = publico(u);
      next();
    } catch {
      res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
    }
  };
}

export function exigirAdmin(req, res, next) {
  if (req.usuario?.perfil !== 'admin') return res.status(403).json({ erro: 'Apenas administradores podem fazer isso.' });
  next();
}

export { publico as usuarioPublico };
