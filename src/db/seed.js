// Popula dados de exemplo (produtos, insumos e fichas técnicas): npm run seed
import { abrirBanco } from './index.js';

const db = abrirBanco();
const { total } = db.prepare('SELECT COUNT(*) AS total FROM produtos').get();

if (total > 0) {
  console.log('Já existem produtos cadastrados; nada a fazer.');
} else {
  db.transaction(() => {
    const novoProduto = db.prepare(
      'INSERT INTO produtos (nome, categoria, preco, tamanho, permite_meia) VALUES (?, ?, ?, ?, ?)'
    );
    const novoInsumo = db.prepare(
      'INSERT INTO insumos (nome, unidade, estoque_atual, estoque_minimo) VALUES (?, ?, ?, ?)'
    );
    const novaFicha = db.prepare('INSERT INTO ficha_tecnica (produto_id, insumo_id, quantidade) VALUES (?, ?, ?)');
    const id = (info) => Number(info.lastInsertRowid);

    const massa = id(novoInsumo.run('Massa de pizza grande', 'un', 30, 10));
    const mussarela = id(novoInsumo.run('Mussarela', 'kg', 10, 2));
    const calabresa = id(novoInsumo.run('Calabresa', 'kg', 5, 1));
    const coca = id(novoInsumo.run('Coca-Cola 2L', 'un', 24, 6));
    const guarana = id(novoInsumo.run('Guaraná 2L', 'un', 24, 6));

    // Pizzas grandes (permitem meia). Quantidades = consumo de UMA pizza inteira.
    const pCalabresa = id(novoProduto.run('Calabresa - Grande', 'pizza', 55.0, 'Grande', 1));
    const pMussarela = id(novoProduto.run('Mussarela - Grande', 'pizza', 48.0, 'Grande', 1));
    const pPortuguesa = id(novoProduto.run('Portuguesa - Grande', 'pizza', 59.0, 'Grande', 1));
    const pCoca = id(novoProduto.run('Coca-Cola 2L', 'bebida', 14.0, null, 0));
    const pGuarana = id(novoProduto.run('Guaraná 2L', 'bebida', 12.0, null, 0));

    novaFicha.run(pCalabresa, massa, 1); novaFicha.run(pCalabresa, mussarela, 0.35); novaFicha.run(pCalabresa, calabresa, 0.2);
    novaFicha.run(pMussarela, massa, 1); novaFicha.run(pMussarela, mussarela, 0.5);
    novaFicha.run(pPortuguesa, massa, 1); novaFicha.run(pPortuguesa, mussarela, 0.3);
    novaFicha.run(pCoca, coca, 1);
    novaFicha.run(pGuarana, guarana, 1);
  })();
  console.log('Produtos, insumos e fichas técnicas de exemplo criados.');
}
