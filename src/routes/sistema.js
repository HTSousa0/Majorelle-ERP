// Informações do sistema para a tela de Configurações (versão, impressora e endereços de acesso na rede).
import { Router } from 'express';
import os from 'node:os';
import { config } from '../config.js';
import { lerConfigImpressora } from '../services/impressaoService.js';

export function enderecosNaRede(porta) {
  const urls = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal) urls.push(`http://${i.address}:${porta}`);
    }
  }
  return urls;
}

export function sistemaRouter(db, { apiKey }) {
  const r = Router();
  r.get('/', (req, res) => {
    res.json({
      versao: config.versao,
      impressora: lerConfigImpressora(db).modo, // "console" = modo teste (não imprime de verdade)
      fiscal_ativo: config.fiscalAtivo,
      whatsapp_liberado: Boolean(apiKey), // rotas do n8n só funcionam com API_KEY definida
      enderecos: enderecosNaRede(req.socket.localPort),
    });
  });
  return r;
}
