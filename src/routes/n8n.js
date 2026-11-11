// Rota que o n8n chama para CRIAR pedidos vindos do WhatsApp (WhatsApp → Evolution API → n8n → IA → ESTA ROTA).
// Protegida por chave de API no header "x-api-key" (variável API_KEY do .env). O cardápio (leitura) é público: /cardapio.
// Aceita o formato antigo do webhook (cliente_telefone, cliente_nome, qtd) e o novo; o TOTAL é sempre calculado aqui.
import { Router } from 'express';
import { imprimirPedido } from '../services/impressaoService.js';
import { criarPedido, PAGAMENTOS, TIPOS } from '../services/pedidoService.js';
import { asyncH, ErroHttp } from '../utils/erros.js';
import { inteiro, opcao, telefone, texto } from '../utils/validacao.js';

export function n8nRouter(db, { impressora, apiKey }) {
  const r = Router();

  r.use((req, res, next) => {
    if (!apiKey) return next(new ErroHttp(503, 'API_KEY não configurada no servidor'));
    if (req.get('x-api-key') !== apiKey) return next(new ErroHttp(401, 'Chave de API inválida'));
    next();
  });

  // Itens podem vir por produto_id ou por nome exato. Meia pizza: produto_id_2 (ou nome_2) com o segundo sabor.
  r.post(['/pedido', '/webhook/pedido'], asyncH(async (req, res) => {
    const b = req.body;
    const tel = telefone(b.telefone ?? b.cliente_telefone);
    const nome = texto(b.nome ?? b.cliente_nome, 'nome', { obrigatorio: false, max: 120 }) ?? 'Cliente WhatsApp';
    const tipo = opcao(b.tipo, 'tipo', TIPOS);
    const pagamento = opcao(b.forma_pagamento, 'forma_pagamento', PAGAMENTOS);
    if (!Array.isArray(b.itens) || b.itens.length === 0) throw new ErroHttp(400, 'Informe ao menos um item');

    // 1) Resolve os itens ANTES de criar qualquer coisa; se a IA citou algo que não existe, avisa.
    const naoReconhecidos = [];
    const itens = [];
    const achar = (id, nomeProduto) =>
      id
        ? db.prepare('SELECT id FROM produtos WHERE id = ? AND ativo = 1').get(id)
        : db.prepare('SELECT id FROM produtos WHERE lower(nome) = lower(?) AND ativo = 1').get(String(nomeProduto ?? ''));

    for (const [i, item] of b.itens.entries()) {
      const produto = achar(item.produto_id, item.nome);
      if (!produto) { naoReconhecidos.push(item.nome ?? item.produto_id ?? `item ${i}`); continue; }
      let produto2 = null;
      if (item.produto_id_2 || item.nome_2) {
        produto2 = achar(item.produto_id_2, item.nome_2);
        if (!produto2) { naoReconhecidos.push(item.nome_2 ?? item.produto_id_2); continue; }
      }
      itens.push({
        produto_id: produto.id,
        produto_id_2: produto2?.id,
        quantidade: inteiro(item.quantidade ?? item.qtd, `itens[${i}].quantidade`, { min: 1, max: 50 }),
        observacao: item.observacao,
      });
    }
    if (naoReconhecidos.length) {
      throw new ErroHttp(422, 'Alguns itens não foram encontrados no cardápio', { nao_reconhecidos: naoReconhecidos });
    }

    // 2) Acha ou cria o cliente pelo telefone (não sobrescreve o nome de quem já está cadastrado).
    let cliente = db.prepare('SELECT id FROM clientes WHERE telefone = ?').get(tel);
    if (!cliente) {
      const info = db.prepare('INSERT INTO clientes (nome, telefone) VALUES (?, ?)').run(nome, tel);
      cliente = { id: Number(info.lastInsertRowid) };
    }

    // 3) Endereço (só para entrega): reaproveita se já existir igual.
    let enderecoId = null;
    if (tipo === 'entrega') {
      const e = b.endereco ?? {};
      const rua = texto(e.rua, 'endereco.rua');
      const numero = texto(e.numero, 'endereco.numero', { max: 20 });
      const existente = db
        .prepare('SELECT id FROM enderecos WHERE cliente_id = ? AND lower(rua) = lower(?) AND numero = ?')
        .get(cliente.id, rua, numero);
      enderecoId = existente
        ? existente.id
        : Number(
            db.prepare('INSERT INTO enderecos (cliente_id, rua, numero, bairro, complemento) VALUES (?, ?, ?, ?, ?)')
              .run(cliente.id, rua, numero, texto(e.bairro, 'endereco.bairro'),
                   texto(e.complemento, 'endereco.complemento', { obrigatorio: false })).lastInsertRowid
          );
    }

    const pedido = criarPedido(db, { cliente_id: cliente.id, endereco_id: enderecoId, tipo, forma_pagamento: pagamento, itens });

    // 4) Imprime a comanda na cozinha. Se a impressora falhar, o pedido continua salvo.
    let impressao = 'ok';
    try {
      await imprimirPedido(db, impressora, pedido, 'comanda');
    } catch (err) {
      console.error('Falha ao imprimir:', err.message);
      impressao = 'falhou';
    }
    res.status(201).json({ pedido, impressao });
  }));

  return r;
}
