import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { criarApp } from '../src/app.js';
import { abrirBanco } from '../src/db/index.js';
import { criarServicoBackup } from '../src/services/backupService.js';
import { formatarReais } from '../src/services/impressaoService.js';
import { criarServicoFiscal } from '../src/services/fiscalService.js';

process.env.BCRYPT_CUSTO = '4'; // senhas mais rápidas só nos testes

const ADMIN = { nome: 'Dono', email: 'dono@majorelle.com', senha: 'Senha-Forte-123' };

// Sobe o app com banco em memória, impressora falsa e já logado como administrador.
async function iniciar({ logado = true, extra = {} } = {}) {
  const db = abrirBanco(':memory:');
  const impressos = [];
  const pastaBackups = fs.mkdtempSync(path.join(os.tmpdir(), 'pizzaria-teste-'));
  const app = criarApp(db, {
    impressora: { imprimir: async (linhas) => impressos.push(linhas) },
    fiscal: criarServicoFiscal({ ativo: false }),
    apiKey: 'segredo',
    segredo: 'segredo-de-teste-com-mais-de-32-caracteres!!',
    servicoBackup: criarServicoBackup(db, { pastaBackups }),
    ...extra,
  });
  const server = await new Promise((ok) => { const s = app.listen(0, () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const sessao = { token: null };

  // Caminhos de /auth, /n8n e /cardapio vão direto; o resto recebe o prefixo /api e o token.
  const chamar = async (metodo, caminho, corpo, headers = {}) => {
    const publico = /^\/(auth|n8n|cardapio|saude)/.test(caminho);
    const resp = await fetch(base + (publico ? caminho : '/api' + caminho), {
      method: metodo,
      headers: { 'content-type': 'application/json', ...(sessao.token ? { authorization: `Bearer ${sessao.token}` } : {}), ...headers },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const texto = await resp.text();
    let dados = null;
    try { dados = texto ? JSON.parse(texto) : null; } catch { dados = texto; }
    return { status: resp.status, dados };
  };
  if (logado) sessao.token = (await chamar('POST', '/auth/primeiro-acesso', ADMIN)).dados.token;
  return { base, chamar, impressos, db, sessao, pastaBackups, fechar: () => { server.close(); fs.rmSync(pastaBackups, { recursive: true, force: true }); } };
}

async function cadastrarBase(chamar) {
  const cliente = (await chamar('POST', '/clientes', { nome: 'Maria', telefone: '(11) 91234-5678' })).dados;
  const endereco = (await chamar('POST', `/clientes/${cliente.id}/enderecos`,
    { rua: 'Rua A', numero: '10', bairro: 'Centro' })).dados;
  const pizza = (await chamar('POST', '/produtos',
    { nome: 'Calabresa - Grande', categoria: 'pizza', preco: 55 })).dados;
  const refri = (await chamar('POST', '/produtos',
    { nome: 'Guaraná 2L', categoria: 'bebida', preco: 12 })).dados;
  return { cliente, endereco, pizza, refri };
}

test('fluxo completo: cadastro → pedido → status → impressão', async () => {
  const { chamar, impressos, fechar } = await iniciar();
  try {
    const { cliente, endereco, pizza, refri } = await cadastrarBase(chamar);
    assert.equal(cliente.telefone, '11912345678'); // normalizado

    const criado = await chamar('POST', '/pedidos', {
      cliente_id: cliente.id, endereco_id: endereco.id, tipo: 'entrega', forma_pagamento: 'pix',
      itens: [
        { produto_id: pizza.id, quantidade: 2, preco_unitario: 1 }, // preço enviado é ignorado
        { produto_id: refri.id, quantidade: 1 },
      ],
    });
    assert.equal(criado.status, 201);
    assert.equal(criado.dados.taxa_entrega, 7);
    assert.equal(criado.dados.total, 2 * 55 + 12 + 7);
    assert.equal(criado.dados.itens[0].preco_unitario, 55); // preço do banco, não o enviado
    const id = criado.dados.id;

    // pulo de status inválido
    const invalido = await chamar('PATCH', `/pedidos/${id}/status`, { status: 'entregue' });
    assert.equal(invalido.status, 422);

    for (const status of ['em_preparo', 'saiu_entrega', 'entregue']) {
      const r = await chamar('PATCH', `/pedidos/${id}/status`, { status });
      assert.equal(r.status, 200);
      assert.equal(r.dados.status, status);
    }

    const imp = await chamar('POST', `/pedidos/${id}/imprimir`, { via: 'ambas' });
    assert.equal(imp.status, 200);
    assert.equal(impressos.length, 2);
    const textoComprovante = JSON.stringify(impressos[1]);
    assert.ok(textoComprovante.includes('SEM VALOR FISCAL'));
  } finally { fechar(); }
});

test('validações: telefone duplicado, produto inativo, entrega sem endereço', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    const { cliente, pizza } = await cadastrarBase(chamar);
    const dup = await chamar('POST', '/clientes', { nome: 'Outra', telefone: '11912345678' });
    assert.equal(dup.status, 409);

    const semEndereco = await chamar('POST', '/pedidos', {
      cliente_id: cliente.id, tipo: 'entrega', forma_pagamento: 'dinheiro',
      itens: [{ produto_id: pizza.id, quantidade: 1 }],
    });
    assert.equal(semEndereco.status, 400);

    await chamar('DELETE', `/produtos/${pizza.id}`);
    const inativo = await chamar('POST', '/pedidos', {
      cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'dinheiro',
      itens: [{ produto_id: pizza.id, quantidade: 1 }],
    });
    assert.equal(inativo.status, 422);
  } finally { fechar(); }
});

test('WhatsApp: exige chave, cria pedido, imprime comanda e rejeita itens desconhecidos', async () => {
  const { chamar, impressos, fechar } = await iniciar();
  try {
    await cadastrarBase(chamar);
    const corpo = {
      telefone: '11 98888-7777', nome: 'João', tipo: 'entrega', forma_pagamento: 'pix',
      endereco: { rua: 'Rua B', numero: '25', bairro: 'Vila Nova' },
      itens: [{ nome: 'calabresa - grande', quantidade: 1, observacao: 'sem cebola' }],
    };

    const semChave = await chamar('POST', '/n8n/pedido', corpo);
    assert.equal(semChave.status, 401);

    const ok = await chamar('POST', '/n8n/pedido', corpo, { 'x-api-key': 'segredo' });
    assert.equal(ok.status, 201);
    assert.equal(ok.dados.pedido.total, 55 + 7);
    assert.equal(ok.dados.impressao, 'ok');
    assert.equal(impressos.length, 1); // só a comanda

    const desconhecido = await chamar('POST', '/n8n/pedido',
      { ...corpo, itens: [{ nome: 'Pizza de Unicórnio', quantidade: 1 }] }, { 'x-api-key': 'segredo' });
    assert.equal(desconhecido.status, 422);
    assert.deepEqual(desconhecido.dados.detalhes.nao_reconhecidos, ['Pizza de Unicórnio']);

    // cardápio é público (sem chave) e não expõe dados fiscais
    const cardapio = await chamar('GET', '/cardapio');
    assert.equal(cardapio.status, 200);
    assert.equal(cardapio.dados.itens.length, 2);
    assert.equal(cardapio.dados.itens[0].ncm, undefined);
  } finally { fechar(); }
});

test('emissão fiscal desligada e preferências editáveis', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    const { cliente, pizza } = await cadastrarBase(chamar);
    const pedido = await chamar('POST', '/pedidos', {
      cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'dinheiro',
      itens: [{ produto_id: pizza.id, quantidade: 1 }],
    });
    const nota = await chamar('POST', `/pedidos/${pedido.dados.id}/emitir-nota`);
    assert.equal(nota.dados.emitida, false);

    await chamar('PUT', '/configuracoes/taxa_entrega', { valor: '9.00' });
    const cfg = await chamar('GET', '/configuracoes');
    assert.equal(cfg.dados.taxa_entrega, '9.00');
  } finally { fechar(); }
});

test('dinheiro: valores com centavos somam certo e preço inválido é recusado', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    const { cliente } = await cadastrarBase(chamar);
    const caro = (await chamar('POST', '/produtos', { nome: 'Esfiha', categoria: 'salgado', preco: 4.9 })).dados;
    const pedido = await chamar('POST', '/pedidos', {
      cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'dinheiro',
      itens: [{ produto_id: caro.id, quantidade: 3 }],
    });
    assert.equal(pedido.dados.total, 14.7); // 3 x 4,90 sem erro de ponto flutuante

    const invalido = await chamar('POST', '/produtos', { nome: 'X', categoria: 'y', preco: 1.234 });
    assert.equal(invalido.status, 400);
  } finally { fechar(); }
});

