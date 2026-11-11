// O módulo embutido node:sqlite ainda é marcado como "experimental" e imprime um aviso ao ser carregado.
// Este arquivo precisa ser importado ANTES dele, só para esconder esse aviso específico.
const emitirOriginal = process.emitWarning;
process.emitWarning = (aviso, ...resto) => {
  if (String(aviso).includes('SQLite')) return;
  return emitirOriginal.call(process, aviso, ...resto);
};
