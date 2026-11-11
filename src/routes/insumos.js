// Estoque de insumos (ingredientes e itens estocáveis) e histórico de movimentações.
import { Router } from 'express';
import { exigirAdmin } from '../services/authService.js';
import { ErroHttp } from '../utils/erros.js';
import { idDaRota, opcao, quantidade, texto } from '../utils/validacao.js';

const UNIDADES = ['un', 'kg', 'g', 'l', 'ml'];

export function insumosRouter(db) {
  const r = Router();

  const buscar = (id) => {
    const insumo = db.prepare('SELECT * FROM insumos WHERE id = ?').get(id);
    if (!insumo) throw new ErroHttp(404, 'Insumo não encontrado');
    return insumo;
  };

  // GET /insumos?abaixo_minimo=true  → lista o que precisa ser reposto
  r.get('/', (req, res) => {
    const where = req.query.abaixo_minimo === 'true' ? 'WHERE estoque_atual <= estoque_minimo' : '';
    res.json(db.prepare(`SELECT * FROM insumos ${where} ORDER BY nome`).all());
  });

  r.get('/:id', (req, res) => res.json(buscar(idDaRota(req.params.id))));

  r.post('/', exigirAdmin, (req, res) => {
    const nome = texto(req.body.nome, 'nome', { max: 120 });
    const unidade = opcao(req.body.unidade, 'unidade', UNIDADES);
    const minimo = req.body.estoque_minimo === undefined ? 0 : quantidade(req.body.estoque_minimo, 'estoque_minimo', { zero: true });
    const inicial = req.body.estoque_atual === undefined ? 0 : quantidade(req.body.estoque_atual, 'estoque_atual', { zero: true });

    const id = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO insumos (nome, unidade, estoque_atual, estoque_minimo) VALUES (?, ?, ?, ?)')
        .run(nome, unidade, inicial, minimo);
      const novoId = Number(info.lastInsertRowid);
      if (inicial > 0) {
        db.prepare("INSERT INTO movimentacoes_estoque (insumo_id, tipo, quantidade) VALUES (?, 'entrada', ?)")
          .run(novoId, inicial);
      }
      return novoId;
    })();
    res.status(201).json(buscar(id));
  });

  r.put('/:id', exigirAdmin, (req, res) => {
    const id = idDaRota(req.params.id);
    buscar(id);
    db.prepare('UPDATE insumos SET nome = ?, unidade = ?, estoque_minimo = ? WHERE id = ?').run(
      texto(req.body.nome, 'nome', { max: 120 }),
      opcao(req.body.unidade, 'unidade', UNIDADES),
      quantidade(req.body.estoque_minimo ?? 0, 'estoque_minimo', { zero: true }),
      id
    );
    res.json(buscar(id));
  });

  // POST /insumos/1/movimentacoes  { "tipo": "entrada" | "perda" | "ajuste", "quantidade": 5 }
  //  - entrada: chegou mercadoria (soma)   - perda: estragou/quebrou (subtrai)
  //  - ajuste: correção de contagem; aceita número negativo
  r.post('/:id/movimentacoes', (req, res) => {
    const id = idDaRota(req.params.id);
    buscar(id);
    const tipo = opcao(req.body.tipo, 'tipo', ['entrada', 'perda', 'ajuste']);
    const q = quantidade(req.body.quantidade, 'quantidade', { negativo: tipo === 'ajuste' });
    const delta = tipo === 'perda' ? -q : q;

    db.transaction(() => {
      db.prepare('UPDATE insumos SET estoque_atual = ROUND(estoque_atual + ?, 3) WHERE id = ?').run(delta, id);
      db.prepare('INSERT INTO movimentacoes_estoque (insumo_id, tipo, quantidade) VALUES (?, ?, ?)').run(id, tipo, delta);
    })();
    res.status(201).json(buscar(id));
  });

  r.get('/:id/movimentacoes', (req, res) => {
    const id = idDaRota(req.params.id);
    buscar(id);
    res.json(
      db.prepare('SELECT * FROM movimentacoes_estoque WHERE insumo_id = ? ORDER BY id DESC LIMIT 100').all(id)
    );
  });

  return r;
}
