// Onde ficam os arquivos, tanto rodando com "npm start" quanto no executável (pkg).
// No executável, o código e os arquivos embutidos (migrações, interface) ficam num "snapshot" somente
// leitura; o banco de dados e o .env ficam na pasta ao lado do executável.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const empacotado = Boolean(process.pkg);

// No pacote único (dist/app.cjs, gerado pelo esbuild) existe __dirname e os arquivos ficam ao lado dele.
// Rodando o código-fonte normal (ES modules), __dirname não existe e usamos import.meta.url.
const emBundle = typeof __dirname === 'string';
const aqui = emBundle ? null : path.dirname(fileURLToPath(import.meta.url)); // "src/utils"

export const pastaExecutavel = () => (empacotado ? path.dirname(process.execPath) : process.cwd());
export const pastaDados = () => (empacotado ? path.join(pastaExecutavel(), 'data') : path.resolve('data'));
export const pastaMigracoes = () => (emBundle ? path.join(__dirname, 'migrations') : path.join(aqui, '../db/migrations'));
export const arquivoIndices = () => (emBundle ? path.join(__dirname, 'indices.sql') : path.join(aqui, '../db/indices.sql'));
export const pastaPublica = () => (emBundle ? path.join(__dirname, 'public') : path.join(aqui, '../../public'));
