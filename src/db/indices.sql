-- Índices para deixar as consultas rápidas. Ficam fora do modelo.
CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
CREATE INDEX IF NOT EXISTS idx_itens_pedido ON itens_pedido(pedido_id);
CREATE INDEX IF NOT EXISTS idx_enderecos_cliente ON enderecos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ficha_insumo ON ficha_tecnica(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_insumo ON movimentacoes_estoque(insumo_id);
CREATE INDEX IF NOT EXISTS idx_mov_pedido ON movimentacoes_estoque(pedido_id);
