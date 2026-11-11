// Gerador de comandos ESC/POS (a "linguagem" das impressoras térmicas) e conversão de acentos.
// Escrito à mão para não depender de bibliotecas nativas (o programa vira um .exe único).
import { PAGINAS } from './codepages.js';

const MAPAS = {};
for (const [nome, tabela] of Object.entries(PAGINAS)) {
  const mapa = new Map();
  [...tabela].forEach((ch, i) => mapa.set(ch, 0x80 + i));
  MAPAS[nome] = mapa;
}

const SUBSTITUICOES = { '×': 'x', '–': '-', '—': '-', '’': "'", '‘': "'", '“': '"', '”': '"', '…': '...', '•': '*', '✂': '-', '€': 'EUR' };

// Texto (Unicode) -> bytes na página de código da impressora.
// Caracteres de controle viram espaço: assim um nome de cliente malicioso não consegue enviar comandos à impressora.
export function codificar(texto, pagina = 'cp860') {
  const mapa = MAPAS[pagina];
  const saida = [];
  for (const ch of String(texto)) {
    const cod = ch.codePointAt(0);
    if (cod < 0x20 || cod === 0x7f) { saida.push(0x20); continue; }
    if (cod < 0x80) { saida.push(cod); continue; }
    if (mapa?.has(ch)) { saida.push(mapa.get(ch)); continue; }
    const sub = SUBSTITUICOES[ch] ?? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // "ã" -> "a" quando a página não tem o caractere
    for (const c of sub) saida.push(c.codePointAt(0) >= 0x20 && c.codePointAt(0) < 0x7f ? c.codePointAt(0) : 0x3f);
  }
  return saida;
}

// Quebra o texto em linhas de no máximo "colunas" caracteres, sem cortar palavras quando possível.
export function quebrar(texto, colunas) {
  const linhas = [];
  for (const paragrafo of String(texto).split(/\r?\n/)) {
    let atual = '';
    for (let palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      while (palavra.length > colunas) { // palavra maior que a linha: corta
        if (atual) { linhas.push(atual); atual = ''; }
        linhas.push(palavra.slice(0, colunas));
        palavra = palavra.slice(colunas);
      }
      if (!atual) atual = palavra;
      else if (atual.length + 1 + palavra.length <= colunas) atual += ' ' + palavra;
      else { linhas.push(atual); atual = palavra; }
    }
    linhas.push(atual);
  }
  return linhas;
}

const TAMANHO = { normal: 0x00, altura: 0x01, grande: 0x11 }; // GS ! n (largura e altura dobradas = 0x11)
const ALINHAR = { esq: 0, centro: 1, dir: 2 };

export class Cupom {
  constructor({ pagina = 'cp860' } = {}) {
    this.bytes = [0x1b, 0x40]; // ESC @ : reinicia a impressora
    if (pagina === 'cp860') this.bytes.push(0x1b, 0x74, 3); // ESC t 3 : PC860 (português)
    if (pagina === 'cp850') this.bytes.push(0x1b, 0x74, 2); // ESC t 2 : PC850
    this.pagina = pagina;
  }

  linha(texto, { alinhar = 'esq', negrito = false, tamanho = 'normal' } = {}) {
    this.bytes.push(0x1b, 0x61, ALINHAR[alinhar] ?? 0); // ESC a n : alinhamento
    this.bytes.push(0x1b, 0x45, negrito ? 1 : 0); // ESC E n : negrito
    this.bytes.push(0x1d, 0x21, TAMANHO[tamanho] ?? 0); // GS ! n : tamanho
    this.bytes.push(...codificar(texto, this.pagina), 0x0a);
    return this;
  }

  cortar(avanco = 4) {
    this.bytes.push(0x1b, 0x45, 0, 0x1d, 0x21, 0, 0x1b, 0x61, 0); // volta ao normal
    this.bytes.push(0x1b, 0x64, avanco); // ESC d n : avança n linhas
    this.bytes.push(0x1d, 0x56, 0x42, 0x00); // GS V B 0 : corte parcial
    return this;
  }

  toBuffer() { return Buffer.from(this.bytes); }
}
