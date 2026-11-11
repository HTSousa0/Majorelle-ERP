import { Router } from 'express';
import { exigirAdmin } from '../services/authService.js';
import { ErroHttp } from '../utils/erros.js';
import { texto } from '../utils/validacao.js';

// "Preferências" do atendimento: horários, taxa de entrega, mensagens do bot, nome da loja...
export function configuracoesRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const linhas = db.prepare('SELECT chave, valor FROM configuracoes ORDER BY chave').all();
    res.json(Object.fromEntries(linhas.map((l) => [l.chave, l.valor])));
  });

  r.put('/:chave', exigirAdmin, (req, res) => {
    const chave = req.params.chave;
    if (!/^[a-z_]{2,50}$/.test(chave)) throw new ErroHttp(400, 'Chave inválida (use letras minúsculas e _)');
    const valor = texto(String(req.body.valor ?? ''), 'valor', { max: 500, obrigatorio: false }) ?? '';
    db.prepare(
      'INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor'
    ).run(chave, valor);
    res.json({ chave, valor });
  });

  return r;
}
