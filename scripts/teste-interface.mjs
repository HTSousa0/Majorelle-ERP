import { JSDOM } from 'jsdom';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.BCRYPT_CUSTO = '4';
import { criarApp } from '../src/app.js';
import { abrirBanco } from '../src/db/index.js';
import { criarServicoBackup } from '../src/services/backupService.js';
import { criarServicoFiscal } from '../src/services/fiscalService.js';

const db = abrirBanco(':memory:');
const impressos = [];
const app = criarApp(db, { impressora: { imprimir: async (l) => impressos.push(l) }, fiscal: criarServicoFiscal({}), apiKey: 'k',
  segredo: 'segredo-de-teste-com-mais-de-32-caracteres!!', servicoBackup: criarServicoBackup(db, { pastaBackups: fs.mkdtempSync(path.join(os.tmpdir(), 'ui-')) }) });
const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
const base = `http://127.0.0.1:${server.address().port}`;

const dom = await JSDOM.fromURL(base + '/', { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
  beforeParse(w) {
    w.fetch = (u, o) => fetch(new URL(u, base), o);
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new w.Event('close')); };
    w.confirm = () => true;
    w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
  } });
const w = dom.window; const doc = w.document;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const erros = []; w.addEventListener('error', (e) => erros.push(e.message));
let falhas = 0;
const ok = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) falhas++; };
const visivel = (sel) => doc.querySelector(sel)?.closest('.screen')?.classList.contains('active');
const digitar = (sel, v) => { const el = doc.querySelector(sel); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); };
const enviar = (form) => form.dispatchEvent(new w.Event('submit', { cancelable: true, bubbles: true }));
const api = async (m, p, b, t) => { const r = await fetch(base + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); return { s: r.status, d: await r.json().catch(() => null) }; };
await espera(700);

// ---- primeiro acesso ----
ok(visivel('#login-form'), 'tela de login aparece primeiro');
ok(!doc.querySelector('#grupo-nome').hidden, 'primeiro acesso pede o nome (criar administrador)');
ok(doc.querySelector('#email').value === '' && doc.querySelector('#senha').value === '', 'login NÃO vem com e-mail/senha preenchidos');
digitar('#nome', 'Henrique'); digitar('#email', 'henrique@majorelle.com'); digitar('#senha', '123');
enviar(doc.querySelector('#login-form')); await espera(500);
ok(/8 caracteres/.test(doc.querySelector('#login-msg').textContent), 'senha curta é recusada com mensagem clara');
digitar('#senha', 'Majorelle#2026'); enviar(doc.querySelector('#login-form')); await espera(900);
ok(visivel('#tela'), 'depois de criar o administrador entra no sistema');
ok(doc.querySelector('#user-nome').textContent === 'Henrique', 'nome do usuário aparece no topo');
ok(doc.querySelector('#page-title').textContent === 'Painel de Controle' && doc.querySelector('.metrics-grid'), 'Dashboard carregou');
const token = w.localStorage.getItem('majorelle_token');
ok(!!token, 'token de login guardado no navegador');

// ---- dados de exemplo pela API (como um administrador) ----
const nova = async (b) => (await api('POST', '/api/produtos', b, token)).d;
const ins = (await api('POST', '/api/insumos', { nome: 'Mussarela', unidade: 'kg', estoque_atual: 1, estoque_minimo: 2 }, token)).d;
const cala = await nova({ nome: 'Calabresa - Grande', categoria: 'Pizza', preco: 55 });   // pizza "antiga": sem tamanho/meia
const mussa = await nova({ nome: 'Mussarela - Grande', categoria: 'Pizza', preco: 48 });
await nova({ nome: 'Guaraná 2L', categoria: 'Bebida', preco: 12 });
await api('PUT', `/api/produtos/${cala.id}/ficha-tecnica`, { itens: [{ insumo_id: ins.id, quantidade: 0.4 }] }, token);

// ---- produtos: assistente de meia pizza ----
w.location.hash = '#produtos'; await espera(700);
ok(!!doc.querySelector('#btnAssistente'), 'aviso: pizzas ainda não configuradas para meia pizza');
ok(doc.querySelector('#linhas').textContent.includes('não configurada'), 'tabela mostra "não configurada" nas pizzas antigas');
doc.querySelector('#btnAssistente').click(); await espera(100);
ok([...doc.querySelectorAll('dialog[open] .tam')].every((i) => i.value === 'Grande'), 'assistente sugere o tamanho "Grande" pelo nome');
enviar(doc.querySelector('#formAssist')); await espera(800);
ok(doc.querySelector('#linhas').textContent.includes('permite') && !doc.querySelector('#btnAssistente'), 'pizzas agora identificadas como meia pizza');

