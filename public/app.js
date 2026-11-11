'use strict';
/* =====================================================================
   Pizzaria ERP — interface web (JavaScript puro, sem bibliotecas).
   Parte 1: utilitários, tema, modais, roteador e tela de Pedidos.
   ===================================================================== */

// ---------- Utilitários ----------
const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataUtc = (utc) => new Date(String(utc).replace(' ', 'T') + 'Z');
const hora = (utc) => dataUtc(utc).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dataHora = (utc) => dataUtc(utc).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const num = (v) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

function fone(t) {
  const d = String(t ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t;
}

// Nome de um item do pedido (meia pizza mostra os dois sabores)
const nomeItem = (i) => (i.produto_2_nome ? `½ ${i.produto_nome} + ½ ${i.produto_2_nome}` : i.produto_nome);

// Chamada à API do servidor. Rotas /auth e /cardapio são públicas; as demais vão para /api com o token de login.
// Lança Error com a mensagem amigável vinda do backend.
async function api(metodo, caminho, corpo) {
  const publico = /^\/(auth|cardapio)/.test(caminho);
  const resp = await fetch(publico ? caminho : '/api' + caminho, {
    method: metodo,
    headers: { ...(corpo ? { 'content-type': 'application/json' } : {}), ...(sessao.token ? { authorization: `Bearer ${sessao.token}` } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const texto = await resp.text();
  let dados = null;
  try { dados = texto ? JSON.parse(texto) : null; } catch { /* resposta que não é JSON */ }
  if (!resp.ok) {
    if (resp.status === 401 && sessao.token && !caminho.startsWith('/auth/')) sairDoSistema('Sua sessão expirou. Entre novamente.');
    const erro = new Error(dados?.erro || `Erro ${resp.status}`);
    erro.detalhes = dados?.detalhes;
    erro.status = resp.status;
    throw erro;
  }
  return dados;
}

// Baixa um arquivo que exige login (um link comum não consegue enviar o token).
async function baixarArquivo(caminho, nomeArquivo) {
  const resp = await fetch('/api' + caminho, { headers: { authorization: `Bearer ${sessao.token}` } });
  if (!resp.ok) throw new Error('Não consegui baixar o arquivo.');
  const url = URL.createObjectURL(await resp.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: nomeArquivo });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function mensagemErro(e) {
  let msg = e.message || 'Algo deu errado';
  const d = e.detalhes;
  if (d?.faltas) msg += '\n' + d.faltas.map((f) => `• ${f.insumo}: precisa ${num(f.necessario)} ${f.unidade}, tem ${num(f.disponivel)}`).join('\n');
  if (d?.nao_reconhecidos) msg += '\n• Não encontrado: ' + d.nao_reconhecidos.join(', ');
  return msg;
}

function aviso(msg, tipo = 'ok', ms = 4500) {
  const el = document.createElement('div');
  el.className = `aviso ${tipo}`;
  el.textContent = msg;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), ms);
}

// Envolve uma função async: se der erro, mostra um aviso vermelho em vez de quebrar.
const tentar = (fn) => async (...args) => {
  try { return await fn(...args); } catch (e) { aviso(mensagemErro(e), 'erro', 7000); }
};

const preferencia = {
  ler(chave, padrao) { try { const v = localStorage.getItem(chave); return v === null ? padrao : v; } catch { return padrao; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, valor); } catch { /* sem armazenamento: ignora */ } },
};

// ---------- Sessão (login) ----------
const CHAVE_TOKEN = 'majorelle_token';
const sessao = { token: preferencia.ler(CHAVE_TOKEN, null), usuario: null };
const ehAdmin = () => sessao.usuario?.perfil === 'admin';

// ---------- Tema claro/escuro ----------
const escuroAgora = () => {
  const t = document.documentElement.dataset.tema;
  return t === 'dark' || (t === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
};
function aplicarTema(tema) {
  document.documentElement.dataset.tema = tema;
  preferencia.gravar('tema', tema);
  $('#btnTema').innerHTML = escuroAgora() ? '<i class="ph ph-sun"></i>' : '<i class="ph ph-moon"></i>';
}

// ---------- Modais ----------
function modal(titulo, corpoHTML, { largo = false } = {}) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal' + (largo ? ' largo' : '');
  dlg.innerHTML = `<div class="modal-cab"><h2>${esc(titulo)}</h2><button class="icone" data-fechar aria-label="Fechar">✕</button></div><div class="modal-corpo">${corpoHTML}</div>`;
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-fechar]')) dlg.close(); });
  dlg.showModal();
  return dlg;
}

function campo(rotulo, nome, { tipo = 'text', valor = '', obrigatorio = false, extra = '' } = {}) {
  return `<label>${esc(rotulo)}<input name="${nome}" type="${tipo}" value="${esc(valor)}" ${obrigatorio ? 'required' : ''} ${extra}></label>`;
}

// Modal com formulário. aoEnviar(dados, dlg) deve fechar o modal (dlg.close()) quando der certo.
function formularioModal(titulo, camposHTML, aoEnviar, { rotulo = 'Salvar', largo = false } = {}) {
  const dlg = modal(titulo,
    `<form class="form">${camposHTML}<div class="rodape"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">${esc(rotulo)}</button></div></form>`,
    { largo });
  $('form', dlg).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    await aoEnviar(Object.fromEntries(new FormData(e.target)), dlg);
  }));
  return dlg;
}

// ---------- Roteador (abas pelo #hash) ----------
const TITULOS = { dashboard: 'Painel de Controle', pedidos: 'Pedidos', novo: 'Novo pedido', produtos: 'Cardápio / Produtos', clientes: 'Clientes', estoque: 'Estoque de insumos', config: 'Configurações' };
let limparTela = null; // função que a tela atual devolve para parar timers
async function navegar() {
  if (!sessao.usuario) return;
  const pedida = location.hash.slice(1) || 'dashboard';
  const aba = telas[pedida] ? pedida : 'dashboard';
  if (limparTela) { limparTela(); limparTela = null; }
  $$('#menu a').forEach((a) => a.classList.toggle('active', a.dataset.aba === aba));
  $('#page-title').textContent = TITULOS[aba];
  const el = $('#tela');
  el.innerHTML = '<p class="vazio">Carregando…</p>';
  try {
    limparTela = (await telas[aba](el)) || null;
  } catch (e) {
    if (sessao.usuario) el.innerHTML = `<p class="vazio erro">${esc(mensagemErro(e))}</p>`;
  }
}

// ---------- Tela: Pedidos (quadro cozinha/balcão) ----------
const COLUNAS = [
  { status: 'recebido', titulo: '🆕 Recebidos' },
  { status: 'em_preparo', titulo: '👨‍🍳 Em preparo' },
  { status: 'saiu_entrega', titulo: '🛵 Saiu para entrega' },
];
const NOME_STATUS = { recebido: 'Recebido', em_preparo: 'Em preparo', saiu_entrega: 'Saiu para entrega', entregue: 'Entregue', cancelado: 'Cancelado' };
const NOME_PGTO = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_credito: 'Cartão de crédito', cartao_debito: 'Cartão de débito' };

// Próxima ação do pedido: [novoStatus, rótulo do botão]
function proximaAcao(p) {
  if (p.status === 'recebido') return ['em_preparo', 'Iniciar preparo'];
  if (p.status === 'em_preparo') return p.tipo === 'entrega' ? ['saiu_entrega', 'Saiu p/ entrega'] : ['entregue', 'Entregue'];
  if (p.status === 'saiu_entrega') return ['entregue', 'Entregue'];
  return null;
}

const cardPedido = (p) => {
  const prox = proximaAcao(p);
  return `<article class="card-pedido" data-id="${p.id}">
    <div class="linha"><strong>#${p.id}</strong>
      <span class="acoes"><span class="tag">${p.tipo === 'entrega' ? '🛵 Entrega' : '🏪 Retirada'}</span>${p.tem_meia ? '<span class="tag meia">🍕½ Meia pizza</span>' : ''}</span>
      <span class="hora">${hora(p.criado_em)}</span></div>
    <div><strong>${esc(p.cliente_nome)}</strong></div>
    <ul class="resumo">${(p.itens_resumo ?? []).map((i) => `<li>${i.quantidade}× ${esc(i.descricao)}</li>`).join('')}</ul>
    <div class="linha"><strong>${brl(p.total)}</strong>
      <span class="acoes">
        <button class="btn peq" data-acao="ver">Detalhes</button>
        ${prox ? `<button class="btn peq primario" data-acao="avancar" data-status="${prox[0]}">${prox[1]}</button>` : `<span class="selo ${p.status === 'cancelado' ? 'erro' : 'ok'}">${NOME_STATUS[p.status]}</span>`}
      </span></div>
  </article>`;
};