test('cardápio é público, mas criar pedido pelo WhatsApp continua exigindo chave', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    assert.equal((await chamar('GET', '/cardapio')).status, 200);
    assert.equal((await chamar('POST', '/n8n/pedido', {})).status, 401);
  } finally { fechar(); }
});

// Cria 2 pizzas grandes que permitem meia + 1 broto que não combina (tamanho diferente).
async function cadastrarPizzas(chamar) {
  const nova = async (corpo) => (await chamar('POST', '/produtos', corpo)).dados;
  return {
    calabresa: await nova({ nome: 'Calabresa G', categoria: 'pizza', preco: 55, tamanho: 'Grande', permite_meia: true }),
    mussarela: await nova({ nome: 'Mussarela G', categoria: 'pizza', preco: 48, tamanho: 'Grande', permite_meia: true }),
    broto: await nova({ nome: 'Calabresa Broto', categoria: 'pizza', preco: 30, tamanho: 'Broto', permite_meia: true }),
    refri: await nova({ nome: 'Guaraná 2L', categoria: 'bebida', preco: 12 }),
  };
}

test('meia pizza: cobra o sabor mais caro, exige mesmo tamanho e aparece na comanda', async () => {
  const { chamar, impressos, fechar } = await iniciar();
  try {
    const { cliente } = await cadastrarBase(chamar);
    const { calabresa, mussarela, broto, refri } = await cadastrarPizzas(chamar);
    const base = { cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'pix' };

    const meia = await chamar('POST', '/pedidos',
      { ...base, itens: [{ produto_id: calabresa.id, produto_id_2: mussarela.id, quantidade: 1 }] });
    assert.equal(meia.status, 201);
    assert.equal(meia.dados.total, 55); // regra "maior"
    assert.equal(meia.dados.itens[0].produto_2_nome, 'Mussarela G');

    await chamar('POST', `/pedidos/${meia.dados.id}/imprimir`, { via: 'comanda' });
    assert.ok(JSON.stringify(impressos[0]).includes('1/2 Calabresa G + 1/2 Mussarela G'));

    // regra "media" vira preferência editável
    await chamar('PUT', '/configuracoes/regra_preco_meia', { valor: 'media' });
    const media = await chamar('POST', '/pedidos',
      { ...base, itens: [{ produto_id: calabresa.id, produto_id_2: mussarela.id, quantidade: 1 }] });
    assert.equal(media.dados.total, 51.5);

    const tamanhos = await chamar('POST', '/pedidos',
      { ...base, itens: [{ produto_id: calabresa.id, produto_id_2: broto.id, quantidade: 1 }] });
    assert.equal(tamanhos.status, 422);

    const naoPermite = await chamar('POST', '/pedidos',
      { ...base, itens: [{ produto_id: calabresa.id, produto_id_2: refri.id, quantidade: 1 }] });
    assert.equal(naoPermite.status, 422);
  } finally { fechar(); }
});

