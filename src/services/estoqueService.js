// Controle de estoque de insumos. Cada produto tem uma ficha técnica (receita);
// ao criar um pedido, os insumos são baixados; ao cancelar, são devolvidos.
// Meia pizza consome metade da receita de cada sabor.
import { ErroHttp } from '../utils/erros.js';

const arredondar = (n) => Math.round(n * 1000) / 1000;

// Quanto de cada insumo UM item do pedido consome. Retorna Map(insumo_id → quantidade).
function consumoDoItem(db, item) {
  const fator = item.produto_id_2 ? 0.5 : 1;
  const consumo = new Map();
  const ficha = db.prepare('SELECT insumo_id, quantidade FROM ficha_tecnica WHERE produto_id = ?');
  for (const produtoId of [item.produto_id, item.produto_id_2].filter(Boolean)) {
    for (const linha of ficha.all(produtoId)) {
      consumo.set(
        linha.insumo_id,
        arredondar((consumo.get(linha.insumo_id) ?? 0) + linha.quantidade * fator * item.quantidade)
      );
    }
  }
  return consumo;
}

// Deve ser chamada DENTRO da transação que grava o pedido: se faltar estoque (e o bloqueio estiver
// ligado), lança erro e o pedido inteiro é desfeito. Retorna alertas de estoque baixo.
export function baixarEstoque(db, pedidoId, itens, { bloquear }) {
  const total = new Map();
  for (const item of itens) {
    for (const [insumoId, q] of consumoDoItem(db, item)) {
      total.set(insumoId, arredondar((total.get(insumoId) ?? 0) + q));
    }
  }

  const buscar = db.prepare('SELECT id, nome, unidade, estoque_atual, estoque_minimo FROM insumos WHERE id = ?');

  if (bloquear) {
    const faltas = [];
    for (const [insumoId, q] of total) {
      const ins = buscar.get(insumoId);
      if (ins.estoque_atual < q) {
        faltas.push({ insumo: ins.nome, necessario: q, disponivel: ins.estoque_atual, unidade: ins.unidade });
      }
    }
    if (faltas.length) throw new ErroHttp(422, 'Estoque insuficiente para este pedido', { faltas });
  }

  const atualizar = db.prepare('UPDATE insumos SET estoque_atual = ROUND(estoque_atual + ?, 3) WHERE id = ?');
  const registrar = db.prepare(
    "INSERT INTO movimentacoes_estoque (insumo_id, pedido_id, tipo, quantidade) VALUES (?, ?, 'saida_pedido', ?)"
  );
  const alertas = [];
  for (const [insumoId, q] of total) {
    atualizar.run(-q, insumoId);
    registrar.run(insumoId, pedidoId, -q);
    const ins = buscar.get(insumoId);
    if (ins.estoque_atual <= ins.estoque_minimo) {
      alertas.push({
        insumo: ins.nome, unidade: ins.unidade,
        estoque_atual: ins.estoque_atual, estoque_minimo: ins.estoque_minimo,
      });
    }
  }
  return alertas;
}

// Devolve ao estoque o que o pedido consumiu (usado no cancelamento).
export function estornarEstoque(db, pedidoId) {
  const saldos = db
    .prepare('SELECT insumo_id, SUM(quantidade) AS saldo FROM movimentacoes_estoque WHERE pedido_id = ? GROUP BY insumo_id')
    .all(pedidoId);
  const atualizar = db.prepare('UPDATE insumos SET estoque_atual = ROUND(estoque_atual + ?, 3) WHERE id = ?');
  const registrar = db.prepare(
    "INSERT INTO movimentacoes_estoque (insumo_id, pedido_id, tipo, quantidade) VALUES (?, ?, 'estorno_pedido', ?)"
  );
  for (const { insumo_id, saldo } of saldos) {
    if (saldo < 0) {
      atualizar.run(-saldo, insumo_id);
      registrar.run(insumo_id, pedidoId, -saldo);
    }
  }
}
