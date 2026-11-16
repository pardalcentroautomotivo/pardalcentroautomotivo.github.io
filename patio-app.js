// Pardal | Pátio — quadro dos carros da oficina
// Computador do pátio (login patio) move os carros; a gestão só olha (celular).
(function () {
  const CFG = { url: 'https://yoiagsjlkdeghzhovztt.supabase.co', key: 'sb_publishable_HsoTKKH3MIRYrXchybWQpg_NmZHJx2j' };
  const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pardal-patio' } });
  const COLS = [
    { id: 'diag', nome: 'Entrada', sub: 'Aguardando mecânico' },
    { id: 'orc', nome: 'Orçamento', sub: 'Mecânico avaliando' },
    { id: 'pecas', nome: 'Aguardando', sub: 'Peças e terceiros' },
    { id: 'exec', nome: 'Execução', sub: 'Em serviço' },
    { id: 'entrega', nome: 'Entrega', sub: 'Pronto' }
  ];
  const CORES = ['#2f7de1', '#8e44c9', '#1f9e8a', '#d64534', '#c88a12', '#4f6b8a', '#d4508f', '#3f9b2f', '#7a5a3a', '#0f8fb5'];
  const MIN = 60000;
  const MOSTRA_VEND = ['orc', 'entrega'];   // vendedor aparece só onde ele age
  const ALERTA_ORC = 30;                   // minutos com orçamento pronto até cobrar o vendedor
  const ESPERAS = [
    { id: 'pecas', nome: 'Peças', cor: '#d9661a' },
    { id: 'pecas_pa', nome: 'Peças de Pouso Alegre', cor: '#a0522d' },
    { id: 'ret_cabecote', nome: 'Retífica · Cabeçote', cor: '#7b4fc9' },
    { id: 'ret_motor', nome: 'Retífica · Motor', cor: '#b0397a' },
    { id: 'terceiros', nome: 'Serviço de terceiros', cor: '#14806f' },
    { id: 'elevador', nome: 'Aprovado · aguardando elevador', cor: '#5b6573' }
  ];
  const ESPERAS_ANTIGAS = [{ id: 'retifica', nome: 'Retífica', cor: '#7b4fc9' }];
  const ORC_ETAPAS = [
    { id: 'elevador', nome: 'Aguardando elevador', cor: '#5b6573' },
    { id: 'montando', nome: 'Montando orçamento', cor: '#a8660a' },
    { id: 'aprovacao', nome: 'Aguardando aprovação', cor: '#2c5fb3' }
  ];
  const etapaDe = id => ORC_ETAPAS.find(x => x.id === id);
  const esperaDe = id => ESPERAS.concat(ESPERAS_ANTIGAS).find(x => x.id === id);
  // horário combinado de entrega com o cliente
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  function quandoEntregar(iso) {
    const d = new Date(iso), hoje = new Date(), am = new Date(); am.setDate(am.getDate() + 1);
    const dia = ymd(d) === ymd(hoje) ? 'hoje' : ymd(d) === ymd(am) ? 'amanhã' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return dia + ' ' + hora(d.getTime());
  }
  const ALERTA_ENTREGA = 30;               // minutos pronto na Entrega até destacar quem avisa o cliente
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const hm = ms => { const m = Math.round(Math.abs(ms) / MIN); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + String(m % 60).padStart(2, '0'); };
  const hora = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  let ME = { edita: false }, mecs = [], vends = [], carros = [], arr = null, aviso = '';

  function ok(r) { if (r.error) throw new Error(traduz(r.error.message)); return r.data; }
  function traduz(m) {
    if (/Invalid login/i.test(m)) return 'Usuário ou senha errados.';
    if (/patio_/i.test(m) && /does not exist|schema cache|not find/i.test(m)) return 'Falta rodar o arquivo 025_patio.sql no Supabase.';
    if (/row-level security|permission/i.test(m)) return 'Este login não pode mexer no quadro.';
    if (/fetch|network/i.test(m)) return 'Sem internet. O quadro tenta de novo sozinho.';
    return m;
  }
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 3500); }

  // ---------- login ----------
  async function iniciar() {
    const { data } = await sb.auth.getSession();
    if (!data.session) return telaLogin();
    try {
      const uid = data.session.user.id;
      const a = ok(await sb.from('patio_acesso').select('modo').eq('user_id', uid).maybeSingle());
      let pode = !!a, edita = !!(a && a.modo === 'edita');
      if (!pode) { const p = await sb.rpc('adm_papel'); pode = p.data === 'gestao'; }
      if (!pode) return telaSemAcesso(data.session.user.email);
      ME = { edita, email: data.session.user.email };
      await carregar(); montar();
      sb.channel('patio').on('postgres_changes', { event: '*', schema: 'public', table: 'patio_carros' }, () => { if (!arr && !$('.fundo')) carregar().then(render).catch(() => {}); }).subscribe();
      setInterval(() => { if (!arr && !$('.fundo')) carregar().then(render).catch(e => { aviso = e.message; render(); }); }, ME.edita ? 60000 : 30000);
      setInterval(tic, 15000); tic();
      if (ME.edita) { try { navigator.wakeLock && navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {} }
    } catch (e) { telaErro(e.message); }
  }
  function telaLogin(msg) {
    document.body.className = 'login';
    $('#app').innerHTML = `<form class="caixa" id="lg"><div class="marca">Pardal <span>|</span> Pátio</div>
      <label for="lg-u">Usuário ou e-mail<input id="lg-u" autocomplete="username" autocapitalize="none" required></label>
      <label for="lg-s">Senha<input id="lg-s" type="password" autocomplete="current-password" required></label>
      ${msg ? `<div class="erro">${esc(msg)}</div>` : ''}<button class="bt pri">Entrar</button>
      <p class="dica">Computador da oficina: entre com o usuário <b>patio</b>. Gestão: mesmo login dos outros sistemas.</p></form>`;
    $('#lg').onsubmit = async e => {
      e.preventDefault(); let u = $('#lg-u').value.trim(); if (!u.includes('@')) u = u.toLowerCase() + '@pardal.local';
      const b = e.target.querySelector('button'); b.disabled = true; b.textContent = 'Entrando…';
      const r = await sb.auth.signInWithPassword({ email: u, password: $('#lg-s').value });
      if (r.error) return telaLogin(traduz(r.error.message));
      location.reload();
    };
    setTimeout(() => $('#lg-u').focus(), 50);
  }
  function telaSemAcesso(email) {
    $('#app').innerHTML = `<div class="caixa"><div class="marca">Pardal <span>|</span> Pátio</div><p>O login <b>${esc(email)}</b> não tem acesso ao quadro do pátio.</p><button class="bt" id="sair">Sair</button></div>`;
    $('#sair').onclick = sair;
  }
  function telaErro(m) {
    $('#app').innerHTML = `<div class="caixa"><div class="marca">Pardal <span>|</span> Pátio</div><div class="erro">${esc(m)}</div><button class="bt pri" onclick="location.reload()">Tentar de novo</button> <button class="bt" id="sair">Sair</button></div>`;
    $('#sair').onclick = sair;
  }
  async function sair() { await sb.auth.signOut(); location.reload(); }

  // ---------- dados ----------
  async function carregar() {
    mecs = ok(await sb.from('patio_mecanicos').select('*').order('ordem').order('nome'));
    vends = ok(await sb.from('patio_vendedores').select('*').order('nome'));
    carros = ok(await sb.from('patio_carros').select('*').eq('ativo', true).order('desde')).map(c => ({ ...c, desdeMs: new Date(c.desde).getTime() })).sort((a, b) => chave(a) - chave(b));
    aviso = '';
  }
  // posição do cartão dentro da coluna: 'ordem' quando alguém arrastou; senão, a hora em que entrou na coluna
  const chave = c => c.ordem != null ? +c.ordem : c.desdeMs;
  function ordemEm(col, antesDe, semId) {
    const cs = carros.filter(c => c.coluna === col && c.id !== semId).sort((a, b) => chave(a) - chave(b));
    const i = antesDe == null ? cs.length : cs.findIndex(c => c.id === antesDe);
    const ant = i > 0 ? chave(cs[i - 1]) : null, prox = i >= 0 && i < cs.length ? chave(cs[i]) : null;
    if (ant == null && prox == null) return null;
    if (prox == null) return Math.max(ant + 1000, Date.now());
    if (ant == null) return prox - 60000;
    return (ant + prox) / 2;
  }
  async function reordenar(c, ordem) {
    c.ordem = ordem; carros.sort((a, b) => chave(a) - chave(b)); render();
    try { ok(await sb.from('patio_carros').update({ ordem }).eq('id', c.id)); } catch (e) { toast(e.message); await carregar(); render(); }
  }
  const mecDe = id => mecs.find(m => m.id === id);
  const vendDe = id => vends.find(v => v.id === id);
  async function mover(c, para, ordem) {
    const de = c.coluna, desde = new Date().toISOString();
    const up = { coluna: para, desde, ordem: ordem == null ? null : ordem };
    if (para !== 'exec') up.dur_min = null;
    up.orc_pronto_em = null; up.espera = null; up.orc_etapa = para === 'orc' ? 'elevador' : null;   // mudou de coluna: zera "orçamento pronto" e o motivo da espera
    Object.assign(c, up, { desdeMs: Date.now() }); carros.sort((a, b) => chave(a) - chave(b)); render();
    try {
      ok(await sb.from('patio_carros').update(up).eq('id', c.id));
      sb.from('patio_mov').insert({ carro_id: c.id, de, para, mecanico_id: c.mecanico_id }).then(() => {});
    } catch (e) { toast(e.message); await carregar(); render(); return; }
    if (para === 'exec') abrir(c, 'exec');
    else if (para !== 'diag' && !c.mecanico_id) abrir(c, 'mec');   // saiu da Entrada sem mecânico: pergunta quem pegou
    else if (para === 'pecas') abrir(c, 'espera');                 // entrou em Aguardando: peças, retífica ou terceiros?
  }

  // ---------- tela ----------
  function montar() {
    document.body.className = ME.edita ? 'estacao' : 'visao';
    $('#app').innerHTML = `<div class="app"><header>
      <div class="marca">Pardal <span>|</span> Pátio</div>
      ${ME.edita ? '' : '<span class="demo">Só visualização</span>'}
      <div class="leg" id="leg"></div>
      ${ME.edita ? '<button class="bt pri" id="novo">+ Carro</button>' : ''}
      <button class="bt" id="menu" aria-label="Opções">☰</button>
      <div class="relogio" id="relogio">--:--</div></header>
      <div class="aviso" id="aviso" hidden></div>
      <main class="quadro" id="quadro"></main></div>`;
    if (ME.edita) $('#novo').onclick = () => abrir(null);
    $('#menu').onclick = menu;
    if (ME.edita) ligarArrasto();
    $('#quadro').addEventListener('click', e => { if (ME.edita) return; const el = e.target.closest('.card'); if (el) detalhe(carros.find(c => c.id === +el.dataset.id)); });
    render();
  }
  // ---------- avisos sonoros (só faltando 15 min e quando passa do tempo; repete a cada 15 min atrasado) ----------
  const SOM = { on: true, ctx: null, vistos: {}, chama: {} };
  try { SOM.on = localStorage.getItem('patio-som') !== '0'; } catch (e) {}
  function audio() {
    const A = window.AudioContext || window.webkitAudioContext; if (!A) return null;
    if (!SOM.ctx) { try { SOM.ctx = new A(); } catch (e) { return null; } }
    if (SOM.ctx.state === 'suspended') SOM.ctx.resume().catch(() => {});
    return SOM.ctx;
  }
  document.addEventListener('pointerdown', () => audio());
  function bipe(tipo) {
    if (!SOM.on) return; const a = audio(); if (!a) return;
    const notas = tipo === 'atraso' ? [880, 660, 880, 660] : [880, 1175];
    notas.forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain(), t0 = a.currentTime + i * 0.26;
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
      o.connect(g); g.connect(a.destination); o.start(t0); o.stop(t0 + 0.24);
    });
  }
  function setSom(v) { SOM.on = v; try { localStorage.setItem('patio-som', v ? '1' : '0'); } catch (e) {} if (v) { audio(); bipe('alerta'); } }
  // lista = [{ id, restante (ms), chave (muda quando o tempo é relançado) }]
  function checarAlertas(lista) {
    let toca = null;
    for (const x of lista) {
      if (x.so15 !== false && x.restante > 0 && x.restante <= 15 * 60000) {
        const k = x.chave + '|15'; if (!SOM.vistos[k]) { SOM.vistos[k] = 1; SOM.chama[x.id] = Date.now() + 15000; toca = toca || 'alerta'; }
      } else if (x.restante <= 0) {
        const k = x.chave + '|late|' + Math.floor(-x.restante / (15 * 60000)); if (!SOM.vistos[k]) { SOM.vistos[k] = 1; SOM.chama[x.id] = Date.now() + 15000; toca = 'atraso'; }
      }
    }
    if (toca) bipe(toca);
  }
  const chamando = id => (SOM.chama[id] || 0) > Date.now();
  const barra = (passou, total, cls) => `<span class="barra" aria-hidden="true"><i class="${cls}" style="width:${Math.max(3, Math.min(100, passou / total * 100)).toFixed(1)}%"></i></span>`;
  const CORES_CARRO = ['Branco', 'Prata', 'Preto', 'Cinza', 'Vermelho', 'Azul'];
  const OBS_PRONTAS = [{ n: 'Peça veio errada', cor: '#c0392b' }, { n: 'Falta peça', cor: '#d9661a' }, { n: 'Aguardando cliente', cor: '#2c7a7b' }];
  const corObs = t => (OBS_PRONTAS.find(x => x.n === t) || {}).cor;
  function tempoDe(c) {
    if (c.coluna !== 'exec' || !c.dur_min) return null;
    const r = c.desdeMs + c.dur_min * MIN - Date.now();
    if (r < 0) return { cls: 'atraso', txt: 'Passou ' + hm(r) };
    if (r <= 15 * MIN) return { cls: 'alerta', txt: 'Falta ' + hm(r) };
    return { cls: 'ok', txt: 'Falta ' + hm(r) };
  }
  function card(c) {
    const m = c.coluna === 'diag' ? null : mecDe(c.mecanico_id), t = tempoDe(c);
    const bar = t ? barra(Date.now() - c.desdeMs, c.dur_min * MIN, t.cls) : '';
    const parado = !t && c.coluna !== 'entrega' && Date.now() - c.desdeMs > 60 * MIN ? `<span class="parado">nesta etapa há ${hm(Date.now() - c.desdeMs)}</span>` : '';
    const v = vendDe(c.vendedor_id), cobra = c.coluna === 'entrega' && Date.now() - c.desdeMs > ALERTA_ENTREGA * MIN;
    const prontoMs = c.coluna === 'orc' && c.orc_pronto_em ? Date.now() - new Date(c.orc_pronto_em).getTime() : null;
    const orcCobra = prontoMs != null && prontoMs > ALERTA_ORC * MIN;
    const pronto = prontoMs == null ? '' : `<span class="pronto${orcCobra ? ' cobra-orc' : ''}">${orcCobra ? 'Cobrar ' + (v ? esc(v.nome) : 'vendedor') + ' · aguardando aprovação há ' + hm(prontoMs) : 'Aguardando aprovação · ' + (v ? esc(v.nome) + ' · ' : '') + hm(prontoMs)}</span>`;
    const et = c.coluna === 'orc' && !c.orc_pronto_em ? etapaDe(c.orc_etapa) : null;
    const etapa = et ? `<span class="espera" style="background:${et.cor}">${et.nome} · há ${hm(Date.now() - c.desdeMs)}</span>` : '';
    const entMs = c.entrega_prev ? new Date(c.entrega_prev).getTime() - Date.now() : null;
    const ent = entMs == null ? '' : `<span class="entregar${entMs < 0 ? ' passou' : entMs <= 60 * MIN ? ' perto' : ''}">${entMs < 0 ? 'Entrega atrasada · era ' + quandoEntregar(c.entrega_prev) : 'Entregar ' + quandoEntregar(c.entrega_prev)}</span>`;
    const ep = c.coluna === 'pecas' ? esperaDe(c.espera) : null;
    const espera = ep ? `<span class="espera" style="background:${ep.cor}">${esc(ep.nome)} · há ${hm(Date.now() - c.desdeMs)}</span>` : '';
    const vend = v && MOSTRA_VEND.includes(c.coluna) && !pronto ? `<span class="vend${cobra ? ' cobra' : ''}">${cobra ? 'Avisar cliente · ' + esc(v.nome) + ' · pronto há ' + hm(Date.now() - c.desdeMs) : 'Vendedor: ' + esc(v.nome)}</span>` : '';
    return `<article class="card${t && t.cls === 'atraso' ? ' atrasado' : ''}${chamando(c.id) ? ' chama' : ''}" tabindex="0" data-id="${c.id}" aria-label="${esc(c.placa)} ${esc(c.carro || '')} ${esc(c.cliente || '')}">
      <span class="pl">${esc(c.placa)}</span>${m ? `<i class="mec" style="background:${esc(m.cor)}" title="${esc(m.nome)}">${esc(m.sigla)}</i>` : '<span></span>'}
      ${c.carro || c.cor ? `<span class="mod">${esc([c.carro, c.cor].filter(Boolean).join(' · '))}</span>` : ''}${c.cliente ? `<span class="cli">${esc(c.cliente)}</span>` : ''}${ent}${c.obs ? `<span class="obs"${corObs(c.obs) ? ` style="background:${corObs(c.obs)};color:#fff"` : ''} title="${esc(c.obs)}">⚠ ${esc(c.obs)}</span>` : ''}${c.servico ? `<span class="srv">${esc(c.servico)}</span>` : ''}
      ${t ? `<span class="tempo ${t.cls}">${t.txt}</span>${bar}` : ep || et ? '' : parado}${espera}${etapa}${pronto}${vend}${ME.edita && c.coluna === 'entrega' ? `<button type="button" class="sai" data-sai="${c.id}">Entregue · tirar do quadro</button>` : ''}</article>`;
  }
  function render() {
    if (!$('#quadro')) return;
    const ativos = mecs.filter(m => m.ativo);
    $('#leg').innerHTML = ativos.map(m => `<span><i class="mec mini" style="background:${esc(m.cor)}">${esc(m.sigla)}</i>${esc(m.nome)}</span>`).join('');
    const av = $('#aviso'); av.hidden = !aviso; av.textContent = aviso;
    $('#quadro').innerHTML = COLS.map(col => {
      const cs = carros.filter(c => c.coluna === col.id);
      return `<section class="col" data-col="${col.id}"><h2>${col.nome}<small>${col.sub} · ${cs.length}</small></h2><div class="lista">${cs.map(card).join('') || `<div class="vazio">${ME.edita ? 'Arraste um carro para cá' : 'Nenhum carro'}</div>`}</div></section>`;
    }).join('');
  }
  function alertas() {
    if (!ME.edita) return;
    checarAlertas(carros.filter(c => c.coluna === 'exec' && c.dur_min).map(c => ({ id: c.id, restante: c.desdeMs + c.dur_min * MIN - Date.now(), chave: c.id + '|' + c.desde + '|' + c.dur_min }))
      .concat(carros.filter(c => c.coluna === 'orc' && c.orc_pronto_em).map(c => ({ id: c.id, so15: false, restante: new Date(c.orc_pronto_em).getTime() + ALERTA_ORC * MIN - Date.now(), chave: c.id + '|orc|' + c.orc_pronto_em }))));
  }
  function tic() { alertas(); const r = $('#relogio'); if (r) r.textContent = hora(Date.now()); if (!arr && !$('.fundo')) render(); }

  // ---------- arrastar (só no computador do pátio) ----------
  function ligarArrasto() {
    const q = $('#quadro');
    q.addEventListener('pointerdown', e => {
      if (e.target.closest('.sai')) return;
      const el = e.target.closest('.card'); if (!el || e.button > 0) return;
      arr = { el, id: +el.dataset.id, x: e.clientX, y: e.clientY, mov: false };
      el.setPointerCapture(e.pointerId);
    });
    document.addEventListener('pointermove', e => {
      if (!arr) return;
      if (!arr.mov && Math.hypot(e.clientX - arr.x, e.clientY - arr.y) < 6) return;
      if (!arr.mov) {
        arr.mov = true; const r = arr.el.getBoundingClientRect();
        arr.dx = arr.x - r.left; arr.dy = arr.y - r.top;
        arr.g = arr.el.cloneNode(true); arr.g.classList.add('fantasma'); arr.g.style.width = r.width + 'px'; document.body.appendChild(arr.g);
        arr.el.style.opacity = '.3';
      }
      arr.g.style.left = (e.clientX - arr.dx) + 'px'; arr.g.style.top = (e.clientY - arr.dy) + 'px';
      document.querySelectorAll('.col').forEach(c => c.classList.remove('sobre'));
      const alvo = colEm(e); if (alvo) alvo.classList.add('sobre');
      marcarPosicao(alvo, e);
    });
    document.addEventListener('pointerup', e => {
      if (!arr) return;
      const a = arr; arr = null;
      const c = carros.find(x => x.id === a.id);
      if (!a.mov) { if (c) abrir(c); return; }
      a.g.remove(); document.querySelectorAll('.col').forEach(x => x.classList.remove('sobre'));
      const alvo = colEm(e);
      if (!alvo || !c) { render(); return; }
      const antes = cartaoAbaixo(alvo, e, c.id), col = alvo.dataset.col;
      if (col !== c.coluna) { mover(c, col, antes == null && !carros.some(x => x.coluna === col) ? null : ordemEm(col, antes, c.id)); return; }
      const cs = carros.filter(x => x.coluna === col), i = cs.indexOf(c), prox = cs[i + 1];
      if (antes === c.id || (prox ? antes === prox.id : antes == null)) { render(); return; }   // soltou no mesmo lugar
      reordenar(c, ordemEm(col, antes, c.id));
    });
    document.addEventListener('pointercancel', () => { if (arr && arr.g) arr.g.remove(); arr = null; render(); });
    // botão "Entregue" do cartão: 1º toque pede confirmação, 2º tira do quadro
    q.addEventListener('click', async e => {
      const b = e.target.closest('.sai'); if (!b) return;
      e.stopPropagation();
      const c = carros.find(x => x.id === +b.dataset.sai); if (!c) return;
      if (!b.classList.contains('conf')) { b.classList.add('conf'); b.textContent = 'Toque de novo para confirmar'; setTimeout(() => { if (b.isConnected) { b.classList.remove('conf'); b.textContent = 'Entregue · tirar do quadro'; } }, 4000); return; }
      b.disabled = true;
      try { ok(await sb.from('patio_carros').update({ ativo: false, saiu_em: new Date().toISOString() }).eq('id', c.id)); sb.from('patio_mov').insert({ carro_id: c.id, de: c.coluna, para: 'saiu', mecanico_id: c.mecanico_id }).then(() => {}); await carregar(); render(); toast(c.placa + ' entregue e fora do quadro'); } catch (err) { b.disabled = false; toast(err.message); }
    });
    q.addEventListener('keydown', e => { const el = e.target.closest('.card'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrir(carros.find(c => c.id === +el.dataset.id)); } });
  }
  // cartão que fica logo abaixo do ponto onde o carro foi solto (null = fim da coluna)
  function cartaoAbaixo(col, e, semId) {
    const els = [...col.querySelectorAll('.lista .card')].filter(el => +el.dataset.id !== semId);
    const el = els.find(el => { const r = el.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    return el ? +el.dataset.id : null;
  }
  function marcarPosicao(col, e) {
    document.querySelectorAll('.marca-pos').forEach(x => x.remove());
    if (!col || !arr) return;
    const antes = cartaoAbaixo(col, e, arr.id), lista = col.querySelector('.lista');
    const m = document.createElement('div'); m.className = 'marca-pos';
    const ref = antes == null ? null : lista.querySelector(`.card[data-id="${antes}"]`);
    lista.insertBefore(m, ref);
  }
  const colEm = e => document.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains('col'));

  // ---------- janelas ----------
  function folha(html) {
    const f = document.createElement('div'); f.className = 'fundo';
    f.innerHTML = `<div class="folha" role="dialog">${html}</div>`;
    document.body.appendChild(f);
    f.addEventListener('click', e => { if (e.target === f) f.remove(); });
    return f;
  }
  function abrir(c, motivo) {
    const entrouExec = motivo === 'exec';
    const novo = !c;
    c = c || { coluna: 'diag', placa: '', cliente: '', carro: '', cor: '', obs: '', servico: '', mecanico_id: null, dur_min: null, desdeMs: Date.now() };
    let mec = c.mecanico_id, vend = novo ? undefined : c.vendedor_id || null, tirar = false;   // carro novo: vendedor tem que ser escolhido
    const ativos = mecs.filter(m => m.ativo || m.id === mec);
    const orcEtapaIni = c.orc_pronto_em ? 'aprovacao' : c.orc_etapa || 'elevador';
    const ep0 = c.entrega_prev ? new Date(c.entrega_prev) : null, am0 = new Date(); am0.setDate(am0.getDate() + 1);
    const diaIni = !ep0 ? '' : ymd(ep0) === ymd(new Date()) ? 'hoje' : ymd(ep0) === ymd(am0) ? 'amanha' : 'outro';
    const f = folha(`<h3>${novo ? 'Novo carro' : esc(c.placa)}</h3>
      ${entrouExec ? '<p class="dica forte">Entrou em Execução. Quanto tempo o mecânico disse que leva? O tempo começa a contar agora.</p>' : motivo === 'mec' ? '<p class="dica forte">Qual mecânico pegou este carro?</p>' : motivo === 'espera' ? '<p class="dica forte">Aguardando o quê?</p>' : ''}
      ${c.coluna === 'orc' ? `<label>Situação do orçamento<div class="chips" id="f-orc">${ORC_ETAPAS.map(x => `<button type="button" class="chip${orcEtapaIni === x.id ? ' on' : ''}" data-o="${x.id}"><i class="bolinha" style="background:${x.cor}"></i>${x.nome}</button>`).join('')}</div></label>` : ''}
      ${c.coluna === 'pecas' ? `<label>Aguardando o quê?<div class="chips" id="f-esp"><button type="button" class="chip${c.espera ? '' : ' on'}" data-e="">Não definido</button>${ESPERAS.map(x => `<button type="button" class="chip${c.espera === x.id ? ' on' : ''}" data-e="${x.id}"><i class="bolinha" style="background:${x.cor}"></i>${x.nome}</button>`).join('')}</div></label>` : ''}
      <label for="f-pl">Placa<input id="f-pl" value="${esc(c.placa)}" placeholder="ABC-1D23" autocomplete="off"></label>
      <label for="f-cl">Nome do cliente<input id="f-cl" value="${esc(c.cliente || '')}" placeholder="Ex.: João Silva" autocomplete="off" maxlength="60"></label>
      <label>Horário combinado para entregar <span class="opc">(se o cliente tiver horário)</span><div class="chips" id="f-ed">${[['', 'Sem horário'], ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['outro', 'Outro dia']].map(([v, n]) => `<button type="button" class="chip${diaIni === v ? ' on' : ''}" data-d="${v}">${n}</button>`).join('')}</div><span class="obs-linha" id="f-edl"${diaIni ? '' : ' hidden'}><input type="date" id="f-edd" value="${ep0 ? ymd(ep0) : ''}"${diaIni === 'outro' ? '' : ' hidden'}><input type="time" id="f-edh" value="${ep0 ? hora(ep0.getTime()) : ''}"></span></label>
      <label for="f-ca">Carro<input id="f-ca" value="${esc(c.carro)}" placeholder="Ex.: Onix 2019" autocomplete="off"></label>
      <label>Cor do carro <span class="opc">(opcional)</span><div class="chips" id="f-cor">${CORES_CARRO.map(n => `<button type="button" class="chip${(c.cor || '') === n ? ' on' : ''}" data-c="${n}">${n}</button>`).join('')}<button type="button" class="chip${c.cor && !CORES_CARRO.includes(c.cor) ? ' on' : ''}" data-c="*">Outra</button></div><input id="f-corx" value="${c.cor && !CORES_CARRO.includes(c.cor) ? esc(c.cor) : ''}" placeholder="Qual cor?" autocomplete="off"${c.cor && !CORES_CARRO.includes(c.cor) ? '' : ' hidden'}></label>
      <label for="f-sv">Serviço (curto)<input id="f-sv" value="${esc(c.servico)}" placeholder="Ex.: Revisão 40 mil" autocomplete="off"></label>
      <label>Vendedor responsável${novo ? ' <span class="obrig">(escolha na entrada)</span>' : ''}<div class="chips" id="f-vd"><button type="button" class="chip${vend === null ? ' on' : ''}" data-v="">Sem vendedor</button>${vends.filter(v => v.ativo || v.id === vend).map(v => `<button type="button" class="chip${vend === v.id ? ' on' : ''}" data-v="${v.id}">${esc(v.nome)}</button>`).join('')}</div></label>
      ${c.coluna === 'diag' ? '<p class="dica">Mecânico: escolhido quando o carro sair da Entrada.</p>' : ''}<label${c.coluna === 'diag' ? ' hidden' : ''}>Mecânico<div class="chips" id="f-mec"><button type="button" class="chip${!mec ? ' on' : ''}" data-m="">Ninguém</button>${ativos.map(m => `<button type="button" class="chip${mec === m.id ? ' on' : ''}" data-m="${m.id}"><i class="mec mini" style="background:${esc(m.cor)}">${esc(m.sigla)}</i>${esc(m.nome)}</button>`).join('')}</div></label>
      ${c.coluna === 'exec' ? `<label>Tempo que o mecânico disse para terminar<div class="chips" id="f-pz">${[['', 'Sem tempo'], [30, '30 min'], [60, '1h'], [90, '1h30'], [120, '2h'], [180, '3h'], [240, '4h']].map(([v, n]) => `<button type="button" class="chip${String(c.dur_min || '') === String(v) ? ' on' : ''}" data-p="${v}">${n}</button>`).join('')}</div></label>
        <label for="f-pm">Ou em minutos<input id="f-pm" inputmode="numeric" value="${c.dur_min || ''}" placeholder="Ex.: 45"></label>
        <p class="dica">Conta desde que entrou em Execução (${hora(c.desdeMs)}). Fica amarelo faltando 15 min e vermelho quando passa.</p>`
        : `<p class="dica">${novo ? 'O carro entra em Entrada.' : 'O tempo do serviço é pedido quando o carro for arrastado para Execução.'}</p>`}
      <label for="f-ob">Observação <span class="opc">(aparece em destaque no cartão)</span><div class="chips" id="f-obc">${OBS_PRONTAS.map(x => `<button type="button" class="chip" data-o="${x.n}"><i class="bolinha" style="background:${x.cor}"></i>${x.n}</button>`).join('')}</div><span class="obs-linha"><input id="f-ob" value="${esc(c.obs || '')}" placeholder="Ex.: Peça veio errada, trocar com fornecedor" maxlength="120" autocomplete="off"><button type="button" class="bt" id="f-oblimpa"${c.obs ? '' : ' hidden'}>Resolvido</button></span></label>
      <div class="acoes"><button class="bt pri" id="f-ok">Salvar</button><button class="bt" id="f-x">Cancelar</button></div>
      ${novo ? '' : `<button class="bt del" id="f-del">Tirar do quadro</button><p class="dica" id="f-delmsg" hidden>Toque de novo para confirmar. O carro sai do quadro (entregue ou desistiu).</p>`}`);
    f.querySelector('#f-vd').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; vend = b.dataset.v ? +b.dataset.v : null; f.querySelectorAll('#f-vd .chip').forEach(x => x.classList.toggle('on', x === b)); });
    f.querySelector('#f-mec').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; mec = b.dataset.m ? +b.dataset.m : null; f.querySelectorAll('#f-mec .chip').forEach(x => x.classList.toggle('on', x === b)); });
    const pz = f.querySelector('#f-pz'); if (pz) pz.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; f.querySelector('#f-pm').value = b.dataset.p; pz.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); });
    let orcEtapa = orcEtapaIni, espera = c.espera || null, entDia = diaIni;
    const fd = f.querySelector('#f-ed'); fd.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; entDia = b.dataset.d; fd.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); f.querySelector('#f-edl').hidden = !entDia; f.querySelector('#f-edd').hidden = entDia !== 'outro'; if (entDia) f.querySelector(entDia === 'outro' ? '#f-edd' : '#f-edh').focus(); });
    const fo = f.querySelector('#f-orc'); if (fo) fo.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; orcEtapa = b.dataset.o; fo.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); });
    const fe = f.querySelector('#f-esp'); if (fe) fe.addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; espera = b.dataset.e || null; fe.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b)); });
    let cor = c.cor || null;
    const corx = f.querySelector('#f-corx');
    f.querySelector('#f-cor').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; const ja = b.classList.contains('on'); f.querySelectorAll('#f-cor .chip').forEach(x => x.classList.toggle('on', !ja && x === b)); const outra = !ja && b.dataset.c === '*'; corx.hidden = !outra; cor = ja ? null : outra ? null : b.dataset.c; if (outra) corx.focus(); });
    const obIn = f.querySelector('#f-ob'), obLimpa = f.querySelector('#f-oblimpa');
    obIn.addEventListener('input', () => { obLimpa.hidden = !obIn.value.trim(); });
    f.querySelector('#f-obc').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b) return; obIn.value = b.dataset.o; obLimpa.hidden = false; obIn.focus(); });
    obLimpa.onclick = () => { obIn.value = ''; obLimpa.hidden = true; };
    f.querySelector('#f-x').onclick = () => f.remove();
    const plIn = f.querySelector('#f-pl');   // placa sempre em maiúscula, já enquanto digita
    plIn.addEventListener('input', () => { const p = plIn.selectionStart; plIn.value = plIn.value.toUpperCase(); try { plIn.setSelectionRange(p, p); } catch (e) {} });
    const del = f.querySelector('#f-del');
    if (del) del.onclick = async () => {
      if (!tirar) { tirar = true; del.textContent = 'Confirmar: tirar do quadro'; f.querySelector('#f-delmsg').hidden = false; return; }
      try { ok(await sb.from('patio_carros').update({ ativo: false, saiu_em: new Date().toISOString() }).eq('id', c.id)); f.remove(); await carregar(); render(); toast(c.placa + ' saiu do quadro'); } catch (e) { toast(e.message); }
    };
    f.querySelector('#f-ok').onclick = async () => {
      const pl = f.querySelector('#f-pl').value.trim().toUpperCase(); if (!pl) { f.querySelector('#f-pl').focus(); return; }
      const norm = x => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const dup = carros.find(x => x.id !== c.id && norm(x.placa) === norm(pl));
      let dupSrv = null;
      if (!dup) { try { dupSrv = (ok(await sb.from('patio_carros').select('id,coluna,placa').eq('ativo', true)) || []).find(x => x.id !== c.id && norm(x.placa) === norm(pl)); } catch (e) {} }
      const d = dup || dupSrv;
      if (d) { f.querySelector('#f-pl').focus(); toast('A placa ' + pl + ' já está no quadro, em ' + (COLS.find(x => x.id === d.coluna) || { nome: '?' }).nome + '.'); return; }
      let entrega_prev = null;
      if (entDia) {
        const hh = f.querySelector('#f-edh').value; let dd = entDia === 'outro' ? f.querySelector('#f-edd').value : null;
        if (entDia === 'hoje') dd = ymd(new Date()); if (entDia === 'amanha') { const a = new Date(); a.setDate(a.getDate() + 1); dd = ymd(a); }
        if (!dd || !hh) { toast('Preencha o dia e a hora combinados para entregar'); f.querySelector(!dd ? '#f-edd' : '#f-edh').focus(); return; }
        entrega_prev = new Date(dd + 'T' + hh + ':00').toISOString();
      }
      if (vend === undefined) { const vd = f.querySelector('#f-vd'); vd.classList.add('falta'); toast('Escolha o vendedor responsável'); return; }
      const pmEl = f.querySelector('#f-pm'), pm = pmEl ? parseInt(pmEl.value, 10) : NaN;
      const reg = { placa: pl, cliente: f.querySelector('#f-cl').value.trim() || null, carro: f.querySelector('#f-ca').value.trim() || null, servico: f.querySelector('#f-sv').value.trim() || null, cor: corx.hidden ? cor : corx.value.trim() || null, obs: obIn.value.trim() || null, mecanico_id: c.coluna === 'diag' ? null : mec, vendedor_id: vend, dur_min: c.coluna === 'exec' && pm > 0 ? pm : null,
        entrega_prev, orc_etapa: c.coluna === 'orc' ? orcEtapa : null,
        orc_pronto_em: c.coluna === 'orc' && orcEtapa === 'aprovacao' ? c.orc_pronto_em || new Date().toISOString() : null, espera: c.coluna === 'pecas' ? espera : null };
      const b = f.querySelector('#f-ok'); b.disabled = true;
      try {
        if (novo) { const r = ok(await sb.from('patio_carros').insert({ ...reg, coluna: 'diag' }).select('id')); sb.from('patio_mov').insert({ carro_id: r[0].id, de: null, para: 'diag', mecanico_id: mec, obs: reg.obs }).then(() => {}); }
        else { ok(await sb.from('patio_carros').update(reg).eq('id', c.id)); if (c.coluna === 'orc' && reg.orc_etapa !== (c.orc_pronto_em ? 'aprovacao' : c.orc_etapa || null)) sb.from('patio_mov').insert({ carro_id: c.id, de: 'orc', para: 'orc', mecanico_id: mec, obs: etapaDe(reg.orc_etapa).nome }).then(() => {}); if (reg.espera !== (c.espera || null)) sb.from('patio_mov').insert({ carro_id: c.id, de: 'pecas', para: 'pecas', mecanico_id: mec, obs: 'Aguardando: ' + (reg.espera ? esperaDe(reg.espera).nome : 'não definido') }).then(() => {}); if ((reg.obs || null) !== (c.obs || null)) sb.from('patio_mov').insert({ carro_id: c.id, de: c.coluna, para: c.coluna, mecanico_id: mec, obs: reg.obs || '(observação resolvida)' }).then(() => {}); if (c.coluna === 'exec' && reg.dur_min) sb.from('patio_mov').insert({ carro_id: c.id, de: 'exec', para: 'exec', mecanico_id: mec, dur_min: reg.dur_min }).then(() => {}); }
        f.remove(); await carregar(); alertas(); render();
      } catch (e) { b.disabled = false; toast(e.message); }
    };
    setTimeout(() => { const i = f.querySelector(entrouExec ? '#f-pm' : motivo === 'mec' ? '#f-mec .chip' : motivo === 'espera' ? '#f-esp .chip' : '#f-pl'); i && i.focus(); }, 40);
  }
  function detalhe(c) {
    if (!c) return;
    const m = mecDe(c.mecanico_id), t = tempoDe(c), col = COLS.find(x => x.id === c.coluna);
    const f = folha(`<h3>${esc(c.placa)}</h3>
      ${c.cliente ? `<p class="dica">Cliente: <b>${esc(c.cliente)}</b></p>` : ''}
      <p>${esc([c.carro, c.cor, c.servico].filter(Boolean).join(' · '))}</p>
      ${c.obs ? `<p class="obs grande">⚠ ${esc(c.obs)}</p>` : ''}
      <p class="dica">Etapa: <b>${col.nome}</b> desde ${hora(c.desdeMs)} (há ${hm(Date.now() - c.desdeMs)})</p>
      ${c.entrega_prev ? `<p class="dica">Entrega combinada: <b>${quandoEntregar(c.entrega_prev)}</b></p>` : ''}${c.coluna === 'orc' && !c.orc_pronto_em && etapaDe(c.orc_etapa) ? `<p class="dica">Orçamento: <b>${etapaDe(c.orc_etapa).nome}</b></p>` : ''}
      ${c.coluna === 'orc' && c.orc_pronto_em ? `<p class="dica">Orçamento pronto desde <b>${hora(new Date(c.orc_pronto_em).getTime())}</b> · aguardando aprovação do cliente</p>` : ''}${c.coluna === 'pecas' && esperaDe(c.espera) ? `<p class="dica">Aguardando: <b>${esc(esperaDe(c.espera).nome)}</b></p>` : ''}
      ${m ? `<p class="dica">Mecânico: <b>${esc(m.nome)}</b></p>` : ''}${vendDe(c.vendedor_id) ? `<p class="dica">Vendedor: <b>${esc(vendDe(c.vendedor_id).nome)}</b></p>` : ''}
      ${t ? `<p class="dica">Tempo combinado: ${hm(c.dur_min * MIN)} · <b>${t.txt}</b></p>` : ''}
      <div class="acoes"><button class="bt" id="f-x">Fechar</button></div>`);
    f.querySelector('#f-x').onclick = () => f.remove();
  }
  function menu() {
    const f = folha(`<h3>Opções</h3>
      <p class="dica">Entrou como <b>${esc(ME.email)}</b>${ME.edita ? ' (computador do pátio)' : ' (só visualização)'}.</p>
      <div class="acoes col1">
        <button class="bt" id="m-tela">Tela cheia</button>
        ${ME.edita ? `<button class="bt" id="m-som">${SOM.on ? 'Som: ligado (toque para desligar)' : 'Som: desligado (toque para ligar)'}</button>` : ''}
        ${ME.edita ? '<button class="bt" id="m-mec">Mecânicos e cores</button>' : ''}
        <button class="bt" id="m-at">Atualizar agora</button>
        <button class="bt del" id="m-sair">Sair deste login</button>
        <button class="bt" id="m-x">Fechar</button></div>`);
    f.querySelector('#m-tela').onclick = () => { f.remove(); telaCheia(); };
    const ms = f.querySelector('#m-som'); if (ms) ms.onclick = () => { setSom(!SOM.on); f.remove(); toast(SOM.on ? 'Som ligado' : 'Som desligado'); };
    f.querySelector('#m-at').onclick = async () => { f.remove(); try { await carregar(); render(); toast('Quadro atualizado'); } catch (e) { toast(e.message); } };
    f.querySelector('#m-sair').onclick = sair;
    f.querySelector('#m-x').onclick = () => f.remove();
    const mb = f.querySelector('#m-mec'); if (mb) mb.onclick = () => { f.remove(); telaMecs(); };
  }
  function telaCheia() { const d = document.documentElement; try { const p = document.fullscreenElement ? document.exitFullscreen() : d.requestFullscreen(); p && p.catch && p.catch(() => {}); } catch (e) {} }
  function telaMecs() {
    const f = folha(`<h3>Mecânicos</h3><p class="dica">Sigla de até 3 letras e uma cor para cada um. Desmarque quem não está mais na oficina.</p>
      <div id="ml">${mecs.map(m => linhaMec(m)).join('')}</div>
      <div class="mrow"><input id="mn-n" placeholder="Nome do mecânico novo"><input id="mn-s" maxlength="3" placeholder="Sigla" class="sig"><button class="bt" id="mn-ok">Adicionar</button></div>
      <div class="acoes"><button class="bt pri" id="m-ok">Salvar</button><button class="bt" id="m-x">Fechar</button></div>`);
    f.querySelector('#m-x').onclick = () => f.remove();
    f.querySelector('#mn-ok').onclick = async () => {
      const n = f.querySelector('#mn-n').value.trim(), s = f.querySelector('#mn-s').value.trim().toUpperCase() || n.slice(0, 2).toUpperCase();
      if (!n) return;
      try { ok(await sb.from('patio_mecanicos').insert({ nome: n, sigla: s, cor: CORES[mecs.length % CORES.length], ordem: mecs.length + 1 })); await carregar(); f.remove(); telaMecs(); render(); } catch (e) { toast(e.message); }
    };
    f.querySelector('#m-ok').onclick = async () => {
      try {
        for (const m of mecs) {
          const row = f.querySelector(`[data-mid="${m.id}"]`);
          const up = { sigla: row.querySelector('.sig').value.trim().toUpperCase() || m.sigla, cor: row.querySelector('input[type=color]').value, ativo: row.querySelector('input[type=checkbox]').checked };
          ok(await sb.from('patio_mecanicos').update(up).eq('id', m.id));
        }
        await carregar(); render(); f.remove(); toast('Mecânicos salvos');
      } catch (e) { toast(e.message); }
    };
  }
  const linhaMec = m => `<div class="mrow" data-mid="${m.id}"><label class="chk"><input type="checkbox" ${m.ativo ? 'checked' : ''} aria-label="Ativo"> ${esc(m.nome)}</label><input class="sig" maxlength="3" value="${esc(m.sigla)}" aria-label="Sigla"><input type="color" value="${esc(m.cor)}" aria-label="Cor"></div>`;

  iniciar().catch(e => telaErro(e.message));
})();
