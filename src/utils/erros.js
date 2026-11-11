// Erro com status HTTP, para as regras de negócio responderem corretamente.
export class ErroHttp extends Error {
  constructor(status, mensagem, detalhes) {
    super(mensagem);
    this.status = status;
    this.detalhes = detalhes;
  }
}

export function naoEncontrado(req, res) {
  res.status(404).json({ erro: 'Rota não encontrada' });
}

// Middleware final: transforma qualquer erro em uma resposta JSON.
export function tratarErros(err, req, res, next) {
  if (err instanceof ErroHttp) {
    return res.status(err.status).json({ erro: err.message, detalhes: err.detalhes });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'JSON inválido no corpo da requisição' });
  }
  if (err.errcode === 2067 || /UNIQUE constraint failed/.test(err.message ?? '')) {
    return res.status(409).json({ erro: 'Registro duplicado' });
  }
  console.error(err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
}

// Express 4 não captura erros de funções async sozinho; este wrapper resolve isso.
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
