// Configuração da impressora térmica (somente administradores).
import { Router } from 'express';
import { lerConfig } from '../db/index.js';
import { lerConfigImpressora, listarImpressorasWindows, montarTeste, previaTexto } from '../services/impressaoService.js';
import { asyncH, ErroHttp } from '../utils/erros.js';
import { opcao, texto } from '../utils/validacao.js';

function gravar(db, chave, valor) {
  db.prepare('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
}

export function impressoraRouter(db, impressora) {
  const r = Router();

  r.get('/', asyncH(async (req, res) => {
    const { impressoras, erro } = await listarImpressorasWindows();
    res.json({ config: lerConfigImpressora(db), plataforma: process.platform, impressoras_windows: impressoras, erro_lista: erro });
  }));

  r.put('/', (req, res) => {
    const b = req.body;
    const modo = opcao(b.modo, 'modo', ['console', 'windows', 'rede']);
    const largura = opcao(String(b.largura ?? '48'), 'largura', ['48', '32']);
    const pagina = opcao(b.pagina, 'pagina', ['cp860', 'cp850', 'ascii'], 'cp860');
    const nome = texto(b.nome, 'nome', { obrigatorio: modo === 'windows', max: 200 }) ?? '';
    const ip = texto(b.ip, 'ip', { obrigatorio: modo === 'rede', max: 100 }) ?? '';
    if (ip && !/^[A-Za-z0-9.-]{3,100}$/.test(ip)) throw new ErroHttp(400, 'IP ou nome da impressora inválido.');
    const porta = Number(b.porta ?? 9100);
    if (!Number.isInteger(porta) || porta < 1 || porta > 65535) throw new ErroHttp(400, 'Porta inválida.');

    db.transaction(() => {
      gravar(db, 'impressora_modo', modo); gravar(db, 'impressora_nome', nome); gravar(db, 'impressora_ip', ip);
      gravar(db, 'impressora_porta', String(porta)); gravar(db, 'impressora_largura', largura); gravar(db, 'impressora_pagina', pagina);
    })();
    res.json(lerConfigImpressora(db));
  });

  // Mostra na tela como o cupom de teste sairia (útil no modo "Teste", sem impressora de verdade)
  r.get('/previa', (req, res) => {
    const cfg = lerConfigImpressora(db);
    res.json({ texto: previaTexto(db, montarTeste(lerConfig(db, 'nome_loja', 'Pizzaria'), cfg.largura)) });
  });

  r.post('/teste', asyncH(async (req, res) => {
    const cfg = lerConfigImpressora(db);
    await impressora.imprimir(montarTeste(lerConfig(db, 'nome_loja', 'Pizzaria'), cfg.largura));
    res.json({ impresso: true, modo: cfg.modo });
  }));

  return r;
}