async function telaPedidos(el) {
  el.innerHTML = `
    <div class="barra"><h1>Pedidos</h1><span class="dica" id="atualizado"></span><button class="btn" id="btnAtualizar">↻ Atualizar</button><a class="btn primario" href="#novo">➕ Novo pedido</a></div>
    <div class="quadro" id="quadro"></div>
    <details class="finalizados"><summary>Finalizados e cancelados</summary><div id="finalizados" style="margin-top:.8rem"></div></details>`;

  async function carregar() {
    const status = ['recebido', 'em_preparo', 'saiu_entrega', 'entregue', 'cancelado'];
    const [rec, prep, saiu, ent, canc] = await Promise.all(status.map((s) => api('GET', `/pedidos?status=${s}`)));
    const porStatus = { recebido: rec, em_preparo: prep, saiu_entrega: saiu };
    $('#quadro').innerHTML = COLUNAS.map((c) => `
      <section class="coluna"><h2>${c.titulo} <span class="contador">${porStatus[c.status].length}</span></h2>
      ${porStatus[c.status].map(cardPedido).join('') || '<p class="vazio">Nenhum pedido</p>'}</section>`).join('');
    const fim = [...ent, ...canc].sort((a, b) => b.id - a.id).slice(0, 20);
    $('#finalizados').innerHTML = fim.map(cardPedido).join('') || '<p class="vazio">Nada por aqui ainda</p>';
    $('#atualizado').textContent = 'Atualizado às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  el.addEventListener('click', tentar(async (e) => {
    const botao = e.target.closest('[data-acao]');
    if (!botao) return;
    const id = botao.closest('.card-pedido').dataset.id;
    if (botao.dataset.acao === 'ver') await abrirPedido(id, carregar);
    if (botao.dataset.acao === 'avancar') { await api('PATCH', `/pedidos/${id}/status`, { status: botao.dataset.status }); await carregar(); }
  }));
  $('#btnAtualizar').addEventListener('click', tentar(carregar));

  await carregar();
  const timer = setInterval(() => { if (!document.hidden && !document.querySelector('dialog[open]')) carregar().catch(() => {}); }, 10000);
  return () => clearInterval(timer);
}

async function abrirPedido(id, aoMudar) {
  const p = await api('GET', `/pedidos/${id}`);
  const prox = proximaAcao(p);
  const e = p.endereco;
  const dlg = modal(`Pedido #${p.id}`, `
    <p><span class="selo ${p.status === 'cancelado' ? 'erro' : p.status === 'entregue' ? 'ok' : 'alerta'}">${NOME_STATUS[p.status]}</span>
       <span class="tag">${p.tipo === 'entrega' ? '🛵 Entrega' : '🏪 Retirada'}</span> <span class="hora">${dataHora(p.criado_em)}</span></p>
    <p><strong>${esc(p.cliente_nome)}</strong> · ${esc(fone(p.cliente_telefone))}
       ${e ? `<br>${esc(e.rua)}, ${esc(e.numero)} — ${esc(e.bairro)}${e.complemento ? ` (${esc(e.complemento)})` : ''}` : ''}</p>
    <ul class="lista-itens">${p.itens.map((i) => `<li><strong>${i.quantidade}×</strong> ${esc(i.descricao ?? nomeItem(i))}${i.meia ? ' <span class="tag meia">½</span>' : ''}<span class="dir">${brl(i.preco_unitario * i.quantidade)}</span>${i.observacao ? `<div class="obs">obs: ${esc(i.observacao)}</div>` : ''}</li>`).join('')}</ul>
    ${p.taxa_entrega > 0 ? `<div class="linha"><span>Taxa de entrega</span><span>${brl(p.taxa_entrega)}</span></div>` : ''}
    <div class="linha"><strong>Total · ${esc(NOME_PGTO[p.forma_pagamento] ?? '')}</strong><strong>${brl(p.total)}</strong></div>
    <div class="rodape" style="justify-content:flex-start">
      <button class="btn" data-cupom="comanda">📄 Ver comanda</button>
      <button class="btn" data-cupom="comprovante">🧾 Ver comprovante</button>
      <button class="btn" data-imprimir>🖨️ Imprimir</button>
    </div>
    <div class="rodape">
      ${!['entregue', 'cancelado'].includes(p.status) ? '<button class="btn perigo" data-cancelar>Cancelar pedido</button>' : ''}
      ${prox ? `<button class="btn primario" data-avancar="${prox[0]}">${prox[1]}</button>` : ''}
    </div>`);

  dlg.addEventListener('click', tentar(async (ev) => {
    const alvo = ev.target.closest('button');
    if (!alvo) return;
    if (alvo.dataset.cupom) await previaCupom(p.id, alvo.dataset.cupom);
    if ('imprimir' in alvo.dataset) {
      await api('POST', `/pedidos/${p.id}/imprimir`, { via: 'ambas' });
      const sis = await api('GET', '/sistema');
      aviso(sis.impressora === 'console' ? 'Modo teste: o cupom foi enviado ao terminal do servidor (não há impressora real).' : 'Enviado para a impressora.');
    }
    if ('avancar' in alvo.dataset) { await api('PATCH', `/pedidos/${p.id}/status`, { status: alvo.dataset.avancar }); dlg.close(); await aoMudar(); }
    if ('cancelar' in alvo.dataset && confirm(`Cancelar o pedido #${p.id}? Os insumos serão devolvidos ao estoque.`)) {
      await api('PATCH', `/pedidos/${p.id}/status`, { status: 'cancelado' });
      dlg.close(); await aoMudar(); aviso('Pedido cancelado e estoque devolvido.', 'atencao');
    }
  }));
}

async function previaCupom(id, via) {
  const r = await api('GET', `/pedidos/${id}/cupom?via=${via}`);
  modal(via === 'comanda' ? 'Comanda (cozinha)' : 'Comprovante do cliente', `<pre class="cupom">${esc(r.texto)}</pre>`);
}

/* =====================================================================
   Parte 2: tela Novo pedido (balcão / telefone)
   ===================================================================== */
