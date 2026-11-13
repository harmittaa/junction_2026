// Design prototype. Simulated coach states, scripted dialogue, invented data. No microphone, no audio, no AI, no bank connection.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const eur = n => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(n);
const qs = new URLSearchParams(location.search), root = document.documentElement;
const flat = (o, p, out = []) => { for (const k in o) if (k !== 'description') typeof o[k] === 'object' ? flat(o[k], p + k + '-', out) : out.push(`${p}${k}:${o[k]}`); return out; };
const ICON = { chev: 'm9 6 6 6-6 6', back: 'm15 6-6 6 6 6', speaker: 'M4 9v6h4l5 4V5L8 9H4zM16.5 9a4 4 0 0 1 0 6', muted: 'M4 9v6h4l5 4V5L8 9H4zM17 9l5 6M22 9l-5 6',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v5h5M12 7v5l3 2', home: 'M4 11l8-7 8 7v9H4zM10 20v-6h4v6', card: 'M3 6h18v12H3zM3 10h18', bank: 'M3 10l9-6 9 6M5 10v8M10 10v8M14 10v8M19 10v8M3 20h18',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0', send: 'M4 12h14M13 6l6 6-6 6', wave: 'M8 3c7 4-5 14 2 18M15 3c7 4-5 14 2 18' };
const D = 'M66 10C104 34 36 80 74 110';
const RIB = `<svg viewBox="0 0 120 120" aria-hidden="true"><g class="w1" transform="translate(3 0)"><path class="r" pathLength="100" d="${D}"/><path class="h" pathLength="100" d="${D}"/></g><g class="w2" transform="translate(-23 0)"><path class="r" pathLength="100" d="${D}"/><path class="h" pathLength="100" d="${D}"/></g></svg>`;
const ST = { ready: ['Ready', 'Tap to talk'], listening: ['Listening…', 'Stop and send'], thinking: ['Thinking…', ''], speaking: ['Speaking…', 'Speak instead'], celebrate: ['Check-in complete', ''] };
const icons = r => $$('[data-i]', r).forEach(e => e.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON[e.dataset.i]}"/></svg>`);
const mute = (b, on) => { b.setAttribute('aria-pressed', on); $('i', b).dataset.i = on ? 'muted' : 'speaker'; $('span', b).textContent = on ? 'Muted' : 'Sound on'; icons(b); };

const load = u => fetch(u).then(r => { if (!r.ok) throw 0; return r.json(); });
load('../design-tokens.json').catch(() => load('design-tokens.json')).then(T => {
  const c = T.color, d = (o, p, u = '') => Object.entries(o).map(([k, v]) => `--${p}-${k}:${v}${u}`).join(';');
  const type = Object.entries(T.typography.scale).map(([k, v]) => `--type-${k}-size:${v.size}px;--type-${k}-lh:${v.lineHeight}px;--type-${k}-weight:${v.weight};--type-${k}-ls:${v.letterSpacing}px`).join(';');
  const css = `:root{${Object.entries(c.brand).map(([k, v]) => `--brand-${k}:${v.value}`).join(';')};${d(T.radius, 'radius', 'px')};${d(T.spacing, 'space', 'px')};${type};--touch:${T.layout.minTouchTarget}px}` +
    `.phone{${flat(c.light, '--').join(';')}}[data-theme="dark"] .phone{${flat(c.dark, '--').join(';')}}`;
  document.head.append(Object.assign(document.createElement('style'), { textContent: css }));
  root.classList.add('tokens-ready');
  $('#tokver').textContent = 'Tokens: docs/design-tokens.json v' + T.meta.version;
  init();
}).catch(() => { $('#tokerr').hidden = false; });