test('estoque: baixa por ficha técnica (meia = metade), alerta, bloqueio e estorno no cancelamento', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    const { cliente } = await cadastrarBase(chamar);
    const { calabresa, mussarela } = await cadastrarPizzas(chamar);
    const base = { cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'pix' };

    const queijo = (await chamar('POST', '/insumos',
      { nome: 'Mussarela', unidade: 'kg', estoque_atual: 2, estoque_minimo: 1 })).dados;
    await chamar('PUT', `/produtos/${calabresa.id}/ficha-tecnica`, { itens: [{ insumo_id: queijo.id, quantidade: 0.4 }] });
    await chamar('PUT', `/produtos/${mussarela.id}/ficha-tecnica`, { itens: [{ insumo_id: queijo.id, quantidade: 0.6 }] });

    // 1 pizza inteira de calabresa: 0,4 kg → sobra 1,6
    const inteira = await chamar('POST', '/pedidos', { ...base, itens: [{ produto_id: calabresa.id, quantidade: 1 }] });
    assert.equal((await chamar('GET', `/insumos/${queijo.id}`)).dados.estoque_atual, 1.6);
    assert.deepEqual(inteira.dados.alertas_estoque, []);

    // meia calabresa + meia mussarela: 0,2 + 0,3 = 0,5 → sobra 1,1; ainda acima do mínimo
    const meia = await chamar('POST', '/pedidos',
      { ...base, itens: [{ produto_id: calabresa.id, produto_id_2: mussarela.id, quantidade: 1 }] });
    assert.equal((await chamar('GET', `/insumos/${queijo.id}`)).dados.estoque_atual, 1.1);

    // mais uma inteira de mussarela (0,6) → sobra 0,5, abaixo do mínimo: gera alerta
    const baixo = await chamar('POST', '/pedidos', { ...base, itens: [{ produto_id: mussarela.id, quantidade: 1 }] });
    assert.equal(baixo.dados.alertas_estoque[0].insumo, 'Mussarela');
    assert.equal((await chamar('GET', '/insumos?abaixo_minimo=true')).dados.length, 1);

    // cancelar devolve o estoque do pedido (0,6)
    await chamar('PATCH', `/pedidos/${baixo.dados.id}/status`, { status: 'cancelado' });
    assert.equal((await chamar('GET', `/insumos/${queijo.id}`)).dados.estoque_atual, 1.1);

    // bloqueio ligado: pedido que não cabe no estoque é recusado e NADA é gravado
    await chamar('PUT', '/configuracoes/bloquear_sem_estoque', { valor: 'true' });
    const recusado = await chamar('POST', '/pedidos', { ...base, itens: [{ produto_id: mussarela.id, quantidade: 2 }] });
    assert.equal(recusado.status, 422);
    assert.equal(recusado.dados.detalhes.faltas[0].insumo, 'Mussarela');
    assert.equal((await chamar('GET', `/insumos/${queijo.id}`)).dados.estoque_atual, 1.1);
    assert.equal((await chamar('GET', '/pedidos')).dados.length, 3); // inteira, meia e a cancelada

    // reposição: entrada de 5 kg
    await chamar('POST', `/insumos/${queijo.id}/movimentacoes`, { tipo: 'entrada', quantidade: 5 });
    assert.equal((await chamar('GET', `/insumos/${queijo.id}`)).dados.estoque_atual, 6.1);
    assert.equal(meia.status, 201);
  } finally { fechar(); }
});

