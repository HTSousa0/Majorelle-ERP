// Regras de negócio dos pedidos. O servidor SEMPRE calcula preços a partir do banco,
// nunca confia em valores enviados pelo cliente (ou pela IA do WhatsApp).
//
// Dinheiro: o banco guarda DECIMAL(10,2) (reais), mas o SQLite armazena isso como número de
// ponto flutuante. Por isso TODA conta aqui é feita em centavos (inteiros) e só convertida
// para reais na hora de gravar.
import { lerConfig } from '../db/index.js';
import { baixarEstoque, estornarEstoque } from './estoqueService.js';
import { ErroHttp } from '../utils/erros.js';
import { inteiro, opcao, texto } from '../utils/validacao.js';

export const TIPOS = ['entrega', 'retirada'];
export const PAGAMENTOS = ['dinheiro', 'pix', 'cartao_credito', 'cartao_debito'];
export const STATUS = ['recebido', 'em_preparo', 'saiu_entrega', 'entregue', 'cancelado'];

// Texto único usado na tela, na comanda e (depois) no WhatsApp: "½ Calabresa + ½ Mussarela" para meia pizza.
export const descricaoItem = (nome1, nome2) => (nome2 ? `½ ${nome1} + ½ ${nome2}` : nome1);

const emCentavos = (reais) => Math.round(Number(reais) * 100);

// Máquina de estados: de qual status para quais é permitido ir.
const TRANSICOES = {
  recebido: ['em_preparo', 'cancelado'],
  em_preparo: ['saiu_entrega', 'entregue', 'cancelado'],
  saiu_entrega: ['entregue', 'cancelado'],
  entregue: [],
  cancelado: [],
};

export function buscarPedido(db, id) {
  const pedido = db
    .prepare(
      `SELECT p.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone
         FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
        WHERE p.id = ?`
    )
    .get(id);
  if (!pedido) throw new ErroHttp(404, 'Pedido não encontrado');

  pedido.endereco = pedido.endereco_id
    ? db.prepare('SELECT * FROM enderecos WHERE id = ?').get(pedido.endereco_id)
    : null;
  pedido.itens = db
    .prepare(
      `SELECT i.*, pr.nome AS produto_nome, pr2.nome AS produto_2_nome
         FROM itens_pedido i
         JOIN produtos pr ON pr.id = i.produto_id
         LEFT JOIN produtos pr2 ON pr2.id = i.produto_id_2
        WHERE i.pedido_id = ? ORDER BY i.id`
    )
    .all(id)
    .map((i) => ({ ...i, meia: Boolean(i.produto_id_2), descricao: descricaoItem(i.produto_nome, i.produto_2_nome) }));
  pedido.notas_fiscais = db.prepare('SELECT * FROM notas_fiscais WHERE pedido_id = ?').all(id);
  return pedido;
}

export function listarPedidos(db, { status } = {}) {
  if (status) opcao(status, 'status', STATUS);
  const sql = `SELECT p.id, p.status, p.tipo, p.total, p.criado_em, c.nome AS cliente_nome
                 FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
                ${status ? 'WHERE p.status = ?' : ''}
                ORDER BY p.id DESC LIMIT 200`;
  const pedidos = status ? db.prepare(sql).all(status) : db.prepare(sql).all();
  if (!pedidos.length) return pedidos;

  // Resumo dos itens de cada pedido (para o quadro mostrar o que é, inclusive as meias pizzas)
  const ids = pedidos.map((p) => p.id);
  const itens = db
    .prepare(
      `SELECT i.pedido_id, i.quantidade, pr.nome AS n1, pr2.nome AS n2
         FROM itens_pedido i
         JOIN produtos pr ON pr.id = i.produto_id
         LEFT JOIN produtos pr2 ON pr2.id = i.produto_id_2
        WHERE i.pedido_id IN (${ids.map(() => '?').join(',')}) ORDER BY i.id`
    )
    .all(...ids);
  const porPedido = new Map(ids.map((id) => [id, []]));
  for (const i of itens) porPedido.get(i.pedido_id).push({ quantidade: i.quantidade, descricao: descricaoItem(i.n1, i.n2), meia: Boolean(i.n2) });
  return pedidos.map((p) => ({ ...p, itens_resumo: porPedido.get(p.id), tem_meia: porPedido.get(p.id).some((i) => i.meia) }));
}