function init() {
  const P = $('#proto'), beats = $$('.beats li'), v = n => $(`[name=${n}]`, P);
  let cur = 0;
  const say = t => $('#status').textContent = t;
  const show = (ph, n) => $$('.scene[data-scene]', ph).forEach(s => s.hidden = +s.dataset.scene !== n);

  // Coach screens get the same top bar and typing row; stages get the coach.
  $$('.scene[data-coach]').forEach(s => {
    s.innerHTML = `<header class="cbar"><button class="ib" type="button" data-go="0" aria-label="Back to S-mobiili"><i class="ic" data-i="back"></i></button><p class="hs title">Sponky</p>` +
      `<span class="rt"><button class="ib" type="button" data-mute aria-pressed="false"><i class="ic" data-i="speaker"></i><span>Sound on</span></button><button class="ib" type="button" data-static><i class="ic" data-i="history"></i><span>History</span></button></span></header>` +
      `<div class="cbody">${s.innerHTML}</div><div class="typing"><label><span class="visually-hidden">Message</span><input class="in${s.dataset.typed ? ' focus' : ''}" type="text" placeholder="Or type here" value="${s.dataset.typed || ''}"></label><button class="btn primary" type="button" data-static>Send</button></div>`;
    if (s.dataset.muted !== undefined) mute($('[data-mute]', s), true);
  });
  $$('.stage').forEach(st => {
    const [a, b] = ST[st.dataset.state];
    st.insertAdjacentHTML('afterbegin', `<button class="coach" type="button" data-state="${st.dataset.state}" data-size="${st.dataset.size}"${st.dataset.tap ? ` data-go="${st.dataset.tap}"` : ''} aria-label="Sponky coach. ${b || a}">${RIB}</button><p class="st">${a}</p><p class="act">${b}</p>`);
  });
  icons(document);

  // Overview: one inert clone per scene, plus the direct route.
  function frame(n, direct, title, note) {
    const c = P.cloneNode(true);
    c.removeAttribute('id'); c.classList.remove('live'); c.classList.add('static', 'frame'); c.classList.toggle('direct', direct); c.inert = true;
    $$('details', c).forEach(x => x.open = true); show(c, n);
    const f = document.createElement('figure');
    f.innerHTML = `<figcaption><b></b><p>${note}</p></figcaption><div class="zw"></div>`;
    $('b', f).textContent = title; $('.zw', f).append(c); $('#sb').append(f);
  }
  beats.forEach(li => frame(+li.dataset.scene, false, `${li.dataset.scene} · ${$('.bt', li).textContent}`, $('p', li).innerHTML));
  frame(6, true, 'Route: Show me, no guess', 'A direct request skips the guess. The reveal shows only the actual amount.');

  function bind() {
    const g = Math.max(0, +v('guessNum').value || 0), m = Math.max(g, 60);
    $$('[data-bind=guess]', P).forEach(e => e.textContent = eur(g));
    v('guessRange').setAttribute('aria-valuetext', g + ' euros');
    $('[data-bind=feedback]', P).textContent = g === 60 ? 'Your guess matches the actual amount.' :
      `You guessed ${eur(Math.abs(60 - g))} ${g < 60 ? 'less' : 'more'} than the actual amount. Thanks for guessing first. Now you have the real number.`;
    $('[data-bar=guess]', P).style.width = g / m * 100 + '%'; $('[data-bar=actual]', P).style.width = 60 / m * 100 + '%';
    $('[data-complete]', P).disabled = !$('[name=refl]:checked', P);
  }

  function go(n) {
    cur = Math.max(0, Math.min(8, n));
    const was = document.activeElement;
    show(P, cur);
    beats.forEach((l, i) => i === cur ? l.setAttribute('aria-current', 'step') : l.removeAttribute('aria-current'));
    $('#simdate').textContent = 'SIMULATED DATE: ' + (cur < 7 ? 'Mon 4 Nov 2024' : 'Tue 5 Nov 2024');
    $('#back').disabled = !cur; $('#next').disabled = cur === 8;
    say('');
    const s = $('.scene:not([hidden])', P); $('.cbody', s).scrollTop = 0;
    if (was && was.closest('[hidden]')) s.focus();
  }

  P.addEventListener('input', e => {
    if (e.target.name === 'guessRange') v('guessNum').value = e.target.value;
    if (e.target.name === 'guessNum') v('guessRange').value = e.target.value;
    bind();
  });
  P.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (d.mute !== undefined) { const on = t.getAttribute('aria-pressed') !== 'true'; return $$('[data-mute]', P).forEach(b => mute(b, on)); }
    if (d.static !== undefined) return say('Shown for review. Not wired in this prototype.');
    if (d.jump) return $(d.jump).scrollIntoView();
    if (d.set) P.classList.add(d.set);
    if (d.clear) P.classList.remove(d.clear);
    if (d.go) go(+d.go);
  });
  $$('.scene', P).forEach(s => s.tabIndex = -1);
  $('#back').onclick = () => go(cur - 1);
  $('#next').onclick = () => go(cur + 1);
  $('#restart').onclick = () => { P.classList.remove('direct'); $$('form', P).forEach(f => f.reset()); $$('[data-mute]', P).forEach(b => mute(b, false)); bind(); go(0); };
  $('.beats').onclick = e => { const l = e.target.closest('li'); if (l) go(+l.dataset.scene); };

  // Review controls and URL parameters.
  const ctl = () => {
    $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === root.dataset.theme));
    $$('[data-w-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.wSet === String(parseInt(root.style.getPropertyValue('--phone-w')) || 390)));
  };
  $('.controls').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.themeSet) root.dataset.theme = b.dataset.themeSet;
    if (b.dataset.wSet) root.style.setProperty('--phone-w', b.dataset.wSet + 'px');
    ctl();
  };
  root.dataset.theme = qs.get('theme') === 'dark' ? 'dark' : 'light';
  document.body.dataset.only = qs.get('only') || '';
  if (+qs.get('w')) root.style.setProperty('--phone-w', +qs.get('w') + 'px');
  P.classList.toggle('direct', qs.get('direct') === '1');
  ctl(); bind(); go(+qs.get('scene') || 0);
}
