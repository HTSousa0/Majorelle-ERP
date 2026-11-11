// Módulo fiscal (NFC-e) — por enquanto DESLIGADO de propósito.
//
// Como plugar um provedor depois (Focus NFe, NFE.io, Nuvem Fiscal, PlugNotas...):
//   1. Crie o arquivo src/services/provedores/focusNfe.js com uma função emitir(pedido)
//      que monte o JSON da venda (itens com ncm/cfop/csosn) e chame a API do provedor.
//   2. Aqui em emitirNota, quando "ativo" for true, chame esse provedor e devolva
//      { status: 'autorizada' | 'rejeitada' | 'pendente', numero, chave, xml_url, mensagem_erro }.
//   3. Teste primeiro no ambiente de HOMOLOGAÇÃO do provedor.
// O restante do sistema (rotas, tabela notas_fiscais, impressão) já está preparado.

export function criarServicoFiscal({ ativo = false } = {}) {
  return {
    ativo,
    async emitirNota(pedido) {
      if (!ativo) {
        return { emitida: false, motivo: 'Emissão fiscal desativada (FISCAL_ATIVO=false).' };
      }
      throw new Error('Provedor fiscal ainda não implementado');
    },
  };
}