async function telaNovoPedido(el) {
  const [cardapio, config] = await Promise.all([api('GET', '/cardapio'), api('GET', '/configuracoes')]);
  const produtos = cardapio.itens;
  const categorias = [...new Set(produtos.map((p) => p.categoria))];
  const taxa = Number(config.taxa_entrega ?? 0);

  // Estado local da tela
  const carrinho = []; // { p1, p2 (meia pizza ou null), qtd, obs }
  let cliente = null;
  let enderecos = [];
  let enderecoId = null;
  let tipo = 'retirada';
  let categoria = 'todas';
  let busca = '';

  // Preço estimado (o valor oficial é calculado pelo servidor ao criar o pedido)
  const precoLinha = (l) => {
    if (!l.p2) return l.p1.preco;
    return cardapio.regra_preco_meia === 'media' ? Math.round((l.p1.preco + l.p2.preco) * 50) / 100 : Math.max(l.p1.preco, l.p2.preco);
  };
  const subtotal = () => carrinho.reduce((s, l) => s + precoLinha(l) * l.qtd, 0);

  el.innerHTML = `
    <div class="novo">
      <section class="painel">
        <div class="barra"><h1>Cardápio</h1><input id="busca" type="search" placeholder="Buscar produto…"><button type="button" class="btn" id="btnMeia">🍕½ Montar meia pizza</button></div>
        <div class="chips" id="chips"></div>
        <div class="grade" id="grade"></div>
      </section>
      <aside class="painel carrinho">
        <h2>🧾 Pedido</h2>
        <div id="clienteBox"></div>
        <div id="itensBox"></div>
        <label>Tipo do pedido
          <div class="seg" id="tipo"><button type="button" data-v="retirada" class="ativo">🏪 Retirada</button><button type="button" data-v="entrega">🛵 Entrega</button></div>
        </label>
        <div id="enderecoBox"></div>
        <label>Pagamento
          <select id="pgto"><option value="dinheiro">Dinheiro</option><option value="pix">Pix</option><option value="cartao_credito">Cartão de crédito</option><option value="cartao_debito">Cartão de débito</option></select>
        </label>
        <div class="totais" id="totais"></div>
        <button class="btn primario grande" id="criar">Criar pedido</button>
      </aside>
    </div>`;

  // ----- Cardápio -----
  function desenharCardapio() {
    $('#chips').innerHTML = ['todas', ...categorias].map((c) => `<button class="chip ${c === categoria ? 'ativo' : ''}" data-cat="${esc(c)}">${c === 'todas' ? 'Todas' : esc(c)}</button>`).join('');
    const lista = produtos.filter((p) => (categoria === 'todas' || p.categoria === categoria) && p.nome.toLowerCase().includes(busca.toLowerCase()));
    $('#grade').innerHTML = lista.map((p) => `
      <button class="prod ${p.disponivel ? '' : 'indisp'}" data-id="${p.id}" ${p.disponivel ? '' : 'disabled'}>
        <span class="nome">${esc(p.nome)}</span>
        <span><span class="preco">${brl(p.preco)}</span> ${p.tamanho ? `<span class="tag">${esc(p.tamanho)}</span>` : ''} ${p.permite_meia ? '<span class="tag">½</span>' : ''}</span>
        ${p.disponivel ? '' : '<small>Indisponível</small>'}
      </button>`).join('') || '<p class="vazio">Nenhum produto encontrado</p>';
  }

  $('#chips').addEventListener('click', (e) => { const c = e.target.closest('[data-cat]'); if (c) { categoria = c.dataset.cat; desenharCardapio(); } });
  $('#busca').addEventListener('input', (e) => { busca = e.target.value; desenharCardapio(); });
  $('#grade').addEventListener('click', (e) => {
    const b = e.target.closest('[data-id]');
    if (!b) return;
    const p = produtos.find((x) => x.id === Number(b.dataset.id));
    if (p.permite_meia) escolherInteiraOuMeia(p); else somar(p, null);
  });

  function somar(p1, p2) {
    const igual = carrinho.find((l) => l.p1.id === p1.id && (l.p2?.id ?? null) === (p2?.id ?? null));
    if (igual) igual.qtd += 1; else carrinho.push({ p1, p2, qtd: 1, obs: '' });
    desenharCarrinho();
  }

  // Botão "Montar meia pizza": escolhe o tamanho e os dois sabores de uma vez.
  function montarMeiaModal() {
    const elegiveis = produtos.filter((x) => x.permite_meia && x.tamanho && x.disponivel);
    const tamanhos = [...new Set(elegiveis.map((x) => x.tamanho))];
    if (!tamanhos.some((t) => elegiveis.filter((x) => x.tamanho === t).length >= 2)) {
      modal('Montar meia pizza', `<p class="vazio">Ainda não há pizzas suficientes configuradas para meia pizza.<br>${ehAdmin() ? 'Vá em <a href="#produtos" data-fechar>Cardápio / Produtos</a> e use o assistente de meia pizza.' : 'Peça a um administrador para configurar em Produtos.'}</p>`);
      return;
    }
    const dlg = modal('🍕½ Montar meia pizza', `
      <label>Tamanho<select id="mTam">${tamanhos.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
      <div class="form-2col"><label>1ª metade<select id="mS1"></select></label><label>2ª metade<select id="mS2"></select></label></div>
      <p id="mPreco" class="dica"></p>
      <div class="rodape"><button type="button" class="btn" data-fechar>Cancelar</button><button type="button" class="btn primario" id="mAdd">Adicionar ao pedido</button></div>`);
    const lista = () => elegiveis.filter((x) => x.tamanho === $('#mTam', dlg).value);
    const escolhidos = () => [lista().find((x) => x.id === Number($('#mS1', dlg).value)), lista().find((x) => x.id === Number($('#mS2', dlg).value))];
    function atualizarPreco() {
      const [a, b] = escolhidos();
      if (!a || !b) return;
      $('#mPreco', dlg).textContent = a.id === b.id ? 'Escolha dois sabores diferentes.'
        : `Preço da meia pizza: ${brl(precoLinha({ p1: a, p2: b }))} (${cardapio.regra_preco_meia === 'media' ? 'média dos dois sabores' : 'cobra o sabor mais caro'})`;
    }
    function preencher() {
      const opcoes = lista().map((x) => `<option value="${x.id}">${esc(x.nome)} (${brl(x.preco)})</option>`).join('');
      $('#mS1', dlg).innerHTML = opcoes; $('#mS2', dlg).innerHTML = opcoes;
      if (lista().length > 1) $('#mS2', dlg).selectedIndex = 1;
      atualizarPreco();
    }
    $('#mTam', dlg).addEventListener('change', preencher);
    $('#mS1', dlg).addEventListener('change', atualizarPreco);
    $('#mS2', dlg).addEventListener('change', atualizarPreco);
    $('#mAdd', dlg).addEventListener('click', () => {
      const [a, b] = escolhidos();
      if (!a || !b || a.id === b.id) return aviso('Escolha dois sabores diferentes.', 'atencao');
      somar(a, b); dlg.close();
    });
    preencher();
  }
  $('#btnMeia').addEventListener('click', montarMeiaModal);

  // Pizza que aceita meia: pergunta se é inteira ou meia e, se meia, qual o outro sabor.
  function escolherInteiraOuMeia(p) {
    const dlg = modal(p.nome, `<p>Como o cliente quer essa pizza?</p>
      <div class="rodape" style="justify-content:flex-start"><button class="btn primario" data-inteira>🍕 Inteira</button><button class="btn" data-meia>🍕½ Meia pizza</button></div>`);
    dlg.addEventListener('click', (e) => {
      if (e.target.closest('[data-inteira]')) { somar(p, null); dlg.close(); }
      if (e.target.closest('[data-meia]')) {
        const outros = produtos.filter((x) => x.id !== p.id && x.permite_meia && x.tamanho === p.tamanho && x.disponivel);
        $('.modal-corpo', dlg).innerHTML = `<p>Metade <strong>${esc(p.nome)}</strong> + metade de:</p>` +
          (outros.length ? `<div class="resultados" style="max-height:none">${outros.map((o) => `<button data-outro="${o.id}">${esc(o.nome)} <small>(${brl(o.preco)})</small></button>`).join('')}</div>`
            : '<p class="vazio">Não há outro sabor deste tamanho que permita meia pizza.</p>');
      }
      const outro = e.target.closest('[data-outro]');
      if (outro) { somar(p, produtos.find((x) => x.id === Number(outro.dataset.outro))); dlg.close(); }
    });
  }

  // ----- Carrinho -----
  function desenharCarrinho() {
    $('#itensBox').innerHTML = carrinho.length ? carrinho.map((l, i) => `
      <div class="item-carrinho" data-i="${i}">
        <div class="topo-item"><span>${esc(l.p2 ? `½ ${l.p1.nome} + ½ ${l.p2.nome}` : l.p1.nome)}</span><span>${brl(precoLinha(l) * l.qtd)}</span></div>
        <div class="linha">
          <span class="qtd"><button type="button" data-mais="-1" aria-label="Diminuir">−</button><strong>${l.qtd}</strong><button type="button" data-mais="1" aria-label="Aumentar">+</button></span>
          <button type="button" class="btn peq perigo" data-remover>Remover</button>
        </div>
        <input data-obs placeholder="Observação (ex.: sem cebola)" value="${esc(l.obs)}">
      </div>`).join('') : '<p class="vazio">Toque nos produtos para adicionar ao pedido</p>';
    desenharTotais();
  }
  $('#itensBox').addEventListener('click', (e) => {
    const linha = e.target.closest('[data-i]');
    if (!linha) return;
    const i = Number(linha.dataset.i);
    const mais = e.target.closest('[data-mais]');
    if (mais) { carrinho[i].qtd += Number(mais.dataset.mais); if (carrinho[i].qtd < 1) carrinho.splice(i, 1); desenharCarrinho(); }
    if (e.target.closest('[data-remover]')) { carrinho.splice(i, 1); desenharCarrinho(); }
  });
  $('#itensBox').addEventListener('input', (e) => { if (e.target.matches('[data-obs]')) carrinho[Number(e.target.closest('[data-i]').dataset.i)].obs = e.target.value; });

  function desenharTotais() {
    const sub = subtotal();
    const tx = tipo === 'entrega' ? taxa : 0;
    $('#totais').innerHTML = `<div><span>Subtotal</span><span>${brl(sub)}</span></div>
      ${tipo === 'entrega' ? `<div><span>Taxa de entrega</span><span>${brl(tx)}</span></div>` : ''}
      <div class="total"><span>Total</span><span>${brl(sub + tx)}</span></div>
      <small>Valor final calculado pelo servidor.</small>`;
  }

  // ----- Cliente -----
  function desenharCliente() {
    const box = $('#clienteBox');
    if (cliente) {
      box.innerHTML = `<div class="cliente-chip"><span>👤 <strong>${esc(cliente.nome)}</strong><br><small>${esc(fone(cliente.telefone))}</small></span><button type="button" class="btn peq" data-trocar>Trocar</button></div>`;
      return;
    }
    box.innerHTML = `<label>Cliente<input id="buscaCliente" type="search" placeholder="Buscar por nome ou telefone…" autocomplete="off"></label>
      <div id="resultadosCliente"></div><button type="button" class="btn peq" data-novo-cliente style="margin-bottom:.8rem">➕ Novo cliente</button>`;
  }
  let temporizador;
  $('#clienteBox').addEventListener('input', (e) => {
    if (!e.target.matches('#buscaCliente')) return;
    clearTimeout(temporizador);
    temporizador = setTimeout(tentar(async () => {
      const termo = e.target.value.trim();
      if (!termo) { $('#resultadosCliente').innerHTML = ''; return; }
      const lista = await api('GET', `/clientes?busca=${encodeURIComponent(termo)}`);
      $('#resultadosCliente').innerHTML = lista.length
        ? `<div class="resultados">${lista.map((c) => `<button type="button" data-cliente="${c.id}">${esc(c.nome)} <small>${esc(fone(c.telefone))}</small></button>`).join('')}</div>`
        : '<p class="dica">Nenhum cliente encontrado.</p>';
    }), 250);
  });
  $('#clienteBox').addEventListener('click', tentar(async (e) => {
    if (e.target.closest('[data-trocar]')) { cliente = null; enderecos = []; enderecoId = null; desenharCliente(); desenharEndereco(); }
    if (e.target.closest('[data-novo-cliente]')) novoClienteModal(async (c) => selecionarCliente(c.id));
    const b = e.target.closest('[data-cliente]');
    if (b) await selecionarCliente(Number(b.dataset.cliente));
  }));
  async function selecionarCliente(id) {
    const c = await api('GET', `/clientes/${id}`);
    cliente = c; enderecos = c.enderecos; enderecoId = enderecos[0]?.id ?? null;
    desenharCliente(); desenharEndereco();
  }

  // ----- Endereço (só para entrega) -----
  function desenharEndereco() {
    const box = $('#enderecoBox');
    if (tipo !== 'entrega') { box.innerHTML = ''; return; }
    if (!cliente) { box.innerHTML = '<p class="dica">Escolha o cliente para selecionar o endereço.</p>'; return; }
    box.innerHTML = `<label>Endereço de entrega
      <select id="endereco">${enderecos.map((e) => `<option value="${e.id}" ${e.id === enderecoId ? 'selected' : ''}>${esc(e.rua)}, ${esc(e.numero)} — ${esc(e.bairro)}</option>`).join('') || '<option value="">Nenhum endereço cadastrado</option>'}</select>
      </label><button type="button" class="btn peq" data-novo-endereco style="margin-bottom:.8rem">➕ Novo endereço</button>`;
  }
  $('#enderecoBox').addEventListener('change', (e) => { if (e.target.id === 'endereco') enderecoId = Number(e.target.value) || null; });
  $('#enderecoBox').addEventListener('click', (e) => {
    if (e.target.closest('[data-novo-endereco]')) {
      novoEnderecoModal(cliente.id, tentar(async (novo) => { enderecos.push(novo); enderecoId = novo.id; desenharEndereco(); }));
    }
  });

  $('#tipo').addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    tipo = b.dataset.v;
    $$('#tipo button').forEach((x) => x.classList.toggle('ativo', x === b));
    desenharEndereco(); desenharTotais();
  });

  // ----- Criar pedido -----
  $('#criar').addEventListener('click', tentar(async () => {
    if (!cliente) return aviso('Escolha ou cadastre o cliente.', 'atencao');
    if (!carrinho.length) return aviso('Adicione ao menos um produto.', 'atencao');
    if (tipo === 'entrega' && !enderecoId) return aviso('Escolha o endereço de entrega.', 'atencao');
    const botao = $('#criar');
    botao.disabled = true;
    try {
      const pedido = await api('POST', '/pedidos', {
        cliente_id: cliente.id,
        endereco_id: tipo === 'entrega' ? enderecoId : undefined,
        tipo,
        forma_pagamento: $('#pgto').value,
        itens: carrinho.map((l) => ({ produto_id: l.p1.id, produto_id_2: l.p2?.id, quantidade: l.qtd, observacao: l.obs || undefined })),
      });
      aviso(`Pedido #${pedido.id} criado — ${brl(pedido.total)}`);
      if (pedido.alertas_estoque?.length) {
        aviso('Estoque baixo:\n' + pedido.alertas_estoque.map((a) => `• ${a.insumo}: ${num(a.estoque_atual)} ${a.unidade}`).join('\n'), 'atencao', 9000);
      }
      if (preferencia.ler('imprimirAuto', 'true') === 'true') {
        await api('POST', `/pedidos/${pedido.id}/imprimir`, { via: 'comanda' }).catch(() => aviso('Não consegui imprimir a comanda.', 'atencao'));
      }
      location.hash = '#pedidos';
    } finally { botao.disabled = false; }
  }));

  desenharCardapio(); desenharCarrinho(); desenharCliente(); desenharEndereco();
}