test('formatação de dinheiro no cupom independe do idioma do sistema', () => {
  assert.equal(formatarReais(55), 'R$ 55,00');
  assert.equal(formatarReais(1234.5), 'R$ 1.234,50');
  assert.equal(formatarReais(0.1 + 0.2), 'R$ 0,30');
});

// ======================= Login, permissões, backup, impressão =======================

test('login: primeiro acesso cria o administrador e só funciona uma vez; rotas exigem token', async () => {
  const { chamar, sessao, fechar } = await iniciar({ logado: false });
  try {
    assert.equal((await chamar('GET', '/auth/estado')).dados.precisa_criar_admin, true);
    assert.equal((await chamar('GET', '/produtos')).status, 401); // sem login

    const criado = await chamar('POST', '/auth/primeiro-acesso', ADMIN);
    assert.equal(criado.status, 201);
    assert.equal(criado.dados.usuario.perfil, 'admin');
    assert.equal((await chamar('GET', '/auth/estado')).dados.precisa_criar_admin, false);
    assert.equal((await chamar('POST', '/auth/primeiro-acesso', { ...ADMIN, email: 'outro@x.com' })).status, 403);

    sessao.token = criado.dados.token;
    assert.equal((await chamar('GET', '/auth/eu')).dados.email, 'dono@majorelle.com');
    assert.equal((await chamar('GET', '/produtos')).status, 200);
  } finally { fechar(); }
});

