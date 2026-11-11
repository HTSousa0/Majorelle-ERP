// Abre o banco SQLite, aplica as migrações (src/db/migrations/*.sql) e garante as preferências padrão.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { arquivoIndices, pastaMigracoes } from '../utils/caminhos.js';
import Database from './sqlite.js';

const migracoes = fs.readdirSync(pastaMigracoes()).filter((f) => f.endsWith('.sql')).sort();
const indices = fs.readFileSync(arquivoIndices(), 'utf8');

// Preferências iniciais (a pizzaria altera depois via PUT /configuracoes/:chave). Valores em reais.
const CONFIG_PADRAO = {
  nome_loja: 'Majorelle Pizzaria',
  taxa_entrega: '7.00',
  horario_abertura: '18:00',
  horario_fechamento: '23:30',
  tempo_estimado_min: '50',
  mensagem_boas_vindas: 'Olá! Bem-vindo à nossa pizzaria 🍕 Como posso ajudar com seu pedido?',
  regra_preco_meia: 'maior', // meia pizza: cobra o sabor mais caro ("maior") ou a média ("media")
  bloquear_sem_estoque: 'false', // true = recusa pedido se faltar insumo; false = só gera alerta
  // Backup automático (a pasta local é sempre data/backups ao lado do programa)
  backup_ativo: 'true',
  backup_intervalo_horas: '6',
  backup_manter: '20', // quantos backups guardar
  backup_pasta_extra: '', // opcional: segunda cópia em outro lugar (pendrive, OneDrive...). Ex.: D:\\Backups
  // Impressora térmica (configurada na tela Configurações)
  impressora_modo: 'console', // console (teste) | windows | rede
  impressora_nome: '', // nome da impressora instalada no Windows
  impressora_ip: '', // impressora de rede
  impressora_porta: '9100',
  impressora_largura: '48', // 48 colunas = papel 80 mm | 32 = papel 58 mm
  impressora_pagina: 'cp860', // cp860 | cp850 | ascii (sem acentos)
};

// Controle de versão do banco pelo PRAGMA user_version: cada migração roda uma única vez, em ordem.
function migrar(db) {
  let versao = db.pragma('user_version', { simple: true });

  // Banco criado antes de existirem migrações (já tem as tabelas do modelo inicial): marca como versão 1.
  const legado = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'clientes'").get();
  if (versao === 0 && legado) {
    versao = 1;
    db.pragma('user_version = 1');
  }

  migracoes.forEach((arquivo, i) => {
    const numero = i + 1;
    if (numero <= versao) return;
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(pastaMigracoes(), arquivo), 'utf8'));
      db.pragma(`user_version = ${numero}`);
    })();
  });
}

export function abrirBanco(arquivo = config.dbArquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new Database(arquivo);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON'); // no SQLite as chaves estrangeiras precisam ser ligadas
  migrar(db);
  db.exec(indices);

  const inserir = db.prepare('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)');
  for (const [chave, valor] of Object.entries(CONFIG_PADRAO)) inserir.run(chave, valor);
  return db;
}

export function lerConfig(db, chave, padrao = null) {
  const linha = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?').get(chave);
  return linha ? linha.valor : padrao;
}
