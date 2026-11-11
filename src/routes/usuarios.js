// Gerenciamento de usuários (somente administradores).
import { Router } from 'express';
import { criarUsuario, trocarSenha, usuarioPublico } from '../services/authService.js';
import { asyncH, ErroHttp } from '../utils/erros.js';
import { idDaRota, opcao, texto } from '../utils/validacao.js';

export function usuariosRouter(db) {
  const r = Router();
  const buscar = (id) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!u) throw new ErroHttp(404, 'Usuário não encontrado');
    return u;
  };
  const listaPublica = (u) => ({ ...usuarioPublico(u), ativo: Boolean(u.ativo), criado_em: u.criado_em, ultimo_login: u.ultimo_login });
  const outrosAdminsAtivos = (id) => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE perfil = 'admin' AND ativo = 1 AND id != ?").get(id).n;

  r.get('/', (req, res) => {
    res.json(db.prepare('SELECT * FROM usuarios ORDER BY nome').all().map(listaPublica));
  });

  r.post('/', asyncH(async (req, res) => {
    const novo = await criarUsuario(db, req.body);
    res.status(201).json(listaPublica(novo));
  }));

  r.put('/:id', (req, res) => {
    const id = idDaRota(req.params.id);
    const u = buscar(id);
    const nome = texto(req.body.nome, 'nome', { max: 120 });
    const perfil = opcao(req.body.perfil, 'perfil', ['admin', 'atendente']);
    const ativo = req.body.ativo === false || req.body.ativo === 0 ? 0 : 1;

    if (id === req.usuario.id && !ativo) throw new ErroHttp(400, 'Você não pode desativar a sua própria conta.');
    const deixaDeSerAdminAtivo = u.perfil === 'admin' && u.ativo && (perfil !== 'admin' || !ativo);
    if (deixaDeSerAdminAtivo && outrosAdminsAtivos(id) === 0) {
      throw new ErroHttp(409, 'Precisa existir pelo menos um administrador ativo.');
    }
    // Mudou o perfil ou desativou: derruba os logins antigos desse usuário
    const derrubar = perfil !== u.perfil || !ativo ? 1 : 0;
    db.prepare('UPDATE usuarios SET nome = ?, perfil = ?, ativo = ?, token_versao = token_versao + ? WHERE id = ?')
      .run(nome, perfil, ativo, derrubar, id);
    res.json(listaPublica(buscar(id)));
  });

  r.post('/:id/redefinir-senha', asyncH(async (req, res) => {
    const id = idDaRota(req.params.id);
    buscar(id);
    await trocarSenha(db, id, req.body.nova_senha);
    res.json({ ok: true });
  }));

  return r;
}