function novoClienteModal(aoCriar) {
  formularioModal('Novo cliente', `${campo('Nome', 'nome', { obrigatorio: true })}${campo('Telefone (com DDD)', 'telefone', { tipo: 'tel', obrigatorio: true, extra: 'placeholder="(11) 91234-5678"' })}`,
    async (dados, dlg) => {
      let criado;
      try { criado = await api('POST', '/clientes', dados); } catch (e) {
        throw new Error(e.message === 'Registro duplicado' ? 'Já existe um cliente com este telefone.' : e.message);
      }
      dlg.close(); aviso('Cliente cadastrado.'); await aoCriar(criado);
    });
}

function novoEnderecoModal(clienteId, aoCriar) {
  formularioModal('Novo endereço', `${campo('Rua', 'rua', { obrigatorio: true })}
    <div class="form-2col">${campo('Número', 'numero', { obrigatorio: true })}${campo('Bairro', 'bairro', { obrigatorio: true })}</div>
    <div class="form-2col">${campo('Complemento', 'complemento')}${campo('CEP', 'cep')}</div>`,
    async (dados, dlg) => { const novo = await api('POST', `/clientes/${clienteId}/enderecos`, dados); dlg.close(); await aoCriar(novo); });
}

/* =====================================================================
   Parte 3: Clientes, Produtos (com ficha técnica), Estoque e Configurações
   ===================================================================== */

// ---------- Clientes ----------
async function telaClientes(el) {
  el.innerHTML = `
    <div class="barra"><h1>Clientes</h1><input id="busca" type="search" placeholder="Buscar por nome ou telefone…"><button class="btn primario" id="novo">➕ Novo cliente</button></div>
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Nome</th><th>Telefone</th><th>Cadastrado em</th></tr></thead><tbody id="linhas"></tbody></table></div>`;

  async function carregar() {
    const lista = await api('GET', `/clientes?busca=${encodeURIComponent($('#busca').value.trim())}`);
    $('#linhas').innerHTML = lista.map((c) => `<tr class="clicavel" data-id="${c.id}"><td>${esc(c.nome)}</td><td>${esc(fone(c.telefone))}</td><td>${dataHora(c.criado_em)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="vazio">Nenhum cliente encontrado</td></tr>';
  }
  let t;
  $('#busca').addEventListener('input', () => { clearTimeout(t); t = setTimeout(tentar(carregar), 250); });
  $('#novo').addEventListener('click', () => novoClienteModal(carregar));
  $('#linhas').addEventListener('click', (e) => { const tr = e.target.closest('[data-id]'); if (tr) abrirCliente(tr.dataset.id, carregar); });
  await carregar();
}

async function abrirCliente(id, aoMudar) {
  const c = await api('GET', `/clientes/${id}`);
  const dlg = formularioModal(`Cliente: ${c.nome}`, `
    ${campo('Nome', 'nome', { valor: c.nome, obrigatorio: true })}
    ${campo('Telefone', 'telefone', { tipo: 'tel', valor: c.telefone, obrigatorio: true })}
    <h2>Endereços</h2>
    <ul class="lista-itens">${c.enderecos.map((e) => `<li>${esc(e.rua)}, ${esc(e.numero)} — ${esc(e.bairro)}${e.complemento ? ` (${esc(e.complemento)})` : ''}</li>`).join('') || '<li class="obs">Nenhum endereço cadastrado</li>'}</ul>
    <button type="button" class="btn peq" data-novo-endereco>➕ Novo endereço</button>`,
    async (dados) => { await api('PUT', `/clientes/${id}`, dados); dlg.close(); aviso('Cliente atualizado.'); await aoMudar(); });
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-novo-endereco]')) {
      dlg.close();
      novoEnderecoModal(id, async () => { aviso('Endereço adicionado.'); await aoMudar(); abrirCliente(id, aoMudar); });
    }
  });
}

// ---------- Produtos ----------
const TAMANHOS_PADRAO = ['Broto', 'Média', 'Grande', 'Gigante', 'Família'];

async function telaProdutos(el) {
  const admin = ehAdmin();
  el.innerHTML = `
    <div class="barra"><h1>Cardápio / Produtos</h1><input id="busca" type="search" placeholder="Buscar produto…">${admin ? '<button class="btn primario" id="novo">➕ Novo produto</button>' : ''}</div>
    <div id="avisoMeia"></div>
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Produto</th><th>Categoria</th><th class="num">Preço</th><th>Meia pizza</th><th>Estoque</th><th></th></tr></thead><tbody id="linhas"></tbody></table></div>
    <p class="dica">Cada tamanho é um produto (ex.: "Calabresa - Grande"). Para vender meia pizza, marque a pizza e informe o tamanho: só sabores do mesmo tamanho podem ser combinados. Produtos inativos não aparecem no cardápio.</p>`;
  let produtos = [];

  async function carregar() {
    produtos = await api('GET', '/produtos');
    const fichas = await Promise.all(produtos.map((p) => api('GET', `/produtos/${p.id}/ficha-tecnica`)));
    produtos.forEach((p, i) => { p.fichaQtd = fichas[i].length; });
    desenhar();
    if (admin) {
      const pendentes = await api('GET', '/produtos/pizzas-nao-configuradas');
      $('#avisoMeia').innerHTML = pendentes.length
        ? `<div class="aviso-config"><span>🍕½ <strong>${pendentes.length}</strong> pizza(s) ainda não estão prontas para meia pizza (falta o tamanho).</span><button class="btn peq" id="btnAssistente">Configurar agora</button></div>` : '';
      $('#btnAssistente')?.addEventListener('click', () => assistenteMeiaModal(pendentes, carregar));
    }
  }
  function desenhar() {
    const termo = $('#busca').value.trim().toLowerCase();
    $('#linhas').innerHTML = produtos.filter((p) => p.nome.toLowerCase().includes(termo)).map((p) => `
      <tr class="${p.ativo ? '' : 'inativo'}" data-id="${p.id}">
        <td><strong>${esc(p.nome)}</strong> ${p.tamanho ? `<span class="tag">${esc(p.tamanho)}</span>` : ''} ${p.ativo ? '' : '<span class="selo erro">inativo</span>'}</td>
        <td>${esc(p.categoria)}</td><td class="num">${brl(p.preco)}</td>
        <td>${p.permite_meia ? '<span class="tag meia">🍕½ permite</span>' : /pizza/i.test(p.categoria) ? '<span class="dica">não configurada</span>' : '—'}</td>
        <td>${p.fichaQtd ? `<span class="selo ok">${p.fichaQtd} insumo(s)</span>` : '<span class="dica">sem controle</span>'}</td>
        <td class="num">${admin ? '<button class="btn peq" data-acao="ficha">Ficha técnica</button> <button class="btn peq" data-acao="editar">Editar</button>' : ''}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhum produto cadastrado</td></tr>';
  }
  $('#busca').addEventListener('input', desenhar);
  $('#novo')?.addEventListener('click', () => produtoModal(null, produtos, carregar));
  $('#linhas').addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('[data-acao]');
    if (!b) return;
    const p = produtos.find((x) => x.id === Number(b.closest('tr').dataset.id));
    if (b.dataset.acao === 'editar') produtoModal(p, produtos, carregar);
    if (b.dataset.acao === 'ficha') await fichaModal(p, carregar);
  }));
  await carregar();
}