test('login: senha errada, e-mail em maiúsculas, bloqueio por tentativas e token falso', async () => {
  const { chamar, sessao, fechar } = await iniciar();
  try {
    sessao.token = null;
    const ok = await chamar('POST', '/auth/login', { email: ' DONO@Majorelle.com ', senha: ADMIN.senha });
    assert.equal(ok.status, 200);

    assert.equal((await chamar('POST', '/auth/login', { email: ADMIN.email, senha: 'errada' })).status, 401);
    assert.equal((await chamar('POST', '/auth/login', { email: 'ninguem@x.com', senha: 'qualquer-coisa' })).status, 401);

    // token assinado com outro segredo (o ataque que funcionava na versão anterior) é recusado
    const jwt = (await import('jsonwebtoken')).default;
    sessao.token = jwt.sign({ sub: '1', v: 1 }, 'secreta');
    assert.equal((await chamar('GET', '/produtos')).status, 401);

    sessao.token = null;
    for (let i = 0; i < 5; i++) await chamar('POST', '/auth/login', { email: 'forca@bruta.com', senha: 'x' + i });
    const bloqueado = await chamar('POST', '/auth/login', { email: 'forca@bruta.com', senha: 'outra' });
    assert.equal(bloqueado.status, 429);
  } finally { fechar(); }
});

test('usuários: atendente não altera cardápio/configurações; trocar senha derruba o login antigo', async () => {
  const { chamar, sessao, fechar } = await iniciar();
  try {
    const tokenAdmin = sessao.token;
    assert.equal((await chamar('POST', '/usuarios', { nome: 'Bia', email: 'bia@x.com', senha: '12345678' })).status, 400); // senha fraca
    const bia = await chamar('POST', '/usuarios', { nome: 'Bia', email: 'bia@x.com', senha: 'Bia-Senha-456', perfil: 'atendente' });
    assert.equal(bia.status, 201);

    sessao.token = (await chamar('POST', '/auth/login', { email: 'bia@x.com', senha: 'Bia-Senha-456' })).dados.token;
    assert.equal((await chamar('GET', '/produtos')).status, 200);
    assert.equal((await chamar('POST', '/produtos', { nome: 'X', categoria: 'y', preco: 1 })).status, 403);
    assert.equal((await chamar('PUT', '/configuracoes/taxa_entrega', { valor: '1' })).status, 403);
    assert.equal((await chamar('GET', '/usuarios')).status, 403);
    assert.equal((await chamar('GET', '/backup')).status, 403);

    // trocar a senha invalida o token antigo e devolve um novo
    const antigo = sessao.token;
    const troca = await chamar('POST', '/auth/trocar-senha', { senha_atual: 'Bia-Senha-456', nova_senha: 'Bia-Nova-789' });
    assert.equal(troca.status, 200);
    sessao.token = antigo;
    assert.equal((await chamar('GET', '/produtos')).status, 401);
    sessao.token = troca.dados.token;
    assert.equal((await chamar('GET', '/produtos')).status, 200);

    // admin desativa a Bia: o login dela deixa de valer na hora
    sessao.token = tokenAdmin;
    const lista = (await chamar('GET', '/usuarios')).dados;
    const idBia = lista.find((u) => u.email === 'bia@x.com').id;
    assert.equal((await chamar('PUT', `/usuarios/${idBia}`, { nome: 'Bia', perfil: 'atendente', ativo: false })).status, 200);
    sessao.token = troca.dados.token;
    assert.equal((await chamar('GET', '/produtos')).status, 401);

    // não dá para remover o último administrador nem desativar a si mesmo
    sessao.token = tokenAdmin;
    const idDono = lista.find((u) => u.email === ADMIN.email).id;
    assert.equal((await chamar('PUT', `/usuarios/${idDono}`, { nome: 'Dono', perfil: 'atendente', ativo: true })).status, 409);
    assert.equal((await chamar('PUT', `/usuarios/${idDono}`, { nome: 'Dono', perfil: 'admin', ativo: false })).status, 400);
  } finally { fechar(); }
});

