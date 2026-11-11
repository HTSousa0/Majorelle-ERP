// Números do painel inicial. Tudo calculado a partir dos pedidos reais (cancelados não entram no faturamento).
// O "dia" da pizzaria segue o horário de Brasília (UTC-3, sem horário de verão).
import { Router } from 'express';

const FUSO = "'-3 hours'";

export function dashboardRouter(db) {
  const r = Router();

  r.get('/stats', (req, res) => {
    const resumo = (filtro) => {
      const l = db.prepare(`SELECT COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS faturamento FROM pedidos
                             WHERE status != 'cancelado' AND ${filtro}`).get();
      return { pedidos: l.pedidos, faturamento: l.faturamento, ticket_medio: l.pedidos ? l.faturamento / l.pedidos : 0 };
    };
    const hoje = resumo(`date(criado_em, ${FUSO}) = date('now', ${FUSO})`);
    const mes = resumo(`strftime('%Y-%m', date(criado_em, ${FUSO})) = strftime('%Y-%m', date('now', ${FUSO}))`);

    const emAndamento = db.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE status IN ('recebido','em_preparo','saiu_entrega')").get().n;

    // últimos 7 dias (inclui dias sem venda, com zero)
    const porDia = new Map(db.prepare(
      `SELECT date(criado_em, ${FUSO}) AS dia, COUNT(*) AS pedidos, COALESCE(SUM(total), 0) AS total
         FROM pedidos WHERE status != 'cancelado' AND date(criado_em, ${FUSO}) >= date('now', ${FUSO}, '-6 days')
        GROUP BY dia`).all().map((l) => [l.dia, l]));
    const dias = db.prepare(`SELECT date('now', ${FUSO}, '-' || n || ' days') AS dia FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6) ORDER BY dia`).all();
    const vendas7 = dias.map(({ dia }) => ({ dia, pedidos: porDia.get(dia)?.pedidos ?? 0, total: porDia.get(dia)?.total ?? 0 }));

    // mais vendidos nos últimos 30 dias (meia pizza conta 0,5 para cada sabor)
    const maisVendidos = db.prepare(
      `SELECT nome, SUM(qtd) AS quantidade FROM (
         SELECT p.nome AS nome, i.quantidade * (CASE WHEN i.produto_id_2 IS NULL THEN 1.0 ELSE 0.5 END) AS qtd
           FROM itens_pedido i JOIN pedidos pd ON pd.id = i.pedido_id JOIN produtos p ON p.id = i.produto_id
          WHERE pd.status != 'cancelado' AND date(pd.criado_em, ${FUSO}) >= date('now', ${FUSO}, '-29 days')
         UNION ALL
         SELECT p.nome, i.quantidade * 0.5
           FROM itens_pedido i JOIN pedidos pd ON pd.id = i.pedido_id JOIN produtos p ON p.id = i.produto_id_2
          WHERE i.produto_id_2 IS NOT NULL AND pd.status != 'cancelado' AND date(pd.criado_em, ${FUSO}) >= date('now', ${FUSO}, '-29 days')
       ) GROUP BY nome ORDER BY quantidade DESC LIMIT 5`).all();

    const estoqueBaixo = db.prepare(
      'SELECT nome, unidade, estoque_atual, estoque_minimo FROM insumos WHERE estoque_atual <= estoque_minimo ORDER BY (estoque_atual - estoque_minimo) LIMIT 5').all();

    const ultimos = db.prepare(
      `SELECT p.id, p.status, p.tipo, p.total, p.criado_em, c.nome AS cliente_nome
         FROM pedidos p JOIN clientes c ON c.id = p.cliente_id ORDER BY p.id DESC LIMIT 5`).all();

    res.json({ hoje, mes, em_andamento: emAndamento, vendas_7_dias: vendas7, mais_vendidos: maisVendidos, estoque_baixo: estoqueBaixo, ultimos_pedidos: ultimos });
  });

  return r;
}
