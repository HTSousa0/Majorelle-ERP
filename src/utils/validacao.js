// Validadores pequenos e reutilizáveis. Todos lançam ErroHttp(400) quando o dado é inválido.
import { ErroHttp } from './erros.js';

export function texto(valor, campo, { obrigatorio = true, max = 200 } = {}) {
  if (valor === undefined || valor === null || valor === '') {
    if (obrigatorio) throw new ErroHttp(400, `Campo "${campo}" é obrigatório`);
    return null;
  }
  if (typeof valor !== 'string') throw new ErroHttp(400, `Campo "${campo}" deve ser texto`);
  const limpo = valor.trim();
  if (!limpo) {
    if (obrigatorio) throw new ErroHttp(400, `Campo "${campo}" é obrigatório`);
    return null;
  }
  if (limpo.length > max) throw new ErroHttp(400, `Campo "${campo}" excede ${max} caracteres`);
  return limpo;
}

export function inteiro(valor, campo, { min = 0, max = Number.MAX_SAFE_INTEGER, obrigatorio = true } = {}) {
  if (valor === undefined || valor === null) {
    if (obrigatorio) throw new ErroHttp(400, `Campo "${campo}" é obrigatório`);
    return null;
  }
  if (!Number.isInteger(valor) || valor < min || valor > max) {
    throw new ErroHttp(400, `Campo "${campo}" deve ser um inteiro entre ${min} e ${max}`);
  }
  return valor;
}

export function opcao(valor, campo, validas, padrao) {
  const escolhido = valor ?? padrao;
  if (!validas.includes(escolhido)) {
    throw new ErroHttp(400, `Campo "${campo}" deve ser um destes: ${validas.join(', ')}`);
  }
  return escolhido;
}

// Guarda só os dígitos: "(11) 91234-5678" vira "11912345678"
export function telefone(valor) {
  const digitos = String(valor ?? '').replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 13) {
    throw new ErroHttp(400, 'Campo "telefone" inválido (informe DDD + número)');
  }
  return digitos;
}

export function idDaRota(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1) throw new ErroHttp(400, 'Id inválido');
  return n;
}

// Valor em reais (ex.: 55 ou 12.9), com no máximo 2 casas decimais. Coluna DECIMAL(10,2).
export function dinheiro(valor, campo) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < 0 || valor > 99999999.99) {
    throw new ErroHttp(400, `Campo "${campo}" deve ser um valor em reais (número maior ou igual a 0)`);
  }
  if (Math.abs(valor * 100 - Math.round(valor * 100)) > 1e-6) {
    throw new ErroHttp(400, `Campo "${campo}" deve ter no máximo 2 casas decimais`);
  }
  return Math.round(valor * 100) / 100;
}

// Quantidade fracionada (ex.: 0.35 kg) com até 3 casas. Ajustes de estoque podem ser negativos.
export function quantidade(valor, campo, { negativo = false, zero = false } = {}) {
  const invalido = negativo ? valor === 0 : zero ? valor < 0 : valor <= 0;
  if (typeof valor !== 'number' || !Number.isFinite(valor) || invalido) {
    throw new ErroHttp(400, `Campo "${campo}" deve ser um número ${negativo ? 'diferente de 0' : zero ? 'maior ou igual a 0' : 'maior que 0'}`);
  }
  if (Math.abs(valor * 1000 - Math.round(valor * 1000)) > 1e-6) {
    throw new ErroHttp(400, `Campo "${campo}" deve ter no máximo 3 casas decimais`);
  }
  return Math.round(valor * 1000) / 1000;
}
