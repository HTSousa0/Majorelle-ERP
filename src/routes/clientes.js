import { Router } from 'express';
import { ErroHttp } from '../utils/erros.js';
import { idDaRota, telefone, texto } from '../utils/validacao.js';

const lerEmail = (valor) => {
  const email = texto(valor, 'email', { obrigatorio: false, max: 254 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ErroHttp(400, 'E-mail inválido.');
  return email ? email.toLowerCase() : null;
};

export function clientesRouter(db) {
  const r = Router();

  // Busca por nome ou telefone: GET /clientes?busca=maria
  r.get('/', (req, res) => {
    const termo = `%${req.query.busca ?? ''}%`;
    res.json(
      db.prepare('SELECT * FROM clientes WHERE nome LIKE ? OR telefone LIKE ? ORDER BY nome LIMIT 100').all(termo, termo)
    );
  });

  r.get('/:id', (req, res) => {
    const id = idDaRota(req.params.id);
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(id);
    if (!cliente) throw new ErroHttp(404, 'Cliente não encontrado');
    cliente.enderecos = db.prepare('SELECT * FROM enderecos WHERE cliente_id = ?').all(id);
    res.json(cliente);
  });

  r.post('/', (req, res) => {
    const nome = texto(req.body.nome, 'nome', { max: 120 });
    const tel = telefone(req.body.telefone);
    const email = lerEmail(req.body.email);
    const info = db.prepare('INSERT INTO clientes (nome, telefone, email) VALUES (?, ?, ?)').run(nome, tel, email);
    res.status(201).json({ id: Number(info.lastInsertRowid), nome, telefone: tel, email });
  });

  r.put('/:id', (req, res) => {
    const id = idDaRota(req.params.id);
    const nome = texto(req.body.nome, 'nome', { max: 120 });
    const tel = telefone(req.body.telefone);
    const email = lerEmail(req.body.email);
    const info = db.prepare('UPDATE clientes SET nome = ?, telefone = ?, email = ? WHERE id = ?').run(nome, tel, email, id);
    if (info.changes === 0) throw new ErroHttp(404, 'Cliente não encontrado');
    res.json({ id, nome, telefone: tel, email });
  });

  r.post('/:id/enderecos', (req, res) => {
    const clienteId = idDaRota(req.params.id);
    if (!db.prepare('SELECT id FROM clientes WHERE id = ?').get(clienteId)) {
      throw new ErroHttp(404, 'Cliente não encontrado');
    }
    const e = {
      rua: texto(req.body.rua, 'rua'),
      numero: texto(req.body.numero, 'numero', { max: 20 }),
      bairro: texto(req.body.bairro, 'bairro'),
      complemento: texto(req.body.complemento, 'complemento', { obrigatorio: false }),
      cep: texto(req.body.cep, 'cep', { obrigatorio: false, max: 9 }),
    };
    const info = db
      .prepare('INSERT INTO enderecos (cliente_id, rua, numero, bairro, complemento, cep) VALUES (?, ?, ?, ?, ?, ?)')
      .run(clienteId, e.rua, e.numero, e.bairro, e.complemento, e.cep);
    res.status(201).json({ id: Number(info.lastInsertRowid), cliente_id: clienteId, ...e });
  });

  return r;
}