// Assistente: configura de uma vez as pizzas antigas (tamanho sugerido pelo nome) para aceitarem meia pizza.
function assistenteMeiaModal(lista, aoSalvar) {
  const dlg = modal('Configurar meia pizza', `
    <p class="dica">Confira o tamanho de cada pizza (já sugerido pelo nome). Desmarque o que não deve ir para meia pizza.</p>
    <form id="formAssist"><div class="tabela-wrap"><table class="tabela"><tbody>
      ${lista.map((p) => `<tr data-id="${p.id}"><td><input type="checkbox" class="inc" ${p.tamanho_sugerido ? 'checked' : ''} aria-label="Incluir"></td><td>${esc(p.nome)}</td><td><input class="tam" list="tamanhosPadrao" value="${esc(p.tamanho_sugerido ?? '')}" placeholder="Tamanho"></td></tr>`).join('')}
    </tbody></table></div>
    <datalist id="tamanhosPadrao">${TAMANHOS_PADRAO.map((t) => `<option value="${t}">`).join('')}</datalist>
    <div class="rodape"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Configurar selecionadas</button></div></form>`, { largo: true });
  $('#formAssist', dlg).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const itens = $$('tbody tr', dlg).filter((tr) => $('.inc', tr).checked).map((tr) => ({ id: Number(tr.dataset.id), tamanho: $('.tam', tr).value.trim() }));
    if (!itens.length) return aviso('Marque ao menos uma pizza.', 'atencao');
    if (itens.some((i) => !i.tamanho)) return aviso('Informe o tamanho das pizzas marcadas.', 'atencao');
    await api('POST', '/produtos/configurar-meia', { itens });
    dlg.close(); aviso(`${itens.length} pizza(s) configurada(s) para meia pizza.`); await aoSalvar();
  }));
}

function produtoModal(p, todos, aoSalvar) {
  const categorias = [...new Set(todos.map((x) => x.categoria))];
  const dlg = formularioModal(p ? `Editar: ${p.nome}` : 'Novo produto', `
    ${campo('Nome', 'nome', { valor: p?.nome, obrigatorio: true })}
    <div class="form-2col">
      <label>Categoria<input name="categoria" list="cats" value="${esc(p?.categoria ?? '')}" required><datalist id="cats">${categorias.map((c) => `<option value="${esc(c)}">`).join('')}</datalist></label>
      ${campo('Preço (R$)', 'preco', { tipo: 'number', valor: p?.preco ?? '', obrigatorio: true, extra: 'step="0.01" min="0"' })}
    </div>
    <label class="linha-check"><input type="checkbox" name="permite_meia" ${p?.permite_meia ? 'checked' : ''}> 🍕½ É pizza e pode ser vendida meia a meia</label>
    <label id="grupoTamanho">Tamanho (obrigatório para meia pizza)<input name="tamanho" list="tamanhos" value="${esc(p?.tamanho ?? '')}" placeholder="Ex.: Grande"><datalist id="tamanhos">${TAMANHOS_PADRAO.map((t) => `<option value="${t}">`).join('')}</datalist></label>
    <label class="linha-check"><input type="checkbox" name="ativo" ${!p || p.ativo ? 'checked' : ''}> Ativo no cardápio</label>
    <details class="fiscal"><summary>Dados fiscais (opcional — o contador informa)</summary>
      <div class="form-2col">${campo('NCM', 'ncm', { valor: p?.ncm ?? '' })}${campo('CFOP', 'cfop', { valor: p?.cfop ?? '' })}</div>${campo('CSOSN', 'csosn', { valor: p?.csosn ?? '' })}
    </details>`,
    async (d) => {
      const corpo = { ...d, preco: Number(d.preco), permite_meia: d.permite_meia === 'on', ativo: d.ativo === 'on' };
      await api(p ? 'PUT' : 'POST', p ? `/produtos/${p.id}` : '/produtos', corpo);
      dlg.close(); aviso('Produto salvo.'); await aoSalvar();
    });
  // Produto novo com "pizza" na categoria: já vem marcado para meia pizza (dá pra desmarcar)
  const meia = $('[name=permite_meia]', dlg);
  const tamanho = $('[name=tamanho]', dlg);
  const sincronizar = () => { tamanho.required = meia.checked; };
  meia.addEventListener('change', sincronizar);
  if (!p) $('[name=categoria]', dlg).addEventListener('input', (e) => { if (/pizza/i.test(e.target.value)) { meia.checked = true; sincronizar(); } });
  sincronizar();
}

// Ficha técnica: quanto de cada insumo UMA unidade inteira do produto consome.
async function fichaModal(p, aoSalvar) {
  const [ficha, insumos] = await Promise.all([api('GET', `/produtos/${p.id}/ficha-tecnica`), api('GET', '/insumos')]);
  if (!insumos.length) {
    modal('Ficha técnica', `<p class="vazio">Cadastre primeiro os insumos (ingredientes) na aba <a href="#estoque" data-fechar>Estoque</a>.</p>`);
    return;
  }
  const linha = (f) => `<div class="form-2col linha-ficha" style="align-items:end">
      <label>Insumo<select name="insumo">${insumos.map((i) => `<option value="${i.id}" ${f?.insumo_id === i.id ? 'selected' : ''}>${esc(i.nome)} (${esc(i.unidade)})</option>`).join('')}</select></label>
      <div style="display:flex;gap:.5rem;align-items:end"><label style="flex:1">Quantidade<input name="qtd" type="number" step="0.001" min="0.001" value="${f?.quantidade ?? ''}" required></label><button type="button" class="btn perigo" data-remover style="margin-bottom:.7rem">✕</button></div>
    </div>`;
  const dlg = modal(`Ficha técnica: ${p.nome}`, `
    <p class="dica">Quanto de cada insumo <strong>uma unidade inteira</strong> usa. Meia pizza usa metade de cada sabor. Sem ficha = sem controle de estoque para este produto.</p>
    <form id="formFicha"><div id="linhasFicha">${ficha.map(linha).join('')}</div>
      <button type="button" class="btn peq" data-add>➕ Adicionar insumo</button>
      <div class="rodape"><button type="button" class="btn" data-fechar>Cancelar</button><button class="btn primario">Salvar ficha</button></div></form>`);
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-add]')) $('#linhasFicha', dlg).insertAdjacentHTML('beforeend', linha(null));
    if (e.target.closest('[data-remover]')) e.target.closest('.linha-ficha').remove();
  });
  $('#formFicha', dlg).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const itens = $$('.linha-ficha', dlg).map((l) => ({ insumo_id: Number($('[name=insumo]', l).value), quantidade: Number($('[name=qtd]', l).value) }));
    await api('PUT', `/produtos/${p.id}/ficha-tecnica`, { itens });
    dlg.close(); aviso('Ficha técnica salva.'); await aoSalvar();
  }));
}

// ---------- Estoque ----------
const NOME_MOV = { entrada: 'Entrada', saida_pedido: 'Saída (pedido)', estorno_pedido: 'Estorno (cancelamento)', perda: 'Perda', ajuste: 'Ajuste' };

