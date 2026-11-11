// Impressão em impressora térmica (ESC/POS) no Windows.
// Os documentos (comanda, comprovante, teste) são listas de "linhas" neutras; depois:
//   diagramar()  -> quebra e alinha para a largura do papel
//   modo console -> mostra como texto (testes e pré-visualização)
//   modo windows -> envia os bytes para uma impressora instalada no Windows (spooler, tipo RAW)
//   modo rede    -> envia os bytes direto para uma impressora de rede (porta 9100)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { lerConfig } from '../db/index.js';
import { ErroHttp } from '../utils/erros.js';
import { Cupom, quebrar } from './escpos.js';

// ---------- Formatação (sem depender do idioma do sistema) ----------
export const formatarReais = (reais) => {
  const n = Number(reais);
  const [inteiro, centavos] = Math.abs(n).toFixed(2).split('.');
  const milhares = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}R$ ${milhares},${centavos}`;
};

// "2026-11-04 12:27:09" (UTC, como vem do banco) -> "04/11/2026 09:27" (horário de Brasília)
const formatarData = (utc) => {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(String(utc).replace(' ', 'T') + 'Z'));
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
};

const nomeItem = (item) => (item.produto_2_nome ? `1/2 ${item.produto_nome} + 1/2 ${item.produto_2_nome}` : item.produto_nome);
const NOME_PAGAMENTO = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito' };

// ---------- Documentos ----------
export function montarComanda(pedido) {
  const linhas = [
    { tipo: 'texto', texto: `COMANDA #${pedido.id}`, alinhar: 'centro', negrito: true, tamanho: 'grande' },
    { tipo: 'texto', texto: formatarData(pedido.criado_em), alinhar: 'centro' },
    { tipo: 'texto', texto: pedido.tipo.toUpperCase(), alinhar: 'centro', negrito: true, tamanho: 'altura' },
    { tipo: 'separador' },
    { tipo: 'texto', texto: `${pedido.cliente_nome} - ${pedido.cliente_telefone}` },
  ];
  if (pedido.endereco) {
    const e = pedido.endereco;
    linhas.push({ tipo: 'texto', texto: `${e.rua}, ${e.numero} - ${e.bairro}` });
    if (e.complemento) linhas.push({ tipo: 'texto', texto: e.complemento });
  }
  linhas.push({ tipo: 'separador' });
  for (const item of pedido.itens) {
    linhas.push({ tipo: 'texto', texto: `${item.quantidade}x ${nomeItem(item)}`, negrito: true, tamanho: 'altura' });
    if (item.observacao) linhas.push({ tipo: 'texto', texto: `   obs: ${item.observacao}` });
  }
  linhas.push({ tipo: 'separador' }, { tipo: 'corte' });
  return linhas;
}

// Comprovante do cliente. Enquanto não houver NFC-e autorizada, deixa claro que NÃO tem valor fiscal.
export function montarComprovante(pedido, nomeLoja) {
  const autorizada = pedido.notas_fiscais?.some((n) => n.status === 'autorizada');
  const linhas = [
    { tipo: 'texto', texto: nomeLoja, alinhar: 'centro', negrito: true, tamanho: 'altura' },
    { tipo: 'texto', texto: `PEDIDO #${pedido.id}`, alinhar: 'centro' },
    { tipo: 'texto', texto: formatarData(pedido.criado_em), alinhar: 'centro' },
  ];
  if (!autorizada) linhas.push({ tipo: 'texto', texto: '*** SEM VALOR FISCAL ***', alinhar: 'centro', negrito: true });
  linhas.push({ tipo: 'separador' });
  for (const item of pedido.itens) {
    linhas.push({ tipo: 'duplo', esq: `${item.quantidade}x ${nomeItem(item)}`, dir: formatarReais(item.preco_unitario * item.quantidade) });
  }
  linhas.push({ tipo: 'separador' });
  if (pedido.taxa_entrega > 0) linhas.push({ tipo: 'duplo', esq: 'Taxa de entrega', dir: formatarReais(pedido.taxa_entrega) });
  linhas.push(
    { tipo: 'duplo', esq: 'TOTAL', dir: formatarReais(pedido.total), negrito: true },
    { tipo: 'texto', texto: `Pagamento: ${NOME_PAGAMENTO[pedido.forma_pagamento]}` },
    { tipo: 'separador' },
    { tipo: 'texto', texto: 'Obrigado pela preferência!', alinhar: 'centro' },
    { tipo: 'corte' }
  );
  return linhas;
}

