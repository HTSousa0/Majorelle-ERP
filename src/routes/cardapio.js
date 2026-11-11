// Cardápio PÚBLICO e somente leitura: é a mesma informação que o cliente já vê no menu,
// por isso NÃO exige x-api-key (o n8n pode chamar sem configurar cabeçalho).
// Só expõe nome, categoria, tamanho, preço e disponibilidade: nada de dados fiscais ou números de estoque.
// As rotas que CRIAM coisas (/whatsapp/pedido) continuam protegidas pela chave.
import { Router } from 'express';
import { lerConfig } from '../db/index.js';

export function cardapioRouter(db) {
  const r = Router();

  r.get('/', (req, res) => {
    const bloquear = lerConfig(db, 'bloquear_sem_estoque', 'false') === 'true';
    const linhas = db
      .prepare(
        `SELECT p.id, p.nome, p.categoria, p.tamanho, p.permite_meia, p.preco,
                EXISTS (SELECT 1 FROM ficha_tecnica f JOIN insumos i ON i.id = f.insumo_id
                         WHERE f.produto_id = p.id AND i.estoque_atual < f.quantidade) AS sem_estoque
           FROM produtos p WHERE p.ativo = 1 ORDER BY p.categoria, p.nome`
      )
      .all();

    res.json({
      regra_preco_meia: lerConfig(db, 'regra_preco_meia', 'maior'), // "maior" = meia pizza cobra o sabor mais caro
      itens: linhas.map(({ sem_estoque, permite_meia, ...item }) => ({
        ...item,
        permite_meia: !!permite_meia,
        disponivel: !(bloquear && sem_estoque), // só some do cardápio se o bloqueio estiver ligado
      })),
    });
  });

  return r;
}
