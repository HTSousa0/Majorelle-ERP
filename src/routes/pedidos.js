import { Router } from 'express';
import { lerConfig } from '../db/index.js';
import { imprimirPedido, montarComanda, montarComprovante, previaTexto } from '../services/impressaoService.js';
import { buscarPedido, criarPedido, listarPedidos, mudarStatus } from '../services/pedidoService.js';
import { asyncH } from '../utils/erros.js';
import { idDaRota, opcao } from '../utils/validacao.js';

export function pedidosRouter(db, { impressora, fiscal }) {
  const r = Router();

  r.get('/', (req, res) => res.json(listarPedidos(db, { status: req.query.status })));

  r.get('/:id', (req, res) => res.json(buscarPedido(db, idDaRota(req.params.id))));

  r.post('/', (req, res) => res.status(201).json(criarPedido(db, req.body)));

  // GET /pedidos/5/cupom?via=comanda|comprovante → texto do cupom (pré-visualização, não imprime)
  r.get('/:id/cupom', (req, res) => {
    const pedido = buscarPedido(db, idDaRota(req.params.id));
    const via = opcao(req.query.via, 'via', ['comanda', 'comprovante'], 'comanda');
    const linhas = via === 'comanda' ? montarComanda(pedido) : montarComprovante(pedido, lerConfig(db, 'nome_loja', 'Pizzaria'));
    res.json({ via, texto: previaTexto(db, linhas) });
  });

  // PATCH /pedidos/5/status  { "status": "em_preparo" }
  r.patch('/:id/status', (req, res) => {
    res.json(mudarStatus(db, idDaRota(req.params.id), req.body.status));
  });

  // POST /pedidos/5/imprimir  { "via": "comanda" | "comprovante" | "ambas" }
  r.post('/:id/imprimir', asyncH(async (req, res) => {
    const pedido = buscarPedido(db, idDaRota(req.params.id));
    const via = opcao(req.body.via, 'via', ['comanda', 'comprovante', 'ambas'], 'ambas');
    await imprimirPedido(db, impressora, pedido, via);
    res.json({ impresso: true, via });
  }));

  // POST /pedidos/5/emitir-nota  (desligado até integrar um provedor fiscal)
  r.post('/:id/emitir-nota', asyncH(async (req, res) => {
    const pedido = buscarPedido(db, idDaRota(req.params.id));
    const resultado = await fiscal.emitirNota(pedido);
    // A tabela notas_fiscais (conforme o modelo) exige chave e número, então só gravamos notas
    // que já voltaram do provedor com esses dados.
    if (fiscal.ativo && resultado.chave && resultado.numero) {
      db.prepare(
        'INSERT INTO notas_fiscais (pedido_id, chave, numero, status, xml_url) VALUES (?, ?, ?, ?, ?)'
      ).run(pedido.id, resultado.chave, resultado.numero, resultado.status ?? 'autorizada', resultado.xml_url ?? null);
    }
    res.json(resultado);
  }));

  return r;
}