async function telaEstoque(el) {
  el.innerHTML = `
    <div class="barra"><h1>Estoque de insumos</h1>
      <label class="linha-check" style="margin:0"><input type="checkbox" id="soRepor"> Só o que precisa repor</label>
      ${ehAdmin() ? '<button class="btn primario" id="novo">➕ Novo insumo</button>' : ''}</div>
    <div class="tabela-wrap"><table class="tabela"><thead><tr><th>Insumo</th><th class="num">Atual</th><th class="num">Mínimo</th><th>Situação</th><th></th></tr></thead><tbody id="linhas"></tbody></table></div>
    <p class="dica">O estoque é baixado automaticamente quando um pedido é criado (pela ficha técnica do produto) e devolvido se o pedido for cancelado.</p>`;
  let insumos = [];

  async function carregar() { insumos = await api('GET', `/insumos${$('#soRepor').checked ? '?abaixo_minimo=true' : ''}`); desenhar(); }
  function desenhar() {
    $('#linhas').innerHTML = insumos.map((i) => {
      const baixo = i.estoque_atual <= i.estoque_minimo;
      return `<tr data-id="${i.id}"><td><strong>${esc(i.nome)}</strong></td>
        <td class="num">${num(i.estoque_atual)} ${esc(i.unidade)}</td><td class="num">${num(i.estoque_minimo)} ${esc(i.unidade)}</td>
        <td>${i.estoque_atual < 0 ? '<span class="selo erro">Negativo</span>' : baixo ? '<span class="selo alerta">Repor</span>' : '<span class="selo ok">OK</span>'}</td>
        <td class="num"><button class="btn peq primario" data-mov="entrada">+ Entrada</button> <button class="btn peq" data-mov="perda">Perda</button> <button class="btn peq" data-mov="ajuste">Ajuste</button> <button class="btn peq" data-hist>Histórico</button> ${ehAdmin() ? '<button class="btn peq" data-editar>Editar</button>' : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="5" class="vazio">Nenhum insumo cadastrado</td></tr>';
  }
  $('#soRepor').addEventListener('change', tentar(carregar));
  $('#novo')?.addEventListener('click', () => insumoModal(null, carregar));
  $('#linhas').addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const i = insumos.find((x) => x.id === Number(b.closest('tr').dataset.id));
    if (b.dataset.mov) movimentoModal(i, b.dataset.mov, carregar);
    if ('hist' in b.dataset) await historicoModal(i);
    if ('editar' in b.dataset) insumoModal(i, carregar);
  }));
  await carregar();
}

function insumoModal(i, aoSalvar) {
  const dlg = formularioModal(i ? `Editar: ${i.nome}` : 'Novo insumo', `
    ${campo('Nome (ex.: Mussarela)', 'nome', { valor: i?.nome, obrigatorio: true })}
    <label>Unidade<select name="unidade">${['un', 'kg', 'g', 'l', 'ml'].map((u) => `<option ${i?.unidade === u ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
    <div class="form-2col">${i ? '' : campo('Estoque inicial', 'estoque_atual', { tipo: 'number', valor: 0, extra: 'step="0.001" min="0"' })}${campo('Estoque mínimo (alerta)', 'estoque_minimo', { tipo: 'number', valor: i?.estoque_minimo ?? 0, extra: 'step="0.001" min="0"' })}</div>`,
    async (d) => {
      const corpo = { ...d, estoque_minimo: Number(d.estoque_minimo) };
      if (!i) corpo.estoque_atual = Number(d.estoque_atual);
      await api(i ? 'PUT' : 'POST', i ? `/insumos/${i.id}` : '/insumos', corpo);
      dlg.close(); aviso('Insumo salvo.'); await aoSalvar();
    });
}

function movimentoModal(i, tipo, aoSalvar) {
  const titulo = { entrada: `Entrada: ${i.nome}`, perda: `Registrar perda: ${i.nome}`, ajuste: `Ajustar contagem: ${i.nome}` }[tipo];
  const dica = { entrada: 'Chegou mercadoria. A quantidade será somada.', perda: 'Estragou ou caiu. A quantidade será subtraída.', ajuste: 'Correção de contagem. Use número negativo para diminuir.' }[tipo];
  const dlg = formularioModal(titulo, `<p class="dica">${dica} (atual: ${num(i.estoque_atual)} ${esc(i.unidade)})</p>${campo(`Quantidade (${i.unidade})`, 'quantidade', { tipo: 'number', obrigatorio: true, extra: `step="0.001" ${tipo === 'ajuste' ? '' : 'min="0.001"'}` })}`,
    async (d) => { await api('POST', `/insumos/${i.id}/movimentacoes`, { tipo, quantidade: Number(d.quantidade) }); dlg.close(); aviso('Estoque atualizado.'); await aoSalvar(); });
}

async function historicoModal(i) {
  const lista = await api('GET', `/insumos/${i.id}/movimentacoes`);
  modal(`Histórico: ${i.nome}`, `<div class="tabela-wrap"><table class="tabela"><thead><tr><th>Quando</th><th>Tipo</th><th class="num">Quantidade</th><th>Pedido</th></tr></thead><tbody>
    ${lista.map((m) => `<tr><td>${dataHora(m.criado_em)}</td><td>${NOME_MOV[m.tipo] ?? esc(m.tipo)}</td><td class="num">${m.quantidade > 0 ? '+' : ''}${num(m.quantidade)} ${esc(i.unidade)}</td><td>${m.pedido_id ? '#' + m.pedido_id : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Sem movimentações</td></tr>'}
    </tbody></table></div>`, { largo: true });
}

// ---------- Dashboard ----------
const metrica = (icone, rotulo, valor, detalhe = '') => `
  <div class="card metric-card"><i class="ph ${icone} metric-icon"></i>
    <div><span class="metric-label">${esc(rotulo)}</span><h3>${valor}</h3>${detalhe ? `<small>${esc(detalhe)}</small>` : ''}</div></div>`;

async function telaDashboard(el) {
  const d = await api('GET', '/dashboard/stats');
  const maior = Math.max(1, ...d.vendas_7_dias.map((x) => x.total));
  const diaCurto = (iso) => { const [, m, dia] = iso.split('-'); return `${dia}/${m}`; };
  el.innerHTML = `
    <div class="metrics-grid">
      ${metrica('ph-currency-dollar', 'Faturamento hoje', brl(d.hoje.faturamento), `${d.hoje.pedidos} pedido(s)`)}
      ${metrica('ph-receipt', 'Faturamento no mês', brl(d.mes.faturamento), `${d.mes.pedidos} pedido(s)`)}
      ${metrica('ph-chart-line-up', 'Ticket médio (mês)', brl(d.mes.ticket_medio))}
      ${metrica('ph-hourglass', 'Pedidos em andamento', d.em_andamento, 'recebidos, em preparo ou na entrega')}
    </div>
    <div class="dash-grid">
      <section class="card"><h3>Vendas dos últimos 7 dias</h3>
        <div class="barras">${d.vendas_7_dias.map((x) => `<div class="barra-col" title="${diaCurto(x.dia)}: ${brl(x.total)} (${x.pedidos} pedido(s))">
          <div class="barra-v" style="height:${Math.round((x.total / maior) * 100)}%"></div><small>${diaCurto(x.dia)}</small></div>`).join('')}</div></section>
      <section class="card"><h3>Mais vendidos (30 dias)</h3>
        ${d.mais_vendidos.length ? `<ul class="rank">${d.mais_vendidos.map((m) => `<li><span>${esc(m.nome)}</span><strong>${num(m.quantidade)}</strong></li>`).join('')}</ul>` : '<p class="vazio">Sem vendas ainda</p>'}</section>
      <section class="card"><h3>Estoque para repor</h3>
        ${d.estoque_baixo.length ? `<ul class="rank">${d.estoque_baixo.map((i) => `<li><span>${esc(i.nome)}</span><span class="selo alerta">${num(i.estoque_atual)} ${esc(i.unidade)}</span></li>`).join('')}</ul>` : '<p class="vazio">Tudo em ordem ✅</p>'}</section>
    </div>
    <section class="card"><h3>Últimos pedidos</h3>
      <div class="tabela-wrap" style="border:0"><table class="data-table"><thead><tr><th>#</th><th>Cliente</th><th>Tipo</th><th>Status</th><th class="num">Total</th></tr></thead><tbody>
        ${d.ultimos_pedidos.map((p) => `<tr><td>#${p.id}</td><td>${esc(p.cliente_nome)}</td><td>${p.tipo === 'entrega' ? '🛵 Entrega' : '🏪 Retirada'}</td><td>${esc(NOME_STATUS[p.status])}</td><td class="num">${brl(p.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum pedido registrado ainda.</td></tr>'}
      </tbody></table></div></section>`;
}

// ---------- Configurações ----------
async function telaConfig(el) {
  el.innerHTML = '<div class="config-grid" id="painelConfig"></div>';
  const paineis = [...(ehAdmin() ? [painelPreferencias, painelImpressora, painelBackup, painelUsuarios] : []), painelAparencia, painelConta, painelSistema];
  for (const montar of paineis) {
    const secao = document.createElement('section');
    secao.className = 'painel';
    $('#painelConfig').append(secao);
    await montar(secao).catch((e) => { secao.innerHTML = `<p class="vazio erro">${esc(mensagemErro(e))}</p>`; });
  }
}

async function painelPreferencias(sec) {
  const cfg = await api('GET', '/configuracoes');
  sec.innerHTML = `<h2>🏪 Atendimento e entrega</h2><form id="formPref">
    ${campo('Nome da pizzaria (aparece no comprovante)', 'nome_loja', { valor: cfg.nome_loja, obrigatorio: true })}
    <label>Mensagem de boas-vindas (bot)<textarea name="mensagem_boas_vindas" rows="3" required>${esc(cfg.mensagem_boas_vindas)}</textarea></label>
    <div class="form-2col">${campo('Abre às', 'horario_abertura', { tipo: 'time', valor: cfg.horario_abertura, obrigatorio: true })}${campo('Fecha às', 'horario_fechamento', { tipo: 'time', valor: cfg.horario_fechamento, obrigatorio: true })}</div>
    <div class="form-2col">${campo('Tempo estimado (min)', 'tempo_estimado_min', { tipo: 'number', valor: cfg.tempo_estimado_min, obrigatorio: true, extra: 'min="1"' })}${campo('Taxa de entrega (R$)', 'taxa_entrega', { tipo: 'number', valor: cfg.taxa_entrega, obrigatorio: true, extra: 'step="0.01" min="0"' })}</div>
    <label>Preço da meia pizza
      <select name="regra_preco_meia"><option value="maior" ${cfg.regra_preco_meia === 'maior' ? 'selected' : ''}>Cobrar o sabor mais caro</option><option value="media" ${cfg.regra_preco_meia === 'media' ? 'selected' : ''}>Cobrar a média dos dois sabores</option></select></label>
    <label class="linha-check"><input type="checkbox" name="bloquear_sem_estoque" ${cfg.bloquear_sem_estoque === 'true' ? 'checked' : ''}> Recusar pedido quando faltar insumo no estoque</label>
    <button class="btn primario">Salvar preferências</button></form>`;
  $('#formPref', sec).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    d.bloquear_sem_estoque = d.bloquear_sem_estoque === 'on' ? 'true' : 'false';
    for (const [chave, valor] of Object.entries(d)) await api('PUT', `/configuracoes/${chave}`, { valor: String(valor) });
    aviso('Preferências salvas.');
  }));
}

async function painelImpressora(sec) {
  const d = await api('GET', '/impressora');
  const c = d.config;
  const nomes = [...new Set([...d.impressoras_windows, ...(c.nome ? [c.nome] : [])])];
  sec.innerHTML = `<h2>🖨️ Impressora térmica</h2><form id="formImp">
    <label>Como imprimir
      <select name="modo"><option value="console">Teste (não imprime; só mostra na tela)</option><option value="windows">Impressora instalada no Windows (USB ou compartilhada)</option><option value="rede">Impressora de rede (por IP)</option></select></label>
    <div id="gWindows">
      <label>Impressora do Windows<select name="nome">${nomes.length ? nomes.map((n) => `<option ${n === c.nome ? 'selected' : ''}>${esc(n)}</option>`).join('') : '<option value="">(nenhuma encontrada)</option>'}</select></label>
      <small>${d.plataforma !== 'win32' ? 'A lista de impressoras só aparece no Windows.' : d.erro_lista ? esc(d.erro_lista) : 'Instale a impressora no Windows antes (driver do fabricante).'}</small>
      <button type="button" class="btn peq" id="impAtualizar" style="margin:.4rem 0 .8rem">↻ Atualizar lista</button>
    </div>
    <div id="gRede" class="form-2col">${campo('IP da impressora', 'ip', { valor: c.ip, extra: 'placeholder="192.168.0.50"' })}${campo('Porta', 'porta', { tipo: 'number', valor: c.porta })}</div>
    <div class="form-2col">
      <label>Papel<select name="largura"><option value="48" ${c.largura === 48 ? 'selected' : ''}>80 mm</option><option value="32" ${c.largura === 32 ? 'selected' : ''}>58 mm</option></select></label>
      <label>Página de código (acentos)<select name="pagina"><option value="cp860" ${c.pagina === 'cp860' ? 'selected' : ''}>CP860 — português (padrão)</option><option value="cp850" ${c.pagina === 'cp850' ? 'selected' : ''}>CP850</option><option value="ascii" ${c.pagina === 'ascii' ? 'selected' : ''}>Sem acentos (mais seguro)</option></select></label></div>
    <div class="rodape" style="justify-content:flex-start;margin-top:0"><button class="btn primario">Salvar</button>
      <button type="button" class="btn" id="impTeste">🖨️ Imprimir teste</button><button type="button" class="btn" id="impPrevia">👁️ Ver como fica</button></div></form>`;
  const form = $('#formImp', sec);
  form.elements.modo.value = c.modo;
  const ajustar = () => { $('#gWindows', sec).hidden = form.elements.modo.value !== 'windows'; $('#gRede', sec).hidden = form.elements.modo.value !== 'rede'; };
  form.elements.modo.addEventListener('change', ajustar); ajustar();
  const dados = () => ({ modo: form.elements.modo.value, nome: form.elements.nome.value, ip: form.elements.ip.value, porta: Number(form.elements.porta.value) || 9100, largura: form.elements.largura.value, pagina: form.elements.pagina.value });
  form.addEventListener('submit', tentar(async (e) => { e.preventDefault(); await api('PUT', '/impressora', dados()); aviso('Impressora configurada.'); }));
  $('#impAtualizar', sec).addEventListener('click', tentar(() => painelImpressora(sec)));
  $('#impPrevia', sec).addEventListener('click', tentar(async () => {
    await api('PUT', '/impressora', dados());
    modal('Cupom de teste (pré-visualização)', `<pre class="cupom">${esc((await api('GET', '/impressora/previa')).texto)}</pre>`);
  }));
  $('#impTeste', sec).addEventListener('click', tentar(async () => {
    await api('PUT', '/impressora', dados());
    const r = await api('POST', '/impressora/teste');
    aviso(r.modo === 'console' ? 'Modo teste: nada foi impresso. Use "Ver como fica".' : 'Cupom de teste enviado para a impressora.');
  }));
}

async function painelBackup(sec) {
  const b = await api('GET', '/backup');
  const quando = (iso) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  sec.innerHTML = `<h2>💾 Backup automático</h2>
    <p>${b.ultimo ? `Último backup: <strong>${quando(b.ultimo)}</strong>` : 'Ainda não foi feito nenhum backup.'}</p>
    ${b.ultimo_erro ? `<div class="aviso-config">⚠️ ${esc(b.ultimo_erro)}</div>` : ''}
    <p class="dica">Guardados em: ${esc(b.pasta)}</p>
    <form id="formBackup" style="margin-top:.8rem">
      <label class="linha-check"><input type="checkbox" name="backup_ativo" ${b.ativo ? 'checked' : ''}> Fazer backup automaticamente</label>
      <div class="form-2col">${campo('A cada (horas)', 'backup_intervalo_horas', { tipo: 'number', valor: b.intervalo_horas, extra: 'min="1" max="168"' })}${campo('Guardar os últimos', 'backup_manter', { tipo: 'number', valor: b.manter, extra: 'min="1" max="365"' })}</div>
      ${campo('Cópia extra em outra pasta (opcional; ex.: pendrive D:\\Backups)', 'backup_pasta_extra', { valor: b.pasta_extra })}
      <div class="rodape" style="justify-content:flex-start;margin-top:0"><button class="btn primario">Salvar</button><button type="button" class="btn" id="bkAgora">Fazer backup agora</button></div></form>
    <h2 style="margin-top:1rem">Backups guardados</h2>
    ${b.arquivos.length ? `<div class="tabela-wrap"><table class="tabela"><tbody>${b.arquivos.slice(0, 8).map((f) => `<tr><td>${quando(f.criado_em)}</td><td class="num">${(f.tamanho / 1024).toFixed(0)} KB</td><td class="num"><button class="btn peq" data-baixar="${esc(f.nome)}">Baixar</button></td></tr>`).join('')}</tbody></table></div>` : '<p class="dica">Nenhum ainda.</p>'}
    <p class="dica" style="margin-top:.6rem">Guarde cópias também fora deste computador (pendrive ou nuvem). Para restaurar, veja o LEIA-ME.</p>`;
  $('#formBackup', sec).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const f = e.target;
    const valores = { backup_ativo: f.elements.backup_ativo.checked ? 'true' : 'false', backup_intervalo_horas: f.elements.backup_intervalo_horas.value, backup_manter: f.elements.backup_manter.value, backup_pasta_extra: f.elements.backup_pasta_extra.value.trim() };
    for (const [chave, valor] of Object.entries(valores)) await api('PUT', `/configuracoes/${chave}`, { valor: String(valor) });
    aviso('Configuração de backup salva.');
  }));
  $('#bkAgora', sec).addEventListener('click', tentar(async () => {
    const r = await api('POST', '/backup/agora');
    aviso(r.aviso ? `Backup feito, mas: ${r.aviso}` : 'Backup feito com sucesso.', r.aviso ? 'atencao' : 'ok', 7000);
    await painelBackup(sec);
  }));
  sec.addEventListener('click', tentar(async (e) => {
    const b2 = e.target.closest('[data-baixar]');
    if (b2) await baixarArquivo(`/backup/${encodeURIComponent(b2.dataset.baixar)}/baixar`, b2.dataset.baixar);
  }));
}

async function painelUsuarios(sec) {
  const lista = await api('GET', '/usuarios');
  sec.innerHTML = `<h2>👥 Usuários do sistema</h2>
    <div class="tabela-wrap"><table class="tabela"><tbody>${lista.map((u) => `<tr class="${u.ativo ? '' : 'inativo'}" data-id="${u.id}">
      <td><strong>${esc(u.nome)}</strong><br><small>${esc(u.email)}</small></td>
      <td>${u.perfil === 'admin' ? '<span class="selo ok">Administrador</span>' : '<span class="selo alerta">Atendente</span>'}${u.ativo ? '' : ' <span class="selo erro">desativado</span>'}</td>
      <td class="num"><button class="btn peq" data-u="editar">Editar</button> <button class="btn peq" data-u="senha">Senha</button></td></tr>`).join('')}</tbody></table></div>
    <button class="btn primario" id="novoUsuario" style="margin-top:.8rem">➕ Novo usuário</button>
    <p class="dica" style="margin-top:.6rem"><strong>Administrador</strong> faz tudo. <strong>Atendente</strong> cria e acompanha pedidos, vê clientes e estoque, mas não altera cardápio, preços, configurações nem usuários.</p>`;
  const perfilSelect = (v) => `<label>Perfil<select name="perfil"><option value="atendente" ${v === 'atendente' ? 'selected' : ''}>Atendente</option><option value="admin" ${v === 'admin' ? 'selected' : ''}>Administrador</option></select></label>`;

  $('#novoUsuario', sec).addEventListener('click', () => {
    const dlg = formularioModal('Novo usuário', `${campo('Nome', 'nome', { obrigatorio: true })}${campo('E-mail (será o login)', 'email', { tipo: 'email', obrigatorio: true })}
      ${campo('Senha (mínimo 8 caracteres)', 'senha', { tipo: 'password', obrigatorio: true, extra: 'autocomplete="new-password" minlength="8"' })}${perfilSelect('atendente')}`,
      async (d) => { await api('POST', '/usuarios', d); dlg.close(); aviso('Usuário criado.'); await painelUsuarios(sec); });
  });
  sec.addEventListener('click', tentar(async (e) => {
    const b = e.target.closest('[data-u]');
    if (!b) return;
    const u = lista.find((x) => x.id === Number(b.closest('tr').dataset.id));
    if (b.dataset.u === 'editar') {
      const dlg = formularioModal(`Editar: ${u.nome}`, `${campo('Nome', 'nome', { valor: u.nome, obrigatorio: true })}${perfilSelect(u.perfil)}
        <label class="linha-check"><input type="checkbox" name="ativo" ${u.ativo ? 'checked' : ''}> Usuário ativo (pode entrar no sistema)</label>`,
        async (d) => { await api('PUT', `/usuarios/${u.id}`, { nome: d.nome, perfil: d.perfil, ativo: d.ativo === 'on' }); dlg.close(); aviso('Usuário atualizado.'); await painelUsuarios(sec); });
    } else {
      const dlg = formularioModal(`Nova senha: ${u.nome}`, `${campo('Nova senha (mínimo 8 caracteres)', 'nova_senha', { tipo: 'password', obrigatorio: true, extra: 'autocomplete="new-password" minlength="8"' })}<small>A pessoa será desconectada e precisará entrar com a nova senha.</small>`,
        async (d) => { await api('POST', `/usuarios/${u.id}/redefinir-senha`, d); dlg.close(); aviso('Senha redefinida.'); });
    }
  }));
}

async function painelAparencia(sec) {
  const tema = document.documentElement.dataset.tema;
  sec.innerHTML = `<h2>🎨 Aparência e este aparelho</h2>
    <label>Tema<select id="selTema"><option value="auto" ${tema === 'auto' ? 'selected' : ''}>Automático (segue o aparelho)</option><option value="light" ${tema === 'light' ? 'selected' : ''}>Claro</option><option value="dark" ${tema === 'dark' ? 'selected' : ''}>Escuro</option></select></label>
    <label class="linha-check"><input type="checkbox" id="imprimirAuto" ${preferencia.ler('imprimirAuto', 'true') === 'true' ? 'checked' : ''}> Imprimir a comanda ao criar um pedido</label>
    <small>Essas opções valem só para este navegador/aparelho.</small>`;
  $('#selTema', sec).addEventListener('change', (e) => aplicarTema(e.target.value));
  $('#imprimirAuto', sec).addEventListener('change', (e) => preferencia.gravar('imprimirAuto', String(e.target.checked)));
}

async function painelConta(sec) {
  sec.innerHTML = `<h2>🔐 Minha conta</h2>
    <p><strong>${esc(sessao.usuario.nome)}</strong><br><small>${esc(sessao.usuario.email)} · ${sessao.usuario.perfil === 'admin' ? 'Administrador' : 'Atendente'}</small></p>
    <form id="formSenha" style="margin-top:.8rem">
      ${campo('Senha atual', 'senha_atual', { tipo: 'password', obrigatorio: true, extra: 'autocomplete="current-password"' })}
      ${campo('Nova senha (mínimo 8 caracteres)', 'nova_senha', { tipo: 'password', obrigatorio: true, extra: 'autocomplete="new-password" minlength="8"' })}
      <button class="btn">Trocar senha</button></form>`;
  $('#formSenha', sec).addEventListener('submit', tentar(async (e) => {
    e.preventDefault();
    const r = await api('POST', '/auth/trocar-senha', Object.fromEntries(new FormData(e.target)));
    sessao.token = r.token; preferencia.gravar(CHAVE_TOKEN, r.token); // o token antigo deixou de valer
    e.target.reset(); aviso('Senha alterada.');
  }));
}

async function painelSistema(sec) {
  const sis = await api('GET', '/sistema');
  sec.innerHTML = `<h2>🖥️ Sistema</h2><dl class="kv">
    <dt>Versão</dt><dd>${esc(sis.versao)}</dd>
    <dt>Impressora</dt><dd>${sis.impressora === 'console' ? 'Modo teste (não imprime de verdade)' : sis.impressora === 'windows' ? 'Impressora do Windows' : 'Impressora de rede'}</dd>
    <dt>Nota fiscal</dt><dd>${sis.fiscal_ativo ? 'Ativa' : 'Desativada (será ligada depois)'}</dd>
    <dt>Acesso na rede</dt><dd>${sis.enderecos.length ? sis.enderecos.map((u) => `<div>${esc(u)}</div>`).join('') : 'Sem rede detectada'}</dd></dl>
    <small>Abra um dos endereços acima no navegador de outro celular, tablet ou PC na mesma rede Wi-Fi.</small>`;
}

// ---------- Login e início ----------
const telas = { dashboard: telaDashboard, pedidos: telaPedidos, novo: telaNovoPedido, clientes: telaClientes, produtos: telaProdutos, estoque: telaEstoque, config: telaConfig };

let modoLogin = 'login'; // 'login' | 'setup' (primeiro acesso)
const mostrarTela = (qual) => {
  $('#login-screen').classList.toggle('active', qual === 'login');
  $('#dashboard-screen').classList.toggle('active', qual === 'sistema');
};

function prepararLogin(estado, mensagem = '') {
  modoLogin = estado.precisa_criar_admin ? 'setup' : 'login';
  const setup = modoLogin === 'setup';
  $('#grupo-nome').hidden = !setup;
  $('#grupo-lembrar').hidden = setup;
  $('#login-subtitulo').textContent = setup ? 'Primeiro acesso: crie o administrador' : 'Gestão de Pizzarias';
  $('#btn-login').textContent = setup ? 'Criar administrador e entrar' : 'Acessar sistema';
  $('#senha').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  $('#login-msg').textContent = mensagem;
  if (estado.google_client_id && !setup) carregarGoogle(estado.google_client_id); else $('#google-area').hidden = true;
  mostrarTela('login');
}

// Botão "Entrar com Google": só aparece se o administrador configurou o GOOGLE_CLIENT_ID.
function carregarGoogle(clientId) {
  const iniciar = () => {
    window.google.accounts.id.initialize({ client_id: clientId, callback: aoLogarGoogle });
    window.google.accounts.id.renderButton($('#google-btn'), { theme: 'outline', size: 'large', text: 'signin_with', width: 280 });
    $('#google-area').hidden = false;
  };
  if (window.google?.accounts?.id) return iniciar();
  const script = Object.assign(document.createElement('script'), { src: 'https://accounts.google.com/gsi/client', async: true, onload: iniciar });
  document.head.append(script);
}
async function aoLogarGoogle(resposta) {
  try { entrar(await api('POST', '/auth/google', { token: resposta.credential, lembrar: $('#lembrar').checked })); }
  catch (e) { $('#login-msg').textContent = e.message; }
}

function entrar(resposta) {
  sessao.token = resposta.token;
  sessao.usuario = resposta.usuario;
  preferencia.gravar(CHAVE_TOKEN, resposta.token);
  mostrarSistema();
}

function mostrarSistema() {
  mostrarTela('sistema');
  $('#user-nome').textContent = sessao.usuario.nome;
  $('#user-perfil').textContent = sessao.usuario.perfil === 'admin' ? 'Administrador' : 'Atendente';
  if (!location.hash) location.hash = '#dashboard';
  navegar();
}

function sairDoSistema(mensagem = '') {
  sessao.token = null; sessao.usuario = null;
  try { localStorage.removeItem(CHAVE_TOKEN); } catch { /* sem armazenamento */ }
  if (limparTela) { limparTela(); limparTela = null; }
  $('#tela').innerHTML = '';
  iniciarLogin(mensagem);
}

async function iniciarLogin(mensagem = '') {
  let estado;
  try { estado = await api('GET', '/auth/estado'); } catch { prepararLogin({}, 'Não consegui falar com o servidor.'); return; }
  if (!estado.precisa_criar_admin && sessao.token) {
    try { sessao.usuario = await api('GET', '/auth/eu'); mostrarSistema(); return; } catch { /* token inválido ou vencido: pede login */ }
  }
  prepararLogin(estado, mensagem);
}

document.addEventListener('DOMContentLoaded', () => {
  aplicarTema(document.documentElement.dataset.tema || 'auto');
  $('#btnTema').addEventListener('click', () => aplicarTema(escuroAgora() ? 'light' : 'dark'));
  $('#btnSair').addEventListener('click', () => sairDoSistema(''));
  window.addEventListener('hashchange', navegar);
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#login-msg'); const botao = $('#btn-login');
    msg.textContent = ''; botao.disabled = true;
    try {
      const email = $('#email').value; const senha = $('#senha').value;
      const resposta = modoLogin === 'setup'
        ? await api('POST', '/auth/primeiro-acesso', { nome: $('#nome').value, email, senha })
        : await api('POST', '/auth/login', { email, senha, lembrar: $('#lembrar').checked });
      $('#senha').value = '';
      entrar(resposta);
    } catch (err) { msg.textContent = err.message; } finally { botao.disabled = false; }
  });
  iniciarLogin();
});