export function criarPedido(db, dados) {
  const tipo = opcao(dados.tipo, 'tipo', TIPOS);
  const pagamento = opcao(dados.forma_pagamento, 'forma_pagamento', PAGAMENTOS);
  const clienteId = inteiro(dados.cliente_id, 'cliente_id', { min: 1 });

  const cliente = db.prepare('SELECT id FROM clientes WHERE id = ?').get(clienteId);
  if (!cliente) throw new ErroHttp(404, 'Cliente não encontrado');

  // Entrega exige um endereço que pertença ao cliente.
  let enderecoId = null;
  if (tipo === 'entrega') {
    enderecoId = inteiro(dados.endereco_id, 'endereco_id', { min: 1 });
    const end = db
      .prepare('SELECT id FROM enderecos WHERE id = ? AND cliente_id = ?')
      .get(enderecoId, clienteId);
    if (!end) throw new ErroHttp(422, 'Endereço não encontrado para este cliente');
  }

  if (!Array.isArray(dados.itens) || dados.itens.length === 0) {
    throw new ErroHttp(400, 'O pedido precisa ter ao menos um item');
  }

  const buscarProduto = db.prepare('SELECT id, nome, preco, ativo, tamanho, permite_meia FROM produtos WHERE id = ?');
  const regraMeia = lerConfig(db, 'regra_preco_meia', 'maior');

  const lerProduto = (id, campo) => {
    const produto = buscarProduto.get(id);
    if (!produto) throw new ErroHttp(422, `Produto ${id} não existe (${campo})`);
    if (!produto.ativo) throw new ErroHttp(422, `Produto "${produto.nome}" está indisponível`);
    return produto;
  };

  const itens = dados.itens.map((item, i) => {
    const produto = lerProduto(inteiro(item.produto_id, `itens[${i}].produto_id`, { min: 1 }), `itens[${i}]`);
    const quantidade = inteiro(item.quantidade, `itens[${i}].quantidade`, { min: 1, max: 50 });

    // Meia pizza: segundo sabor opcional (mesmo tamanho, ambos autorizados para meia).
    let produto2 = null;
    if (item.produto_id_2 !== undefined && item.produto_id_2 !== null) {
      produto2 = lerProduto(inteiro(item.produto_id_2, `itens[${i}].produto_id_2`, { min: 1 }), `itens[${i}]`);
      if (produto2.id === produto.id) throw new ErroHttp(422, 'Os dois sabores da meia pizza devem ser diferentes');
      if (!produto.permite_meia || !produto2.permite_meia) {
        throw new ErroHttp(422, 'Um dos produtos não permite meia pizza');
      }
      if (!produto.tamanho || produto.tamanho !== produto2.tamanho) {
        throw new ErroHttp(422, 'Os dois sabores da meia pizza precisam ser do mesmo tamanho');
      }
    }

    const c1 = emCentavos(produto.preco); // preço vem do banco (em reais), nunca do pedido
    let centavos = c1;
    if (produto2) {
      const c2 = emCentavos(produto2.preco);
      centavos = regraMeia === 'media' ? Math.round((c1 + c2) / 2) : Math.max(c1, c2);
    }
    return {
      produto_id: produto.id,
      produto_id_2: produto2?.id ?? null,
      quantidade,
      centavos,
      observacao: texto(item.observacao, `itens[${i}].observacao`, { obrigatorio: false, max: 200 }),
    };
  });

  const taxa = tipo === 'entrega' ? emCentavos(lerConfig(db, 'taxa_entrega', '0')) : 0;
  const subtotal = itens.reduce((soma, it) => soma + it.centavos * it.quantidade, 0);

  // Transação: ou grava o pedido inteiro (cabeçalho + itens + baixa de estoque) ou não grava nada.
  const bloquear = lerConfig(db, 'bloquear_sem_estoque', 'false') === 'true';
  const gravar = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO pedidos (cliente_id, endereco_id, tipo, status, forma_pagamento, taxa_entrega, total)
         VALUES (?, ?, ?, 'recebido', ?, ?, ?)`
      )
      .run(clienteId, enderecoId, tipo, pagamento, taxa / 100, (subtotal + taxa) / 100);
    const pedidoId = Number(info.lastInsertRowid);
    const inserirItem = db.prepare(
      `INSERT INTO itens_pedido (pedido_id, produto_id, produto_id_2, quantidade, preco_unitario, observacao)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const it of itens) {
      inserirItem.run(pedidoId, it.produto_id, it.produto_id_2, it.quantidade, it.centavos / 100, it.observacao);
    }
    const alertas = baixarEstoque(db, pedidoId, itens, { bloquear });
    return { pedidoId, alertas };
  });

  const { pedidoId, alertas } = gravar();
  return { ...buscarPedido(db, pedidoId), alertas_estoque: alertas };
}

export function mudarStatus(db, id, novoStatus) {
  const novo = opcao(novoStatus, 'status', STATUS);
  const pedido = buscarPedido(db, id);

  if (!TRANSICOES[pedido.status].includes(novo)) {
    throw new ErroHttp(422, `Não é possível ir de "${pedido.status}" para "${novo}"`, {
      permitidos: TRANSICOES[pedido.status],
    });
  }
  if (novo === 'saiu_entrega' && pedido.tipo !== 'entrega') {
    throw new ErroHttp(422, 'Pedido de retirada não pode "sair para entrega"');
  }
  if (novo === 'entregue' && pedido.status === 'em_preparo' && pedido.tipo === 'entrega') {
    throw new ErroHttp(422, 'Pedido de entrega precisa passar por "saiu_entrega"');
  }

  db.transaction(() => {
    db.prepare('UPDATE pedidos SET status = ? WHERE id = ?').run(novo, id);
    if (novo === 'cancelado') estornarEstoque(db, id); // devolve os insumos ao estoque
  })();
  return buscarPedido(db, id);
}