export function montarTeste(nomeLoja, largura) {
  const regua = '1234567890'.repeat(5).slice(0, largura);
  return [
    { tipo: 'texto', texto: 'TESTE DE IMPRESSÃO', alinhar: 'centro', negrito: true, tamanho: 'grande' },
    { tipo: 'texto', texto: nomeLoja, alinhar: 'centro' },
    { tipo: 'separador' },
    { tipo: 'texto', texto: regua },
    { tipo: 'texto', texto: 'Acentos: áéíóú ãõ â ê ô ç ½' },
    { tipo: 'texto', texto: 'MAIÚSCULAS: ÁÉÍÓÚ ÃÕ Ç' },
    { tipo: 'duplo', esq: '1x Pizza Calabresa Grande', dir: formatarReais(55) },
    { tipo: 'texto', texto: 'Negrito', negrito: true },
    { tipo: 'separador' },
    { tipo: 'texto', texto: 'Se os acentos saíram trocados, mude a "Página de código" em Configurações.', alinhar: 'centro' },
    { tipo: 'corte' },
  ];
}

// ---------- Diagramação (largura do papel) ----------
export function diagramar(linhas, largura = 48) {
  const saida = [];
  for (const l of linhas) {
    if (l.tipo === 'corte') { saida.push({ tipo: 'corte' }); continue; }
    if (l.tipo === 'separador') { saida.push({ tipo: 'texto', texto: '-'.repeat(largura) }); continue; }
    if (l.tipo === 'duplo') {
      const partes = quebrar(l.esq, Math.max(8, largura - l.dir.length - 1));
      partes.forEach((p, i) => {
        const ultima = i === partes.length - 1;
        const texto = ultima ? p + ' '.repeat(Math.max(1, largura - p.length - l.dir.length)) + l.dir : p;
        saida.push({ tipo: 'texto', texto, negrito: l.negrito });
      });
      continue;
    }
    const colunas = l.tamanho === 'grande' ? Math.floor(largura / 2) : largura;
    for (const parte of quebrar(l.texto, colunas)) saida.push({ tipo: 'texto', texto: parte, alinhar: l.alinhar, negrito: l.negrito, tamanho: l.tamanho });
  }
  return saida;
}

export function renderizarTexto(linhasDiagramadas, largura = 48) {
  return linhasDiagramadas.map((l) => {
    if (l.tipo === 'corte') return '- - - - - - - - - ✂ - - - - - - - - -';
    const colunas = l.tamanho === 'grande' ? Math.floor(largura / 2) : largura;
    if (l.alinhar === 'centro') return ' '.repeat(Math.max(0, Math.floor((largura - l.texto.length * (largura / colunas)) / 2))) + l.texto;
    return l.texto;
  }).join('\n');
}

function montarBytes(linhasDiagramadas, { pagina }) {
  const cupom = new Cupom({ pagina });
  for (const l of linhasDiagramadas) {
    if (l.tipo === 'corte') cupom.cortar();
    else cupom.linha(l.texto, { alinhar: l.alinhar, negrito: l.negrito, tamanho: l.tamanho });
  }
  return cupom.toBuffer();
}

// ---------- Configuração (guardada na tela Configurações) ----------
export function lerConfigImpressora(db) {
  const largura = Number(lerConfig(db, 'impressora_largura', '48'));
  const pagina = lerConfig(db, 'impressora_pagina', 'cp860');
  return {
    modo: ['console', 'windows', 'rede'].includes(lerConfig(db, 'impressora_modo', 'console')) ? lerConfig(db, 'impressora_modo', 'console') : 'console',
    nome: lerConfig(db, 'impressora_nome', ''),
    ip: lerConfig(db, 'impressora_ip', ''),
    porta: Number(lerConfig(db, 'impressora_porta', '9100')) || 9100,
    largura: largura === 32 ? 32 : 48,
    pagina: ['cp860', 'cp850', 'ascii'].includes(pagina) ? pagina : 'cp860',
  };
}

// Texto da pré-visualização (a mesma diagramação que sai no papel)
export function previaTexto(db, linhas) {
  const { largura } = lerConfigImpressora(db);
  return renderizarTexto(diagramar(linhas, largura), largura);
}

// ---------- Envio ----------
let fila = Promise.resolve(); // um trabalho de impressão por vez
const naFila = (tarefa) => { const p = fila.then(tarefa, tarefa); fila = p.catch(() => {}); return p; };

function enviarRede({ ip, porta }, bytes) {
  if (!/^[A-Za-z0-9.-]{3,100}$/.test(ip)) throw new ErroHttp(400, 'Informe o IP da impressora em Configurações.');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: ip, port: porta }, () => socket.write(bytes, () => socket.end()));
    socket.setTimeout(6000, () => { socket.destroy(); reject(new ErroHttp(504, `A impressora ${ip} não respondeu.`)); });
    socket.on('error', (e) => reject(new ErroHttp(502, `Não consegui conectar na impressora ${ip}:${porta} (${e.code ?? e.message}).`)));
    socket.on('close', resolve);
  });
}