test('Google: só entra quem já foi cadastrado; token de outro emissor é recusado', async () => {
  const crypto = await import('node:crypto');
  const jwt = (await import('jsonwebtoken')).default;
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const CLIENTE = 'meu-cliente.apps.googleusercontent.com';
  const emitir = (email, { aud = CLIENTE, ...extra } = {}) => jwt.sign({ email, email_verified: true, ...extra }, privateKey,
    { algorithm: 'RS256', keyid: 'k1', audience: aud, issuer: 'https://accounts.google.com', expiresIn: '5m' });

  const { chamar, sessao, fechar } = await iniciar({ extra: { googleClientId: CLIENTE, buscarChavesGoogle: async () => [jwk] } });
  try {
    sessao.token = null;
    assert.equal((await chamar('GET', '/auth/estado')).dados.google_client_id, CLIENTE);
    assert.equal((await chamar('POST', '/auth/google', { token: emitir('dono@majorelle.com') })).status, 200);
    const desconhecido = await chamar('POST', '/auth/google', { token: emitir('estranho@gmail.com') });
    assert.equal(desconhecido.status, 403); // não cria usuário sozinho
    assert.equal((await chamar('POST', '/auth/google', { token: emitir('dono@majorelle.com', { aud: 'outro-app' }) })).status, 401);
    assert.equal((await chamar('POST', '/auth/google', { token: emitir('dono@majorelle.com', { email_verified: false }) })).status, 401);
  } finally { fechar(); }
});

test('n8n: webhook antigo agora exige chave e calcula o total pelo cardápio', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    await chamar('POST', '/produtos', { nome: 'Pizza grande', categoria: 'pizza', preco: 50 });
    const corpo = { cliente_telefone: '11911112222', cliente_nome: 'Zé', tipo: 'retirada', forma_pagamento: 'pix',
      itens: [{ nome: 'Pizza grande', qtd: 2 }], total: 0.01 }; // total enviado é ignorado
    assert.equal((await chamar('POST', '/n8n/webhook/pedido', corpo)).status, 401);
    const ok = await chamar('POST', '/n8n/webhook/pedido', corpo, { 'x-api-key': 'segredo' });
    assert.equal(ok.status, 201);
    assert.equal(ok.dados.pedido.total, 100);
  } finally { fechar(); }
});

