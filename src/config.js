// Lê as variáveis de ambiente (arquivo .env) em um único lugar.
// No executável, o .env fica ao lado do programa; rodando com npm, na pasta do projeto.
import dotenv from 'dotenv';
import path from 'node:path';
import { pastaDados, pastaExecutavel } from './utils/caminhos.js';

dotenv.config({ path: path.join(pastaExecutavel(), '.env'), quiet: true });

export const config = {
  versao: '0.3.0',
  porta: Number(process.env.PORTA) || 3000,
  dbArquivo: process.env.DB_ARQUIVO || path.join(pastaDados(), 'pizzaria.db'),
  apiKey: process.env.API_KEY || '', // chave que o n8n usa (header x-api-key)
  googleClientId: process.env.GOOGLE_CLIENT_ID || '', // opcional: ativa o botão "Entrar com Google"
  fiscalAtivo: process.env.FISCAL_ATIVO === 'true',
};