// Envio "cru" (RAW) para o spooler do Windows, via PowerShell (não precisa instalar nada).
const SCRIPT_RAW = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class PizzariaRaw {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW { [MarshalAs(UnmanagedType.LPWStr)] public string pDocName; [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile; [MarshalAs(UnmanagedType.LPWStr)] public string pDataType; }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool StartDocPrinter(IntPtr h, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOW di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, IntPtr b, int c, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("Impressora nao encontrada: " + printer + " (erro " + Marshal.GetLastWin32Error() + ")");
    try {
      DOCINFOW di = new DOCINFOW(); di.pDocName = "Pizzaria ERP"; di.pDataType = "RAW";
      if (!StartDocPrinter(h, 1, di)) throw new Exception("Nao consegui iniciar a impressao (erro " + Marshal.GetLastWin32Error() + ")");
      try {
        StartPagePrinter(h);
        IntPtr p = Marshal.AllocCoTaskMem(data.Length);
        try { Marshal.Copy(data, 0, p, data.Length); int w; if (!WritePrinter(h, p, data.Length, out w)) throw new Exception("Falha ao enviar para a impressora (erro " + Marshal.GetLastWin32Error() + ")"); }
        finally { Marshal.FreeCoTaskMem(p); }
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
[PizzariaRaw]::Send($env:PIZZARIA_IMPRESSORA, [System.IO.File]::ReadAllBytes($env:PIZZARIA_ARQUIVO))
`;

function powershell(script, env = {}, tempoMs = 20000) {
  return new Promise((resolve, reject) => {
    const codificado = Buffer.from(script, 'utf16le').toString('base64');
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificado],
      { env: { ...process.env, ...env }, windowsHide: true });
    let saida = ''; let erro = '';
    const relogio = setTimeout(() => { proc.kill(); reject(new ErroHttp(504, 'O Windows demorou demais para responder.')); }, tempoMs);
    proc.stdout.on('data', (d) => { saida += d; });
    proc.stderr.on('data', (d) => { erro += d; });
    proc.on('error', (e) => { clearTimeout(relogio); reject(new ErroHttp(500, `Não consegui usar o PowerShell: ${e.message}`)); });
    proc.on('close', (codigo) => {
      clearTimeout(relogio);
      if (codigo === 0) resolve(saida);
      else reject(new ErroHttp(502, (erro.split('\n').find((l) => l.trim()) ?? 'Falha ao imprimir.').trim().slice(0, 300)));
    });
  });
}

async function enviarWindows(nome, bytes) {
  if (process.platform !== 'win32') throw new ErroHttp(400, 'Imprimir pelo Windows só funciona no Windows.');
  if (!nome) throw new ErroHttp(400, 'Escolha a impressora em Configurações.');
  const arquivo = path.join(os.tmpdir(), `pizzaria-${Date.now()}-${process.pid}.bin`);
  fs.writeFileSync(arquivo, bytes);
  try { await powershell(SCRIPT_RAW, { PIZZARIA_IMPRESSORA: nome, PIZZARIA_ARQUIVO: arquivo }); }
  finally { fs.rmSync(arquivo, { force: true }); }
}

export async function listarImpressorasWindows() {
  if (process.platform !== 'win32') return { impressoras: [], erro: null };
  try {
    const saida = await powershell('[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Printer | Select-Object -ExpandProperty Name', {}, 15000);
    return { impressoras: saida.split(/\r?\n/).map((s) => s.trim()).filter(Boolean), erro: null };
  } catch (e) { return { impressoras: [], erro: e.message }; }
}

// ---------- API usada pelo resto do sistema ----------
export function criarImpressora(db) {
  return {
    async imprimir(linhas) {
      const cfg = lerConfigImpressora(db);
      const diagramado = diagramar(linhas, cfg.largura);
      if (cfg.modo === 'console') { console.log('\n' + renderizarTexto(diagramado, cfg.largura) + '\n'); return; }
      const bytes = montarBytes(diagramado, cfg);
      if (cfg.modo === 'rede') await naFila(() => enviarRede(cfg, bytes));
      else await naFila(() => enviarWindows(cfg.nome, bytes));
    },
  };
}

export async function imprimirPedido(db, impressora, pedido, via = 'ambas') {
  const nomeLoja = lerConfig(db, 'nome_loja', 'Pizzaria');
  if (via === 'comanda' || via === 'ambas') await impressora.imprimir(montarComanda(pedido));
  if (via === 'comprovante' || via === 'ambas') await impressora.imprimir(montarComprovante(pedido, nomeLoja));
}