test('backup: cria cópia íntegra, mantém só os N mais recentes, baixa e bloqueia nomes perigosos', async () => {
  const { base, chamar, sessao, pastaBackups, fechar } = await iniciar();
  try {
    await chamar('POST', '/clientes', { nome: 'Guardar', telefone: '11999990000' });
    const feito = await chamar('POST', '/backup/agora');
    assert.equal(feito.status, 201);
    const nome = feito.dados.nome;
    assert.ok(fs.existsSync(path.join(pastaBackups, nome)));

    // a cópia realmente contém os dados
    const Database = (await import('../src/db/sqlite.js')).default;
    const copia = new Database(path.join(pastaBackups, nome));
    assert.equal(copia.prepare('SELECT COUNT(*) AS n FROM clientes').get().n, 1);
    copia.close();

    // download: exige login e entrega um arquivo SQLite de verdade
    const semLogin = await fetch(`${base}/api/backup/${nome}/baixar`);
    assert.equal(semLogin.status, 401);
    const baixado = await fetch(`${base}/api/backup/${nome}/baixar`, { headers: { authorization: `Bearer ${sessao.token}` } });
    assert.equal(baixado.status, 200);
    assert.equal(Buffer.from(await baixado.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');

    // rotação: com manter=2, só sobram 2 arquivos
    await chamar('PUT', '/configuracoes/backup_manter', { valor: '2' });
    for (const n of ['pizzaria-20200101-000001.db', 'pizzaria-20200101-000002.db', 'pizzaria-20200101-000003.db']) fs.writeFileSync(path.join(pastaBackups, n), 'x');
    await chamar('POST', '/backup/agora');
    const restantes = fs.readdirSync(pastaBackups).filter((n) => n.endsWith('.db'));
    assert.equal(restantes.length, 2);

    assert.equal((await chamar('GET', '/backup/..%2F..%2Fsegredo/baixar')).status, 400);
    const estado = (await chamar('GET', '/backup')).dados;
    assert.ok(estado.ultimo && !estado.ultimo_erro);
  } finally { fechar(); }
});

test('backup: agendador só cria quando passou o intervalo', async () => {
  const { chamar, db, fechar } = await iniciar();
  try {
    const servico = criarServicoBackup(db, { pastaBackups: fs.mkdtempSync(path.join(os.tmpdir(), 'pz-')) });
    assert.equal(servico.estaNaHora(), true); // nunca fez backup
    servico.criarBackup();
    assert.equal(servico.estaNaHora(), false); // acabou de fazer
    await chamar('PUT', '/configuracoes/backup_ativo', { valor: 'false' });
    db.prepare("UPDATE configuracoes SET valor = '2000-01-01T00:00:00.000Z' WHERE chave = 'backup_ultimo'").run();
    assert.equal(servico.estaNaHora(), false); // desligado
  } finally { fechar(); }
});

test('impressão térmica: bytes ESC/POS com acentos em CP860, sem comandos injetados e com quebra de linha', async () => {
  const { codificar, Cupom } = await import('../src/services/escpos.js');
  const { diagramar, montarComprovante, montarTeste } = await import('../src/services/impressaoService.js');

  // acentos em CP860: ç=0x87 ã=0x84 é=0x82 ½=0xAB
  assert.deepEqual(codificar('çãé½', 'cp860'), [0x87, 0x84, 0x82, 0xab]);
  assert.deepEqual(codificar('ã', 'ascii'), [0x61]); // sem acentos: vira "a"
  assert.deepEqual(codificar('a\x1bB\n', 'cp860'), [0x61, 0x20, 0x42, 0x20]); // ESC e quebra de linha viram espaço
  assert.deepEqual(codificar('😀', 'cp860'), [0x3f]);

  const bytes = new Cupom({ pagina: 'cp860' }).linha('Olá', { alinhar: 'centro' }).cortar().toBuffer();
  assert.deepEqual([...bytes.subarray(0, 5)], [0x1b, 0x40, 0x1b, 0x74, 3]); // reinicia + escolhe CP860
  assert.deepEqual([...bytes.subarray(-4)], [0x1d, 0x56, 0x42, 0x00]); // termina cortando

  // pedido com nome gigante não estoura a largura do papel de 58 mm (32 colunas)
  const pedido = { id: 7, criado_em: '2026-11-04 12:00:00', total: 99.9, taxa_entrega: 0, forma_pagamento: 'pix', notas_fiscais: [],
    itens: [{ quantidade: 1, produto_nome: 'Pizza de Frango com Catupiry e Bacon Crocante Especial', produto_2_nome: 'Calabresa', preco_unitario: 99.9 }] };
  const linhas = diagramar(montarComprovante(pedido, 'Majorelle Pizzaria'), 32);
  assert.ok(linhas.filter((l) => l.tipo === 'texto').every((l) => l.texto.length <= 32));
  assert.ok(linhas.some((l) => l.texto.includes('R$ 99,90')));
  assert.ok(diagramar(montarTeste('Loja', 48), 48).length > 5);
});

test('impressora: configuração salva na tela vale na hora; modo Windows fora do Windows dá erro claro', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    const inicial = (await chamar('GET', '/impressora')).dados;
    assert.equal(inicial.config.modo, 'console');
    assert.equal((await chamar('PUT', '/impressora', { modo: 'rede', ip: '', largura: '48', pagina: 'cp860' })).status, 400); // rede exige IP
    const salvo = await chamar('PUT', '/impressora', { modo: 'rede', ip: '192.168.0.50', porta: 9100, largura: '32', pagina: 'cp850' });
    assert.equal(salvo.dados.largura, 32);
    assert.equal(salvo.dados.pagina, 'cp850');
    assert.equal((await chamar('PUT', '/impressora', { modo: 'rede', ip: '1.2.3.4;rm', largura: '48' })).status, 400);
    assert.equal((await chamar('PUT', '/impressora', { modo: 'windows', nome: '', largura: '48' })).status, 400); // exige o nome
  } finally { fechar(); }
});

