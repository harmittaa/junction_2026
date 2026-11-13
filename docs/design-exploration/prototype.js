// Design prototype. Scripted dialogue, invented data. No AI, no bank connection.
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const eur = n => new Intl.NumberFormat('fi-FI', { style: 'currency', currency: 'EUR' }).format(n);
const qs = new URLSearchParams(location.search), root = document.documentElement;
const APPBAR = '<header class="app-bar"><span class="dot"></span><span class="hs">Sponky</span><span class="sm muted">Money coach</span></header>';
const COMPOSER = '<div class="composer"><label><span class="visually-hidden">Message</span><input class="in" type="text" placeholder="Message Sponky"></label><button class="btn primary" type="button" aria-label="Send">Send</button></div>';
const flat = (o, p, out = []) => { for (const k in o) if (k !== 'description') typeof o[k] === 'object' ? flat(o[k], p + k + '-', out) : out.push(`${p}${k}:${o[k]}`); return out; };

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
  const P = $('#proto'), form = $('.thread', P), beats = $$('.beats li'), total = beats.reduce((s, l) => s + +l.dataset.secs, 0);
  let beat = 1;
  const say = t => $('#status').textContent = t;
  const v = n => $(`[name=${n}]`, P), set = (k, t) => $$(`[data-bind=${k}]`, P).forEach(e => e.textContent = t);

  // Show or hide every beat-dependent element. delta = storyboard view (only what starts at beat b).
  const apply = (ph, b, delta) => $$('[data-at],[data-only],[data-not]', ph).forEach(el => {
    const a = (el.dataset.at || '1').split('-'), lo = +a[0], hi = a[1] ? +a[1] : 99;
    const fl = x => ph.classList.contains('f-' + x), o = el.dataset.only, n = el.dataset.not;
    const inRange = delta && el.parentElement.classList.contains('thread') ? lo === b : b >= lo && b <= hi;
    el.hidden = !(inRange && (!o || fl(o)) && (!n || !fl(n)));
  });

  // Static phones get the same app bar and composer.
  $$('.phone').forEach(p => {
    if (!$('.app-bar', p)) p.insertAdjacentHTML('afterbegin', APPBAR);
    if (!$('.composer', p)) p.insertAdjacentHTML('beforeend', COMPOSER);
  });
  // Direction A and variant 2 reuse the real cards.
  const checkin = $('[data-card=checkin]', P).cloneNode(true);
  $('[data-new]', checkin).innerHTML = '<p>No taxi rides.</p>';
  $('[data-help]', checkin).textContent = 'A day without taxi rides still counts. Your reflection completes the check-in.';
  $('[data-clone=reveal]').replaceWith($('[data-card=reveal]', P).cloneNode(true));
  $('[data-clone=checkin]').replaceWith(checkin);

  // Storyboard: clone the pristine phone per beat.
  function frame(li, b, flag, title) {
    const c = P.cloneNode(true);
    c.removeAttribute('id'); c.classList.remove('live'); c.classList.add('static', 'frame'); c.inert = true;
    if (flag) c.classList.add(flag);
    $$('details', c).forEach(x => x.open = true);
    apply(c, b, true);
    $('.composer input', c).value = li.dataset.compose || '';
    const f = document.createElement('figure');
    f.innerHTML = `<figcaption><b></b><p>${$('p', li).innerHTML}</p>≈ ${li.dataset.secs} s</figcaption><div class="zw"></div>`;
    $('b', f).textContent = title; $('.zw', f).append(c); $('#sb').append(f);
  }
  beats.forEach(li => frame(li, +li.dataset.beat, '', `State ${li.dataset.state} · ${$('.bt', li).textContent}`));
  frame(beats[3], 4, 'f-direct', 'Route: direct answer, no guess');
  frame(beats[9], 10, 'f-declined', 'Route: habit declined');

  function bind() {
    const g = Math.max(0, +v('guessNum').value || 0), gap = Math.abs(60 - g), m = Math.max(g, 60);
    set('guess', eur(g)); v('guessRange').setAttribute('aria-valuetext', g + ' euros');
    set('feedback', g === 60 ? 'Your guess matches the actual amount.' : `You guessed ${eur(gap)} ${g < 60 ? 'less' : 'more'} than the actual amount. Thanks for guessing first. Now you have the real number.`);
    $('[data-bar=guess]', P).style.width = g / m * 100 + '%'; $('[data-bar=actual]', P).style.width = 60 / m * 100 + '%';
    const p = +v('wi').value / 100;
    set('pct', v('wi').value + ' %'); set('after', eur(45 - 45 * p)); set('saved', eur(45 * p));
    set('action', v('action').value);
    const gn = v('goalName').value.trim(), ga = v('goalAmt').value;
    set('goal', gn + (ga ? ' · ' + eur(+ga) : '')); $$('[data-goal-row]', P).forEach(e => e.hidden = !gn);
    const r = $('[name=refl]:checked', P);
    set('reflection', r ? r.nextElementSibling.textContent : 'I did it'); $('[data-complete]', P).disabled = !r;
  }

  function go(n) {
    beat = Math.max(1, Math.min(12, n));
    const was = document.activeElement, li = beats[beat - 1], inp = $('.composer input', P), dec = P.classList.contains('f-declined');
    apply(P, beat);
    beats.forEach(l => l === li ? l.setAttribute('aria-current', 'step') : l.removeAttribute('aria-current'));
    inp.value = li.dataset.compose || ''; inp.readOnly = !!li.dataset.compose;
    const cum = beats.slice(0, beat).reduce((s, l) => s + +l.dataset.secs, 0);
    $('#prog').textContent = `State ${li.dataset.state} of 8 · beat ${beat} of 12 · ≈ ${li.dataset.secs} s this beat · ≈ ${cum} s of ≈ ${total} s`;
    $('#simdate').textContent = 'SIMULATED DATE: ' + (beat < 11 ? 'Mon 4 Nov 2024' : 'Tue 5 Nov 2024');
    $('#back').disabled = beat === 1; $('#next').disabled = beat === 12 || (beat === 10 && dec);
    $('#advance').hidden = !(beat === 10 && !dec); $('#declmsg').hidden = !(beat === 10 && dec);
    say('');
    form.scrollTop = form.scrollHeight;
    if (was && was.closest('[hidden]')) $$('.msg:not([hidden])', P).pop()?.focus();
  }

  form.addEventListener('input', e => {
    if (e.target.name === 'guessRange') v('guessNum').value = e.target.value;
    if (e.target.name === 'guessNum') v('guessRange').value = e.target.value;
    bind();
  });
  P.addEventListener('click', e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if (t.closest('.composer')) return $('.composer input', P).readOnly ? go(beat + 1) : say('Scripted prototype: free text is not interpreted.');
    if (d.static !== undefined) return say('Shown for review. Not wired in this prototype.');
    if (d.jump) return $(d.jump).scrollIntoView();
    if (d.set) P.classList.add('f-' + d.set);
    if (d.clear) P.classList.remove('f-' + d.clear);
    go(d.go === 'next' ? beat + 1 : d.go ? +d.go : beat);
  });
  P.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('.composer input')) $('.composer .btn', P).click(); });
  $('#back').onclick = () => go(beat - 1);
  $('#next').onclick = $('#advance').onclick = () => go(beat + 1);
  $('#restart').onclick = () => { P.classList.remove('f-direct', 'f-left', 'f-declined'); form.reset(); bind(); go(1); };
  $('.beats').onclick = e => { const l = e.target.closest('li'); if (l) go(+l.dataset.beat); };

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
  (qs.get('flags') || '').split(',').filter(Boolean).forEach(f => P.classList.add('f-' + f));
  ctl(); bind(); go(+qs.get('beat') || 1);
}
