import { Router } from 'express';
import { exigirAdmin } from '../services/authService.js';
import { ErroHttp } from '../utils/erros.js';
import { dinheiro, idDaRota, inteiro, quantidade, texto } from '../utils/validacao.js';

// Valida o corpo de criação/edição de produto (mesmas regras nos dois casos).
function lerProduto(body) {
  const tamanho = texto(body.tamanho, 'tamanho', { obrigatorio: false, max: 30 });
  const permiteMeia = body.permite_meia === true || body.permite_meia === 1 ? 1 : 0;
  if (permiteMeia && !tamanho) throw new ErroHttp(400, 'Para permitir meia pizza, informe o "tamanho" do produto');
  return {
    nome: texto(body.nome, 'nome', { max: 120 }),
    categoria: texto(body.categoria, 'categoria', { max: 50 }),
    preco: dinheiro(body.preco, 'preco'),
    ativo: body.ativo === false || body.ativo === 0 ? 0 : 1,
    tamanho,
    permite_meia: permiteMeia,
    ncm: texto(body.ncm, 'ncm', { obrigatorio: false, max: 8 }),
    cfop: texto(body.cfop, 'cfop', { obrigatorio: false, max: 4 }),
    csosn: texto(body.csosn, 'csosn', { obrigatorio: false, max: 4 }),
  };
}

export function produtosRouter(db) {
  const r = Router();

  // GET /produtos?categoria=pizza&somente_ativos=true
  r.get('/', (req, res) => {
    const filtros = [];
    const params = [];
    if (req.query.categoria) { filtros.push('categoria = ?'); params.push(req.query.categoria); }
    if (req.query.somente_ativos === 'true') filtros.push('ativo = 1');
    const where = filtros.length ? `WHERE ${filtros.join(' AND ')}` : '';
    res.json(db.prepare(`SELECT * FROM produtos ${where} ORDER BY categoria, nome`).all(...params));
  });

  // ---- Assistente de meia pizza: acha pizzas ainda não configuradas e sugere o tamanho pelo nome ----
  const TAMANHOS = /\b(broto|pequena|m[eé]dia|grande|gigante|fam[ií]lia)\b/i;
  const sugerirTamanho = (nome) => {
    const m = String(nome).match(TAMANHOS);
    return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
  };

  r.get('/pizzas-nao-configuradas', (req, res) => {
    const linhas = db.prepare(
      "SELECT id, nome, categoria, tamanho FROM produtos WHERE ativo = 1 AND permite_meia = 0 AND lower(categoria) LIKE '%pizza%' ORDER BY nome").all();
    res.json(linhas.map((p) => ({ ...p, tamanho_sugerido: p.tamanho ?? sugerirTamanho(p.nome) })));
  });

  // POST /produtos/configurar-meia  { "itens": [{ "id": 3, "tamanho": "Grande" }, ...] }
  r.post('/configurar-meia', exigirAdmin, (req, res) => {
    if (!Array.isArray(req.body.itens) || !req.body.itens.length) throw new ErroHttp(400, 'Informe os produtos a configurar.');
    const itens = req.body.itens.map((i, n) => ({
      id: inteiro(i.id, `itens[${n}].id`, { min: 1 }),
      tamanho: texto(i.tamanho, `itens[${n}].tamanho`, { max: 30 }),
    }));
    db.transaction(() => {
      const atualizar = db.prepare('UPDATE produtos SET tamanho = ?, permite_meia = 1 WHERE id = ?');
      for (const i of itens) if (atualizar.run(i.tamanho, i.id).changes === 0) throw new ErroHttp(404, `Produto ${i.id} não encontrado`);
    })();
    res.json({ configurados: itens.length });
  });

  r.get('/:id', (req, res) => {
    const produto = db.prepare('SELECT * FROM produtos WHERE id = ?').get(idDaRota(req.params.id));
    if (!produto) throw new ErroHttp(404, 'Produto não encontrado');
    res.json(produto);
  });

  r.post('/', exigirAdmin, (req, res) => {
    const p = lerProduto(req.body);
    const info = db
      .prepare(
        `INSERT INTO produtos (nome, categoria, preco, ativo, tamanho, permite_meia, ncm, cfop, csosn)
         VALUES (@nome, @categoria, @preco, @ativo, @tamanho, @permite_meia, @ncm, @cfop, @csosn)`
      )
      .run(p);
    res.status(201).json({ id: Number(info.lastInsertRowid), ...p });
  });

  r.put('/:id', exigirAdmin, (req, res) => {
    const id = idDaRota(req.params.id);
    const p = lerProduto(req.body);
    const info = db
      .prepare(
        `UPDATE produtos SET nome=@nome, categoria=@categoria, preco=@preco, ativo=@ativo,
                tamanho=@tamanho, permite_meia=@permite_meia, ncm=@ncm, cfop=@cfop, csosn=@csosn
          WHERE id=@id`
      )
      .run({ ...p, id });
    if (info.changes === 0) throw new ErroHttp(404, 'Produto não encontrado');
    res.json({ id, ...p });
  });

  // Não apaga de verdade (pedidos antigos dependem do produto): só desativa.
  r.delete('/:id', exigirAdmin, (req, res) => {
    const info = db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ?').run(idDaRota(req.params.id));
    if (info.changes === 0) throw new ErroHttp(404, 'Produto não encontrado');
    res.status(204).end();
  });

  // ---- Ficha técnica (receita): quanto de cada insumo UM produto inteiro consome ----

  r.get('/:id/ficha-tecnica', (req, res) => {
    res.json(
      db.prepare(
        `SELECT f.insumo_id, i.nome AS insumo, i.unidade, f.quantidade
           FROM ficha_tecnica f JOIN insumos i ON i.id = f.insumo_id
          WHERE f.produto_id = ? ORDER BY i.nome`
      ).all(idDaRota(req.params.id))
    );
  });

  // PUT /produtos/1/ficha-tecnica  { "itens": [{ "insumo_id": 1, "quantidade": 0.35 }, ...] }
  // Substitui a ficha inteira (use "itens": [] para remover o controle de estoque do produto).
  r.put('/:id/ficha-tecnica', exigirAdmin, (req, res) => {
    const id = idDaRota(req.params.id);
    if (!db.prepare('SELECT id FROM produtos WHERE id = ?').get(id)) throw new ErroHttp(404, 'Produto não encontrado');
    if (!Array.isArray(req.body.itens)) throw new ErroHttp(400, 'Informe "itens" como lista');

    const vistos = new Set();
    const linhas = req.body.itens.map((item, i) => {
      const insumoId = inteiro(item.insumo_id, `itens[${i}].insumo_id`, { min: 1 });
      if (vistos.has(insumoId)) throw new ErroHttp(400, `Insumo ${insumoId} repetido na ficha`);
      vistos.add(insumoId);
      if (!db.prepare('SELECT id FROM insumos WHERE id = ?').get(insumoId)) {
        throw new ErroHttp(422, `Insumo ${insumoId} não existe`);
      }
      return { insumoId, quantidade: quantidade(item.quantidade, `itens[${i}].quantidade`) };
    });

    db.transaction(() => {
      db.prepare('DELETE FROM ficha_tecnica WHERE produto_id = ?').run(id);
      const inserir = db.prepare('INSERT INTO ficha_tecnica (produto_id, insumo_id, quantidade) VALUES (?, ?, ?)');
      for (const l of linhas) inserir.run(id, l.insumoId, l.quantidade);
    })();
    res.json({ produto_id: id, itens: linhas.length });
  });

  return r;
}