test('meia pizza: aparece identificada no pedido e no resumo da lista; assistente configura pizzas antigas', async () => {
  const { chamar, fechar } = await iniciar();
  try {
    const { cliente } = await cadastrarBase(chamar);
    const nova = async (corpo) => (await chamar('POST', '/produtos', corpo)).dados;
    // pizzas "antigas": categoria pizza, sem tamanho e sem permitir meia (o caso que não era identificado)
    const a = await nova({ nome: 'Calabresa - Grande', categoria: 'Pizza', preco: 55 });
    const b = await nova({ nome: 'Mussarela - Grande', categoria: 'Pizza', preco: 48 });
    await nova({ nome: 'Mussarela - Broto', categoria: 'Pizza', preco: 30 });

    const pendentes = (await chamar('GET', '/produtos/pizzas-nao-configuradas')).dados;
    assert.ok(pendentes.length >= 3);
    assert.equal(pendentes.find((p) => p.id === a.id).tamanho_sugerido, 'Grande');
    assert.equal(pendentes.find((p) => p.nome.includes('Broto')).tamanho_sugerido, 'Broto');

    // antes de configurar, meia pizza é recusada com mensagem clara
    const recusada = await chamar('POST', '/pedidos', { cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'pix',
      itens: [{ produto_id: a.id, produto_id_2: b.id, quantidade: 1 }] });
    assert.equal(recusada.status, 422);

    const conf = await chamar('POST', '/produtos/configurar-meia', { itens: pendentes.map((p) => ({ id: p.id, tamanho: p.tamanho_sugerido })) });
    assert.equal(conf.dados.configurados, pendentes.length);
    assert.equal((await chamar('GET', '/produtos/pizzas-nao-configuradas')).dados.length, 0);

    const ped = await chamar('POST', '/pedidos', { cliente_id: cliente.id, tipo: 'retirada', forma_pagamento: 'pix',
      itens: [{ produto_id: a.id, produto_id_2: b.id, quantidade: 2 }, { produto_id: a.id, quantidade: 1 }] });
    assert.equal(ped.status, 201);
    assert.equal(ped.dados.itens[0].meia, true);
    assert.equal(ped.dados.itens[0].descricao, '½ Calabresa - Grande + ½ Mussarela - Grande');
    assert.equal(ped.dados.itens[1].meia, false);

    const lista = (await chamar('GET', '/pedidos')).dados;
    assert.equal(lista[0].tem_meia, true);
    assert.equal(lista[0].itens_resumo[0].descricao, '½ Calabresa - Grande + ½ Mussarela - Grande');

    // dashboard conta meia pizza como 0,5 de cada sabor
    const painel = (await chamar('GET', '/dashboard/stats')).dados;
    assert.equal(painel.hoje.pedidos, 1);
    const calabresa = painel.mais_vendidos.find((m) => m.nome === 'Calabresa - Grande').quantidade;
    assert.equal(calabresa, 2); // 2 meias (=1) + 1 inteira
  } finally { fechar(); }
});

test('segurança: cabeçalhos de proteção, nada de CORS aberto e rotas desconhecidas em JSON', async () => {
  const { base, fechar } = await iniciar();
  try {
    const resp = await fetch(`${base}/auth/estado`, { headers: { origin: 'https://site-qualquer.com' } });
    assert.equal(resp.headers.get('access-control-allow-origin'), null); // qualquer site NÃO pode ler a API
    assert.equal(resp.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(resp.headers.get('x-frame-options'), 'DENY');
    assert.match(resp.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(resp.headers.get('x-powered-by'), null);

    const desconhecida = await fetch(`${base}/api/nao-existe`);
    assert.equal(desconhecida.status, 401); // nem revela quais rotas existem sem login
    const html = await fetch(`${base}/`);
    assert.equal(html.status, 200);
  } finally { fechar(); }
});
