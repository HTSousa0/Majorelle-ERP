-- Migração 002: tamanhos, meia pizza e controle de estoque de insumos.

-- Tamanho do produto (ex.: 'Broto', 'Grande'); NULL para itens sem tamanho (bebidas).
ALTER TABLE produtos ADD COLUMN tamanho VARCHAR(30);
-- Só produtos com permite_meia = 1 (e do mesmo tamanho) podem ser combinados em "meia pizza".
ALTER TABLE produtos ADD COLUMN permite_meia BOOLEAN DEFAULT 0;

-- Segundo sabor da meia pizza (NULL = item inteiro, só com produto_id).
ALTER TABLE itens_pedido ADD COLUMN produto_id_2 INTEGER REFERENCES produtos(id);

-- Insumos: ingredientes e itens estocáveis (mussarela, massa, Coca-Cola 2L...).
CREATE TABLE insumos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome VARCHAR(255) NOT NULL UNIQUE,
    unidade VARCHAR(10) NOT NULL,                 -- un, kg, g, l, ml
    estoque_atual DECIMAL(10,3) NOT NULL DEFAULT 0,
    estoque_minimo DECIMAL(10,3) NOT NULL DEFAULT 0
);

-- Ficha técnica (receita): quanto de cada insumo UM produto inteiro consome.
-- Para bebidas basta cadastrar o próprio item como insumo (1 un).
CREATE TABLE ficha_tecnica (
    produto_id INTEGER NOT NULL,
    insumo_id INTEGER NOT NULL,
    quantidade DECIMAL(10,3) NOT NULL,
    PRIMARY KEY (produto_id, insumo_id),
    FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
    FOREIGN KEY (insumo_id) REFERENCES insumos(id)
);

-- Histórico de tudo que entra/sai do estoque. quantidade é com SINAL (entrada +, saída -).
CREATE TABLE movimentacoes_estoque (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insumo_id INTEGER NOT NULL,
    pedido_id INTEGER,
    tipo VARCHAR(20) NOT NULL,                    -- entrada, saida_pedido, estorno_pedido, perda, ajuste
    quantidade DECIMAL(10,3) NOT NULL,
    criado_em DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (insumo_id) REFERENCES insumos(id),
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id)
);