// ---- novo pedido com "Montar meia pizza" ----
w.location.hash = '#novo'; await espera(700);
doc.querySelector('#btnMeia').click(); await espera(100);
ok(doc.querySelector('#mS1').options.length === 2, 'modal de meia pizza lista os 2 sabores do tamanho Grande');
ok(/55/.test(doc.querySelector('#mPreco').textContent), 'mostra o preço da meia pizza (sabor mais caro)');
doc.querySelector('#mAdd').click(); await espera(100);
ok(doc.querySelector('.item-carrinho .topo-item').textContent.includes('½ Calabresa - Grande + ½ Mussarela - Grande'), 'meia pizza identificada no carrinho');
doc.querySelector('[data-novo-cliente]').click(); await espera(100);
const f = doc.querySelector('dialog[open] form'); f.querySelector('[name=nome]').value = 'Ana <img src=x onerror=alert(1)>'; f.querySelector('[name=telefone]').value = '11977776666'; enviar(f); await espera(700);
ok(!doc.querySelector('.cliente-chip img'), 'nome com HTML malicioso aparece como texto (sem XSS)');
doc.querySelector('#criar').click(); await espera(900);
ok(w.location.hash === '#pedidos', 'pedido criado e volta para Pedidos');
await espera(500);
const card = doc.querySelector('.coluna .card-pedido');
ok(!!card && card.textContent.includes('Meia pizza') && card.textContent.includes('½ Calabresa - Grande + ½ Mussarela - Grande'), 'cartão do pedido identifica a meia pizza e mostra os sabores');
ok(impressos.length === 1, 'comanda enviada para a impressora ao criar o pedido');

// ---- dashboard com dados + estoque ----
w.location.hash = '#dashboard'; await espera(700);
ok(doc.querySelector('.metrics-grid').textContent.includes('R$') && doc.querySelector('.barras .barra-col'), 'dashboard mostra faturamento e gráfico de 7 dias');
ok(doc.querySelector('.rank')?.textContent.includes('Calabresa'), 'dashboard lista mais vendidos');
w.location.hash = '#estoque'; await espera(700);
ok(doc.querySelector('#linhas').textContent.includes('Repor') && doc.querySelector('#novo'), 'estoque: alerta "Repor" e botão Novo insumo (admin)');

// ---- configurações (admin) ----
w.location.hash = '#config'; await espera(1200);
const paineis = [...doc.querySelectorAll('.painel h2')].map((h) => h.textContent);
ok(['Atendimento', 'Impressora', 'Backup', 'Usuários', 'Aparência', 'Minha conta', 'Sistema'].every((t) => paineis.some((p) => p.includes(t))), 'Configurações mostra todos os painéis do administrador: ' + paineis.length);
doc.querySelector('#impPrevia').click(); await espera(500);
ok(doc.querySelector('pre.cupom')?.textContent.includes('TESTE DE IMPRESS'), 'impressora: "Ver como fica" mostra o cupom de teste');
doc.querySelectorAll('dialog[open]').forEach((d) => d.close());
doc.querySelector('#bkAgora').click(); await espera(900);
ok(doc.querySelector('[data-baixar]') !== null, 'backup: "Fazer backup agora" cria e lista o arquivo');

// ---- atendente: sem telas de administrador ----
const at = await api('POST', '/api/usuarios', { nome: 'Bia', email: 'bia@majorelle.com', senha: 'Bia-Senha-456', perfil: 'atendente' }, token);
doc.querySelector('#btnSair').click(); await espera(600);
ok(visivel('#login-form') && w.localStorage.getItem('majorelle_token') === null, 'sair volta ao login e apaga o token');
digitar('#email', 'bia@majorelle.com'); digitar('#senha', 'errada-errada'); enviar(doc.querySelector('#login-form')); await espera(500);
ok(/inválidos/.test(doc.querySelector('#login-msg').textContent), 'senha errada mostra mensagem');
digitar('#senha', 'Bia-Senha-456'); enviar(doc.querySelector('#login-form')); await espera(900);
ok(doc.querySelector('#user-perfil').textContent === 'Atendente', 'atendente entrou');
w.location.hash = '#produtos'; await espera(700);
ok(!doc.querySelector('#novo') && !doc.querySelector('[data-acao="editar"]'), 'atendente não vê botões de cadastrar/editar produtos');
w.location.hash = '#config'; await espera(900);
const p2 = [...doc.querySelectorAll('.painel h2')].map((h) => h.textContent);
ok(!p2.some((t) => /Backup|Usuários|Impressora/.test(t)) && p2.some((t) => t.includes('Minha conta')), 'atendente só vê Aparência, Minha conta e Sistema');

// ---- tema ----
doc.querySelector('#btnTema').click();
ok(['dark', 'light'].includes(doc.documentElement.dataset.tema) && w.localStorage.getItem('tema') === doc.documentElement.dataset.tema, 'botão alterna e salva o tema');
ok(erros.length === 0, 'nenhum erro de JavaScript no navegador' + (erros.length ? ': ' + erros.join(' | ') : ''));
server.close(); w.close(); console.log(falhas ? `\n${falhas} FALHA(S)` : '\nTUDO OK'); process.exit(falhas ? 1 : 0);
