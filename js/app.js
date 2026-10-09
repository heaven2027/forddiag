/* =====================================================================
 * app.js — Interfața aplicației FordDiag OBD2
 * ===================================================================== */
'use strict';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmt = (v, d) => typeof v === 'number' ? (Math.abs(v) >= 1000 ? String(Math.round(v)) : String(+v.toFixed(d == null ? (Math.abs(v) >= 100 ? 1 : 2) : d))) : v;

const store = {
  get(k, def) { try { const v = localStorage.getItem('forddiag.' + k); return v == null ? def : JSON.parse(v); } catch (_) { return def; } },
  set(k, v) { try { localStorage.setItem('forddiag.' + k, JSON.stringify(v)); } catch (_) {} },
};

const S = {
  transport: null, elm: null, obd: null, ford: null, connected: false, busy: false,
  connType: 'serial', supported: [], selected: new Set(store.get('selectedPids', [0x04, 0x05, 0x0C, 0x0D, 0x0F, 0x11, 0x06, 0x07, 0x10, 0x42])),
  live: { running: false, history: {}, records: [], t0: 0, reqs: 0, lastRateT: 0 },
  scan: { ts: null }, logLines: [], custom: store.get('customPids', null),
  settings: Object.assign({ baud: 38400, timeout: 4000, liveInt: 0, ms: 'ATSPB\nATPB8104', hs: 'ATSP6', multipid: true }, store.get('settings', {})),
};
if (!S.custom) S.custom = FORD_ENHANCED_PRESETS.map(p => Object.assign({ live: false }, p));

/* ------------------------------ utilitare UI ------------------------------ */
function toast(msg, ms = 3000) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function confirmBox(text) {
  return new Promise(res => {
    $('#modal-text').textContent = text; $('#modal').classList.remove('hidden');
    const done = v => { $('#modal').classList.add('hidden'); $('#modal-yes').onclick = $('#modal-no').onclick = null; res(v); };
    $('#modal-yes').onclick = () => done(true); $('#modal-no').onclick = () => done(false);
  });
}
function log(msg, cls = 'info') {
  const line = '[' + new Date().toLocaleTimeString() + '] ' + msg;
  S.logLines.push(line); if (S.logLines.length > 20000) S.logLines.splice(0, 5000);
  const el = $('#log');
  const span = document.createElement('div'); span.className = cls; span.textContent = line;
  el.appendChild(span); while (el.childNodes.length > 600) el.removeChild(el.firstChild);
  el.scrollTop = el.scrollHeight;
}
function download(name, content, type = 'text/plain') {
  const blob = new Blob([content], { type: type + ';charset=utf-8' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

function setConnUI() {
  const c = S.connected;
  $('#st-conn').textContent = c ? 'Conectat · ' + (S.transport ? S.transport.name : '') : 'Deconectat';
  $('#st-conn').className = 'pill ' + (c ? 'on' : 'off');
  $('#btn-connect').disabled = c; $('#btn-disconnect').disabled = !c;
  $$('.needs-conn').forEach(b => { b.disabled = !c; });
  if (!c) { $('#btn-live-stop').disabled = true; }
  renderExt();
}

/** Rulează o operație exclusivă (oprește temporar datele live). */
async function exclusive(label, fn) {
  if (!S.connected) { toast('Nu sunteți conectat.'); return; }
  if (S.busy) { toast('O operație este deja în curs…'); return; }
  const wasLive = S.live.running;
  if (wasLive) await stopLive();
  S.busy = true; document.body.style.cursor = 'progress';
  try { log('▶ ' + label); return await fn(); }
  catch (e) { console.error(e); log('✖ ' + label + ': ' + e.message, 'err'); toast('Eroare: ' + e.message, 5000); }
  finally { S.busy = false; document.body.style.cursor = ''; try { await S.elm.resetHeader(); } catch (_) {} }
}

/* ------------------------------ tab-uri ------------------------------ */
$$('#tabs button').forEach(b => b.addEventListener('click', () => {
  $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
  if (b.dataset.tab === 'rep') renderReport();
  if (b.dataset.tab === 'live') drawChart();
}));
function segInit(id, cb) {
  $$(id + ' button').forEach(b => b.addEventListener('click', () => {
    $$(id + ' button').forEach(x => x.classList.toggle('active', x === b)); cb(b.dataset.v);
  }));
}
const CONN_HINTS = {
  serial: 'Adaptor ELM327 Bluetooth clasic (împerecheat în prealabil din setările sistemului) sau cablu USB. Se va deschide lista porturilor.',
  ble: 'Adaptor Bluetooth LE (Vgate iCar Pro BLE, Veepeak BLE+, OBDLink CX…). Se va deschide lista dispozitivelor din apropiere — alegeți adaptorul (ex. „OBDII”, „IOS-Vlink”, „VEEPEAK”).',
  demo: 'Simulator: un Ford Focus Mk2 cu câteva coduri de eroare, pentru a încerca aplicația fără mașină.',
};
function setConnType(v) { S.connType = v; $('#conn-type-hint').textContent = CONN_HINTS[v] || ''; }
segInit('#conn-type', setConnType);
setConnType('serial');

/* ------------------------------ compatibilitate ------------------------------ */
(function compat() {
  const msgs = [];
  if (!window.isSecureContext) msgs.push('⚠️ Pagina nu rulează într-un context securizat (HTTPS sau localhost). Bluetooth și portul serial sunt blocate de browser. Porniți aplicația cu <b>start-windows.bat</b> sau găzduiți-o pe HTTPS.');
  msgs.push((Transports.SerialTransport.isSupported() ? '✅' : '❌') + ' Web Serial (Bluetooth clasic/COM/USB)' + (Transports.SerialTransport.isSupported() ? '' : ' — folosiți Chrome sau Edge recent'));
  msgs.push((Transports.BleTransport.isSupported() ? '✅' : '❌') + ' Web Bluetooth (adaptoare BLE)' + (Transports.BleTransport.isSupported() ? '' : ' — folosiți Chrome/Edge'));
  $('#compat').innerHTML = msgs.join('<br>');
  if (!Transports.SerialTransport.isSupported() && Transports.BleTransport.isSupported()) {
    $$('#conn-type button').forEach(x => x.classList.toggle('active', x.dataset.v === 'ble')); setConnType('ble');
  }
})();

/* ------------------------------ conectare ------------------------------ */
$('#btn-connect').addEventListener('click', () => connect(false));
$('#btn-reconnect').addEventListener('click', () => connect(true));
$('#btn-disconnect').addEventListener('click', disconnect);

function connMsg(html, cls = '') { const el = $('#conn-progress'); el.className = 'conn-msg ' + cls; el.innerHTML = html; }

/** reuse = reconectare la același port / dispozitiv, fără fereastra de selecție */
async function connect(reuse) {
  if (S.connecting || S.connected) return;
  S.connecting = true;
  $('#btn-connect').disabled = true; $('#btn-reconnect').classList.add('hidden');
  try {
    if (S.connType === 'serial') {
      if (!Transports.SerialTransport.isSupported()) throw new Transports.ConnError('Browserul nu suportă conexiunea serială / Bluetooth clasic.', 'Folosiți Google Chrome sau Microsoft Edge (versiune recentă). Pe Android: Chrome actualizat sau un adaptor Bluetooth LE.');
      S.transport = new Transports.SerialTransport(+S.settings.baud, reuse ? S.lastPort : null);
    } else if (S.connType === 'ble') {
      if (!Transports.BleTransport.isSupported()) throw new Transports.ConnError('Browserul nu suportă Bluetooth LE.', 'Folosiți Google Chrome sau Microsoft Edge. Safari / Firefox nu au Web Bluetooth.');
      S.transport = new Transports.BleTransport(reuse ? S.lastDevice : null);
    } else S.transport = new Transports.DemoTransport();

    connMsg(reuse ? '⏳ Reconectare…' : (S.connType === 'demo' ? '⏳ Pornire simulator…' : '⏳ Selectați adaptorul din fereastra browserului…'));
    await S.transport.connect();
    if (S.transport.port) S.lastPort = S.transport.port;
    if (S.transport.device) S.lastDevice = S.transport.device;
    S.lastConnType = S.connType;
    S.transport.onClose(() => {
      if (!S.connected) return;
      S.connected = false; S.live.running = false; setConnUI();
      toast('Conexiune pierdută cu adaptorul.', 5000); log('Conexiune închisă', 'err');
      connMsg('⚠️ Conexiunea s-a întrerupt (semnal Bluetooth, contact oprit sau adaptor scos). Apăsați <b>Reconectare</b>.', 'warn');
      $('#btn-reconnect').classList.toggle('hidden', !(S.lastPort || S.lastDevice));
    });
    S.elm = new ELM327(S.transport, (m, c) => log(m, c));
    S.elm.timeoutMs = +S.settings.timeout;
    S.obd = new OBD(S.elm); S.obd.noMulti = !S.settings.multipid;
    S.ford = new FordDiag(S.elm, S.obd);
    const info = await S.elm.init($('#proto').value, t => connMsg('⏳ ' + esc(t)));
    S.connected = true; setConnUI();
    const v = await S.elm.voltage();
    setVoltage(v);
    const rows = $('#conn-info').rows;
    rows[0].cells[1].textContent = info.version || '?';
    rows[1].cells[1].textContent = S.transport.name;
    rows[2].cells[1].textContent = info.protocolName + (S.elm.isCAN ? '' : ' (non-CAN: modulele Ford extinse indisponibile)');
    const cp = S.elm.caps || {};
    const yn = b => (b ? '✅' : '❌');
    rows[4].cells[1].innerHTML = `${yn(cp.flowControl)} flow control (ATFC) · ${yn(cp.receiveFilter)} filtru (ATCRA) · ${yn(cp.protocolB)} protocol B / MS-CAN (ATPB)` +
      (cp.suspectClone ? '<br><span class="badge warn">Adaptor clonă probabil — unele funcții avansate pot eșua</span>' : '') + (S.elm.isSTN ? '<br><span class="badge ok">OBDLink / STN</span>' : '');
    connMsg('⏳ Citire parametri suportați…');
    await loadSupported();
    await refreshMil();
    connMsg(`✅ Conectat · ${esc(info.protocolName)} · ${S.supported.length} parametri live disponibili.`, 'ok');
    log('Conectat: ' + info.version + ' · ' + info.protocolName);
    toast('Conectat la vehicul');
  } catch (e) {
    console.error(e);
    const msg = e.userFacing ? e.message : (e.name === 'NotFoundError' ? 'Niciun dispozitiv selectat.' : 'Conectare eșuată: ' + (e.message || e.name));
    connMsg(`❌ <b>${esc(msg)}</b>${e.hint ? '<br>' + esc(e.hint) : ''}`, 'err');
    log('Conectare eșuată: ' + msg + (e.hint ? ' — ' + e.hint : ''), 'err');
    try { if (S.transport) await S.transport.disconnect(); } catch (_) {}
    S.connected = false; setConnUI();
    $('#btn-reconnect').classList.toggle('hidden', !((S.connType === 'serial' && S.lastPort) || (S.connType === 'ble' && S.lastDevice)));
  } finally {
    S.connecting = false;
    $('#btn-connect').disabled = S.connected;
  }
}

async function disconnect() {
  await stopLive();
  S.connected = false;
  try { await S.transport.disconnect(); } catch (_) {}
  setConnUI(); connMsg('Deconectat.'); setVoltage(null);
  $('#btn-reconnect').classList.toggle('hidden', !(S.lastPort || S.lastDevice));
}
// schimbarea tipului de conexiune ascunde reconectarea către alt tip
$$('#conn-type button').forEach(b => b.addEventListener('click', () => {
  $('#btn-reconnect').classList.toggle('hidden', S.connected || !((b.dataset.v === 'serial' && S.lastPort) || (b.dataset.v === 'ble' && S.lastDevice)));
}));

function setVoltage(v) {
  const el = $('#st-volt');
  el.textContent = v == null ? '— V' : v.toFixed(1) + ' V';
  el.className = 'pill ' + (v == null ? '' : v < 11.8 ? 'off' : v < 12.4 ? 'warn' : 'on');
  if (S.elm) $('#conn-info').rows[3].cells[1].textContent = v == null ? '—' : v.toFixed(2) + ' V ' + (v < 11.8 ? '(scăzută!)' : v > 13.2 ? '(alternator încarcă)' : '');
  S.scan.voltage = v;
}
async function refreshMil() {
  try {
    await S.elm.resetHeader();
    const st = await S.obd.readStatus();
    if (st) { S.scan.status = st; $('#st-mil').textContent = (st.mil ? 'MIL/Check Engine APRINS' : 'MIL stins') + ' · ' + st.dtcCount + ' cod.'; $('#st-mil').className = 'pill ' + (st.mil ? 'off' : 'on'); }
  } catch (_) {}
}

/* ------------------------------ coduri DTC ------------------------------ */
function dtcHtml(d, extra = '') {
  const sev = dtcSeverity(d.code);
  const attrs = `data-code="${esc(d.code)}" data-ftb="${esc(d.ftbText || '')}" data-src="${esc(d.src || d.ecu || '')}" data-active="${d.active === false ? '0' : '1'}"`;
  return `<div class="dtc sev-${sev} clickable" ${attrs} role="button" tabindex="0" title="Deschide fișa codului"><span class="code">${esc(d.full || d.code)}</span><span>${esc(describeDTC(d.code))}${d.ftbText ? ' — <i>' + esc(d.ftbText) + '</i>' : ''}</span>
    <span class="badge ${sev === 'ridicată' ? 'bad' : sev === 'scăzută' ? '' : 'warn'}">gravitate ${sev}</span>
    <span class="meta">${extra}${d.ecu ? 'ECU ' + esc(d.ecu) + ' · ' : ''}${d.statusText ? esc(d.statusText) + ' · ' : ''}<b class="more">Detalii, cauze și soluții ›</b></span></div>`;
}
function renderDtcs(r) {
  const sec = (title, list, hint) => `<div class="card"><h3>${title} <span class="badge">${list.length}</span></h3>${list.length ? list.map(d => dtcHtml(d)).join('') : '<span class="muted">' + hint + '</span>'}</div>`;
  $('#dtc-list').innerHTML = sec('Coduri memorate (confirmate)', r.stored, 'Niciun cod memorat.') + sec('Coduri în așteptare (pending)', r.pending, 'Niciun cod în așteptare.') + sec('Coduri permanente', r.permanent, 'Niciun cod permanent (sau ECU nu suportă Mode 0A).');
}
$('#btn-read-dtc').addEventListener('click', () => exclusive('Citire coduri', async () => {
  const r = await S.obd.readDTCs(); S.scan.dtcs = r; renderDtcs(r); await refreshMil(); renderDash();
  toast(`Coduri: ${r.stored.length} memorate, ${r.pending.length} în așteptare`);
}));
$('#btn-clear-dtc').addEventListener('click', async () => {
  if (!await confirmBox('Ștergeți codurile de eroare și datele freeze frame din ECU motor? Monitoarele readiness vor fi resetate (necesar ciclu de conducere pentru ITP). Motorul trebuie să fie OPRIT, contactul pe ON.')) return;
  exclusive('Ștergere coduri', async () => {
    const ok = await S.obd.clearDTCs();
    toast(ok ? 'Coduri șterse.' : 'ECU nu a confirmat ștergerea.');
    const r = await S.obd.readDTCs(); S.scan.dtcs = r; renderDtcs(r); await refreshMil(); renderDash();
  });
});
$('#btn-dtc-search').addEventListener('click', searchDtc);
$('#dtc-search').addEventListener('keydown', e => { if (e.key === 'Enter') searchDtc(); });
function searchDtc() {
  const c = $('#dtc-search').value.trim().toUpperCase();
  if (!/^[PCBU][0-3][0-9A-F]{3}$/.test(c)) { $('#dtc-search-res').innerHTML = '<p class="muted">Format: literă (P/C/B/U) + 4 caractere, ex. P0171.</p>'; return; }
  $('#dtc-search-res').innerHTML = dtcHtml({ code: c });
  if (window.openDtcSheet) window.openDtcSheet({ code: c });
}

/* ------------------------------ date live ------------------------------ */
const BASIC = [0x04, 0x05, 0x0C, 0x0D, 0x0F, 0x11, 0x06, 0x07, 0x10, 0x0B, 0x0E, 0x42, 0x2F];
async function loadSupported() {
  await S.elm.resetHeader();
  const all = await S.obd.loadSupported();
  S.supported = all.filter(p => OBD_PIDS[p] && ![0x01, 0x02, 0x1C, 0x13, 0x1D, 0x51, 0x12, 0x03].includes(p) && p % 0x20 !== 0);
  S.textPids = all.filter(p => [0x03, 0x1C, 0x13, 0x51, 0x12].includes(p));
  renderPicker();
}
$('#btn-pid-reload').addEventListener('click', () => exclusive('Reîncărcare PID', loadSupported));
function renderPicker() {
  if (!S.supported.length) { $('#pid-picker').innerHTML = '<span class="muted">ECU nu a raportat PID-uri suportate.</span>'; return; }
  $('#pid-picker').innerHTML = S.supported.map(p => `<label><input type="checkbox" data-pid="${p}" ${S.selected.has(p) ? 'checked' : ''}> ${esc(OBD_PIDS[p].name)} <code>01${hx(p)}</code></label>`).join('');
  $$('#pid-picker input').forEach(i => i.addEventListener('change', () => {
    const p = +i.dataset.pid; i.checked ? S.selected.add(p) : S.selected.delete(p); store.set('selectedPids', [...S.selected]); buildLiveTiles();
  }));
  buildLiveTiles();
}
function setSelection(list) { S.selected = new Set(list); store.set('selectedPids', list); renderPicker(); }
$('#btn-pid-all').addEventListener('click', () => setSelection(S.supported.slice()));
$('#btn-pid-none').addEventListener('click', () => setSelection([]));
$('#btn-pid-basic').addEventListener('click', () => setSelection(BASIC.filter(p => S.supported.includes(p))));

function livePidList() { return S.supported.filter(p => S.selected.has(p)); }
function liveCustomList() { return $('#ext-in-live').checked ? S.custom.filter(c => c.live) : []; }

function tileHtml(key, name, unit) {
  return `<div class="tile" id="lt-${key}"><div class="n">${name}</div><div class="lin"><span class="v">—</span><span class="u">${esc(unit)}</span></div>
    <svg class="gauge" viewBox="0 0 100 58"><path class="g-bg" d="M10 52 A40 40 0 0 1 90 52" pathLength="100"/><path class="g-fg" d="M10 52 A40 40 0 0 1 90 52" pathLength="100" stroke-dasharray="0 100"/></svg>
    <div class="gv"><span class="v v2">—</span><span class="u">${esc(unit)}</span></div><div class="bar"></div></div>`;
}
function buildLiveTiles() {
  const tiles = livePidList().map(p => tileHtml(p, esc(OBD_PIDS[p].name), OBD_PIDS[p].unit));
  liveCustomList().forEach(c => tiles.push(tileHtml('c' + S.custom.indexOf(c), esc(c.name) + ' <small>(ext.)</small>', c.unit)));
  $('#live-tiles').innerHTML = tiles.join('') || '<span class="muted">Selectați parametri mai jos.</span>';
  const opts = ['<option value="">— grafic: niciunul —</option>']
    .concat(livePidList().map(p => `<option value="${p}">${esc(OBD_PIDS[p].name)}</option>`))
    .concat(liveCustomList().map(c => `<option value="c${S.custom.indexOf(c)}">${esc(c.name)}</option>`));
  for (const id of ['#chart-pid', '#chart-pid2']) {
    const old = $(id).value; $(id).innerHTML = opts.join(''); $(id).value = old;
  }
  if (!$('#chart-pid').value && livePidList().includes(0x0C)) $('#chart-pid').value = '12';
  if (!$('#chart-pid2').value && livePidList().includes(0x0D)) $('#chart-pid2').value = '13';
}
['#chart-pid', '#chart-pid2'].forEach(id => $(id).addEventListener('change', drawChart));

function updateTile(key, r) {
  const el = document.getElementById('lt-' + key); if (!el || !r) return;
  const txt = r.text ? r.value : fmt(r.value);
  el.querySelectorAll('.v').forEach(x => { x.textContent = txt; });
  if (typeof r.value === 'number' && r.min != null && r.max != null) {
    const pct = Math.max(0, Math.min(100, (r.value - r.min) / (r.max - r.min) * 100));
    el.querySelector('.bar').style.width = pct + '%';
    const g = el.querySelector('.g-fg');
    if (g) { g.setAttribute('stroke-dasharray', pct.toFixed(1) + ' 100'); g.style.stroke = pct > 90 ? 'var(--bad)' : pct > 75 ? 'var(--warn)' : ''; }
  }
  if (window.onLiveValue) window.onLiveValue(key, r);
}
function pushHist(key, v) {
  if (typeof v !== 'number' || !isFinite(v)) return;
  const h = S.live.history[key] || (S.live.history[key] = []);
  h.push(v); if (h.length > 600) h.shift();
}

$('#btn-live-start').addEventListener('click', startLive);
$('#btn-live-stop').addEventListener('click', stopLive);
$('#btn-live-csv').addEventListener('click', exportCsv);
$('#ext-in-live').addEventListener('change', buildLiveTiles);

async function startLive() {
  if (!S.connected || S.live.running || S.busy) return;
  const pids = livePidList();
  if (!pids.length && !liveCustomList().length) { toast('Selectați cel puțin un parametru.'); return; }
  buildLiveTiles();
  S.live.running = true; S.live.history = {}; S.live.t0 = Date.now(); S.live.reqs = 0;
  if ($('#live-rec').checked) S.live.records = [];
  $('#btn-live-start').disabled = true; $('#btn-live-stop').disabled = false;
  log('▶ Date live: ' + pids.map(hx).join(','));
  S.live.loop = (async () => {
    let lastRate = Date.now(), reqs = 0, lastVolt = 0;
    await S.elm.resetHeader();
    while (S.live.running && S.connected) {
      const pidsNow = livePidList();
      const res = await S.obd.readPids(pidsNow);
      reqs += S.obd.noMulti ? pidsNow.length : Math.ceil(pidsNow.length / 6);
      const row = { t: ((Date.now() - S.live.t0) / 1000).toFixed(2) };
      for (const p of pidsNow) { const r = res[p]; updateTile(p, r); if (r) { pushHist(p, r.value); row[p] = r.value; } }
      for (const c of liveCustomList()) {
        const idx = S.custom.indexOf(c);
        try {
          let v;
          if (c.cmd === 'ATRV') v = await S.elm.voltage();
          else { v = await S.ford.readCustom(c); await S.elm.resetHeader(); }
          reqs++;
          if (v != null) { updateTile('c' + idx, { value: v }); pushHist('c' + idx, v); row['c' + idx] = v; }
        } catch (_) {}
      }
      if ($('#live-rec').checked) { S.live.records.push(row); $('#live-count').textContent = S.live.records.length; $('#btn-live-csv').disabled = false; }
      drawChart();
      const now = Date.now();
      if (now - lastRate > 1000) { $('#live-rate').textContent = (reqs * 1000 / (now - lastRate)).toFixed(1); reqs = 0; lastRate = now; }
      if (now - lastVolt > 10000) { lastVolt = now; setVoltage(await S.elm.voltage()); }
      if (+S.settings.liveInt) await sleep(+S.settings.liveInt);
    }
  })().catch(e => { log('Live oprit: ' + e.message, 'err'); toast('Date live oprite: ' + e.message); })
    .finally(() => { S.live.running = false; $('#btn-live-start').disabled = !S.connected; $('#btn-live-stop').disabled = true; });
}
async function stopLive() {
  if (!S.live.running) return;
  S.live.running = false;
  try { await S.live.loop; } catch (_) {}
  $('#btn-live-start').disabled = !S.connected; $('#btn-live-stop').disabled = true;
  log('■ Date live oprite');
}
function exportCsv() {
  const recs = S.live.records; if (!recs.length) return;
  const keys = [...new Set(recs.flatMap(r => Object.keys(r)))].filter(k => k !== 't');
  const name = k => k.startsWith('c') ? S.custom[+k.slice(1)].name + ' [' + S.custom[+k.slice(1)].unit + ']' : OBD_PIDS[+k].name + ' [' + OBD_PIDS[+k].unit + ']';
  const lines = ['timp_s;' + keys.map(name).join(';')];
  for (const r of recs) lines.push(r.t + ';' + keys.map(k => r[k] == null ? '' : (typeof r[k] === 'number' ? r[k].toFixed(3) : r[k])).join(';'));
  download('forddiag-live-' + stamp() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
}

function drawChart() {
  const cv = $('#chart'); if (!cv || !cv.offsetParent) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = 220;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  g.strokeStyle = '#26334f'; g.lineWidth = 1;
  for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(0, i * H / 5); g.lineTo(W, i * H / 5); g.stroke(); }
  const series = [[$('#chart-pid').value, '#4f9bff'], [$('#chart-pid2').value, '#ffb84d']];
  series.forEach(([key, col], si) => {
    if (!key) return;
    const h = S.live.history[key]; if (!h || h.length < 2) return;
    const data = h.slice(-300);
    let mn = Math.min(...data), mx = Math.max(...data); if (mx - mn < 1e-6) { mx += 1; mn -= 1; }
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath();
    data.forEach((v, i) => { const x = i / (300 - 1) * W, y = H - 8 - (v - mn) / (mx - mn) * (H - 16); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    const label = key.startsWith('c') ? S.custom[+key.slice(1)].name : OBD_PIDS[+key].name;
    g.fillStyle = col; g.font = '12px system-ui';
    g.fillText(`${label}: ${fmt(data[data.length - 1])}  (min ${fmt(mn)} / max ${fmt(mx)})`, 8, 16 + si * 16);
  });
}
window.addEventListener('resize', drawChart);

/* ------------------------------ freeze frame ------------------------------ */
$('#btn-ff').addEventListener('click', () => exclusive('Freeze frame', async () => {
  const ff = await S.obd.readFreezeFrame(0); S.scan.ff = ff; renderFF(ff);
}));
function renderFF(ff) {
  if (!ff || !ff.values.length) { $('#ff-out').innerHTML = '<div class="card muted">Nu există date freeze frame (niciun cod memorat sau ECU nu suportă).</div>'; return; }
  $('#ff-out').innerHTML = `<div class="card"><h3>Cod declanșator: ${ff.dtc ? esc(ff.dtc) + ' — ' + esc(describeDTC(ff.dtc)) : '—'}</h3><table class="tbl"><tr><th>Parametru</th><th>Valoare</th></tr>${ff.values.map(v => `<tr><td>${esc(v.name)}</td><td><b>${esc(v.text ? v.value : fmt(v.value))}</b> ${esc(v.unit)}</td></tr>`).join('')}</table></div>`;
}

/* ------------------------------ readiness / mode 06 ------------------------------ */
$('#btn-ready').addEventListener('click', () => exclusive('Monitoare readiness', async () => { await refreshMil(); renderReady(S.scan.status); renderDash(); }));
function renderReady(st) {
  if (!st) { $('#ready-out').innerHTML = '<div class="card muted">ECU nu a răspuns la PID 01.</div>'; return; }
  const inc = st.monitors.filter(m => !m.complete).length;
  $('#ready-out').innerHTML = `<div class="card"><div class="row"><span class="badge ${st.mil ? 'bad' : 'ok'}">${st.mil ? 'MIL/Check Engine APRINS' : 'MIL stins'}</span><span class="badge">${st.dtcCount} coduri confirmate</span><span class="badge">${st.diesel ? 'Motor diesel (aprindere prin compresie)' : 'Motor benzină (aprindere prin scânteie)'}</span><span class="badge ${inc ? 'warn' : 'ok'}">${inc ? inc + ' monitoare incomplete' : 'Toate monitoarele complete'}</span></div>
    <table class="tbl"><tr><th>Monitor</th><th>Stare</th></tr>${st.monitors.map(m => `<tr><td>${esc(m.name)}</td><td>${m.complete ? '<span class="badge ok">Complet</span>' : '<span class="badge warn">Incomplet</span>'}</td></tr>`).join('')}</table></div>`;
}
$('#btn-m06').addEventListener('click', () => exclusive('Mode 06', async () => {
  const r = await S.obd.readMode06(); S.scan.m06 = r; renderM06(r);
}));
function renderM06(r) {
  if (r.unsupported) { $('#m06-out').innerHTML = '<div class="card muted">Mode 06 decodat este disponibil doar pe CAN.</div>'; return; }
  if (!r.rows.length) { $('#m06-out').innerHTML = '<div class="card muted">Niciun rezultat de test Mode 06.</div>'; return; }
  $('#m06-out').innerHTML = `<div class="card"><h3>Rezultate teste monitorizare (Mode 06)</h3><div class="tblwrap"><table class="tbl"><tr><th>Monitor</th><th>TID</th><th>Valoare</th><th>Min</th><th>Max</th><th>Rezultat</th></tr>${r.rows.map(x => `<tr><td>${esc(x.midName)}</td><td>${hx(x.tid)}</td><td>${fmt(x.value, 3)} ${esc(x.unit)}</td><td>${fmt(x.min, 3)}</td><td>${fmt(x.max, 3)}</td><td>${x.pass ? '<span class="badge ok">OK</span>' : '<span class="badge bad">EȘUAT</span>'}</td></tr>`).join('')}</table></div></div>`;
}

/* ------------------------------ module Ford ------------------------------ */
let busSel = 'HS';
segInit('#bus-sel', v => { busSel = v; });
async function ensureBus() {
  if (!S.elm.isCAN) throw new Error('Vehiculul nu folosește CAN — scanarea modulelor Ford necesită CAN.');
  if (S.ford.bus !== busSel) {
    if (busSel === 'MS' && !await confirmBox('Comutați adaptorul pe MS-CAN (comutator HS/MS pe poziția MS, dacă există), apoi confirmați.')) throw new Error('Anulat');
    if (busSel === 'HS' && S.ford.bus === 'MS') await confirmBox('Readuceți comutatorul adaptorului pe HS-CAN, apoi confirmați.');
    await S.ford.switchBus(busSel, S.settings.ms.split('\n'), S.settings.hs.split('\n'));
  }
}
$('#btn-mod-scan').addEventListener('click', () => exclusive('Scanare module ' + busSel, async () => { await ensureBus(); await scanModules((i, n, m) => { $('#mods-out').innerHTML = `<div class="card">Scanare ${i + 1}/${n}: ${esc(m.name)}…<div class="progress"><div style="width:${(i + 1) / n * 100}%"></div></div></div>`; }); renderModules(); renderDash(); }));
async function scanModules(onProgress) {
  const results = (S.scan.modules = S.scan.modules || {});
  for (let i = 0; i < FORD_MODULES.length; i++) {
    const m = FORD_MODULES[i]; onProgress && onProgress(i, FORD_MODULES.length, m);
    const key = busSel + ':' + m.id;
    const present = await S.ford.ping(m);
    if (!present) { results[key] = { mod: m, bus: busSel, present: false }; continue; }
    const d = await S.ford.readModuleDTCs(m);
    results[key] = { mod: m, bus: busSel, present: true, ...d };
  }
  return results;
}
function renderModules() {
  const res = Object.values(S.scan.modules || {}).filter(r => r.bus === busSel);
  if (!res.length) { $('#mods-out').innerHTML = '<div class="card muted">Nicio scanare efectuată.</div>'; return; }
  const present = res.filter(r => r.present), absent = res.filter(r => !r.present);
  $('#mods-out').innerHTML = `<p class="muted">${present.length} module au răspuns pe ${busSel}-CAN, ${absent.length} absente.</p>` +
    present.map(r => {
      const k = r.bus + ':' + r.mod.id;
      return `<div class="mod"><span class="id">${esc(r.mod.id)}</span><span>${esc(r.mod.name)} <small>${r.mod.tx} · ${r.proto || ''}</small></span>
      <span class="row"><span class="badge ${!r.ok ? 'warn' : r.dtcs.length ? 'bad' : 'ok'}">${!r.ok ? esc(r.error) : r.dtcs.length + ' coduri'}</span>
      <button class="small" data-act="read" data-k="${k}">Recitire</button><button class="small" data-act="id" data-k="${k}">Identificare</button><button class="small danger" data-act="clr" data-k="${k}">Ștergere</button></span>
      <div class="body">${(r.dtcs || []).map(d => dtcHtml(Object.assign({}, d, { src: r.mod.id }))).join('')}${r.ident ? '<table class="kv">' + r.ident.map(x => `<tr><th>${esc(x.label)} <code>${x.did}</code></th><td class="mono">${esc(x.value)}</td></tr>`).join('') + '</table>' : ''}</div></div>`;
    }).join('') + (absent.length ? `<details class="card"><summary class="muted">Module care nu au răspuns (${absent.length})</summary>${absent.map(r => `<div class="muted">${esc(r.mod.id)} — ${esc(r.mod.name)} (${r.mod.tx})</div>`).join('')}</details>` : '');
  $$('#mods-out button[data-act]').forEach(b => b.addEventListener('click', () => moduleAction(b.dataset.act, b.dataset.k)));
}
async function moduleAction(act, key) {
  const r = S.scan.modules[key]; const m = r.mod;
  if (act === 'clr' && !await confirmBox(`Ștergeți codurile din modulul ${m.id} (${m.name})?`)) return;
  exclusive(act + ' ' + m.id, async () => {
    await ensureBus();
    if (act === 'id') r.ident = await S.ford.identify(m);
    if (act === 'clr') { const c = await S.ford.clearModuleDTCs(m); toast(c.ok ? m.id + ': coduri șterse' : m.id + ': ' + c.error); }
    if (act === 'read' || act === 'clr') Object.assign(r, await S.ford.readModuleDTCs(m));
    renderModules(); renderDash();
  });
}
$('#btn-mod-clear-all').addEventListener('click', async () => {
  const res = Object.values(S.scan.modules || {}).filter(r => r.bus === busSel && r.present && r.dtcs && r.dtcs.length);
  if (!res.length) { toast('Nicio eroare de șters (scanați mai întâi modulele).'); return; }
  if (!await confirmBox(`Ștergeți codurile din ${res.length} module (${res.map(r => r.mod.id).join(', ')})?`)) return;
  exclusive('Ștergere coduri module', async () => {
    await ensureBus();
    for (const r of res) { const c = await S.ford.clearModuleDTCs(r.mod); log(r.mod.id + ': ' + (c.ok ? 'șters' : c.error)); Object.assign(r, await S.ford.readModuleDTCs(r.mod)); }
    renderModules(); renderDash(); toast('Ștergere finalizată');
  });
});

/* ------------------------------ PID extinse ------------------------------ */
function saveCustom() { store.set('customPids', S.custom); }
function renderExt() {
  $('#ext-list').innerHTML = `<div class="card tblwrap"><table class="tbl"><tr><th>Live</th><th>Nume</th><th>Modul</th><th>Comandă</th><th>Formulă</th><th>Valoare</th><th></th></tr>${S.custom.map((c, i) => `<tr>
    <td><input type="checkbox" data-live="${i}" ${c.live ? 'checked' : ''}></td><td>${esc(c.name)}${c.note ? '<br><small>' + esc(c.note) + '</small>' : ''}</td><td class="mono">${esc(c.tx)}</td><td class="mono">${esc(c.cmd)}</td><td class="mono">${esc(c.formula)}</td>
    <td id="ext-v${i}">—</td><td><button class="small" data-rd="${i}" ${S.connected ? '' : 'disabled'}>Citire</button> <button class="small danger" data-del="${i}">✕</button></td></tr>`).join('')}</table></div>`;
  $$('#ext-list [data-live]').forEach(x => x.addEventListener('change', () => { S.custom[+x.dataset.live].live = x.checked; saveCustom(); buildLiveTiles(); }));
  $$('#ext-list [data-del]').forEach(x => x.addEventListener('click', () => { S.custom.splice(+x.dataset.del, 1); saveCustom(); renderExt(); buildLiveTiles(); }));
  $$('#ext-list [data-rd]').forEach(x => x.addEventListener('click', () => exclusive('PID extins', () => readExt(+x.dataset.rd))));
}
async function readExt(i) {
  const c = S.custom[i]; let v = null;
  try { v = c.cmd === 'ATRV' ? await S.elm.voltage() : await S.ford.readCustom(c); }
  catch (e) { $('#ext-v' + i).textContent = 'eroare: ' + e.message; return; }
  $('#ext-v' + i).innerHTML = v == null ? '<span class="muted">fără răspuns / nesuportat</span>' : '<b>' + esc(fmt(v)) + '</b> ' + esc(c.unit);
}
$('#btn-ext-read').addEventListener('click', () => exclusive('PID-uri extinse', async () => { for (let i = 0; i < S.custom.length; i++) await readExt(i); }));
$('#btn-cp-add').addEventListener('click', () => {
  const c = { name: $('#cp-name').value.trim(), tx: $('#cp-tx').value.trim().toUpperCase(), cmd: $('#cp-cmd').value.replace(/\s/g, '').toUpperCase(), formula: $('#cp-formula').value.trim(), unit: $('#cp-unit').value.trim(), live: false };
  if (!c.name || !/^[0-9A-F]{3}$/.test(c.tx) || !/^([0-9A-F]{2})+$/.test(c.cmd) || !c.formula) { toast('Completați corect: nume, antet (3 cifre hex), comandă hex, formulă.'); return; }
  try { evalFormula(c.formula, [1, 2, 3, 4]); } catch (e) { toast(e.message, 5000); return; }
  S.custom.push(c); saveCustom(); renderExt(); toast('PID adăugat');
});

/* ------------------------------ info vehicul ------------------------------ */
/** Mode 09 + PID-uri text (standard OBD, tip combustibil, senzori O2 …) */
async function readVehicleInfo() {
  const info = await S.obd.vehicleInfo();
  for (const p of S.textPids || []) {
    const r = await S.obd.readPid(p);
    if (r) info['pid' + p] = r.value;
  }
  S.scan.info = info;
}
const INFO_LABELS = { vin: 'VIN', model: 'Model', modelYear: 'An', body: 'Caroserie', manufacturer: 'Producător', plant: 'Uzină asamblare', pid81: 'Combustibil', pid28: 'Standard emisii (OBD)', calId: 'Software motor (calibrare)' };
function kvRows(obj) { return Object.keys(INFO_LABELS).filter(k => obj[k]).map(k => `<tr><th>${INFO_LABELS[k]}</th><td class="${k === 'vin' || k === 'cvn' || k === 'calId' ? 'mono' : ''}">${esc(obj[k])}</td></tr>`).join(''); }
/* Fila „Info vehicul” este desenată de vehicle-history.js (suprascrie această funcție) */
function renderInfo() {}

/* ------------------------------ terminal ------------------------------ */
const termHist = []; let termIdx = 0;
async function termSend() {
  const cmd = $('#term-in').value.trim(); if (!cmd || !S.connected) return;
  if (S.busy) { toast('Așteptați finalizarea operației în curs.'); return; }
  termHist.push(cmd); termIdx = termHist.length; $('#term-in').value = '';
  if (S.live.running) await stopLive();
  const out = $('#term-out');
  out.textContent += '> ' + cmd + '\n';
  const r = await S.elm.send(cmd.toUpperCase(), 8000);
  out.textContent += r.lines.join('\n') + '\n\n'; out.scrollTop = out.scrollHeight;
  if (/^ATSH/i.test(cmd)) S.elm.currentHeader = cmd.slice(4).toUpperCase();
  if (/^AT(Z|D|WS|SP|TP)/i.test(cmd)) { S.elm.currentHeader = null; S.elm.currentFilter = null; }
}
$('#btn-term').addEventListener('click', termSend);
$('#term-in').addEventListener('keydown', e => {
  if (e.key === 'Enter') termSend();
  if (e.key === 'ArrowUp' && termIdx > 0) { $('#term-in').value = termHist[--termIdx]; e.preventDefault(); }
  if (e.key === 'ArrowDown' && termIdx < termHist.length) { $('#term-in').value = termHist[++termIdx] || ''; e.preventDefault(); }
});
$('#btn-term-clear').addEventListener('click', () => { $('#term-out').textContent = ''; });

/* ------------------------------ panou + scanare completă ------------------------------ */
function renderDash() {
  const st = S.scan.status, d = S.scan.dtcs, mods = Object.values(S.scan.modules || {}).filter(m => m.present);
  const modDtc = mods.reduce((a, m) => a + ((m.dtcs || []).length), 0);
  const tiles = [
    [st && st.mil ? 'Lampă MIL/Check Engine' : 'Lampă MIL', st ? (st.mil ? 'APRINSĂ' : 'Stinsă') : '—', st ? (st.mil ? 'bad' : 'ok') : ''],
    ['Coduri motor', d ? d.stored.length + d.pending.length : '—', d ? ((d.stored.length + d.pending.length) ? 'bad' : 'ok') : ''],
    ['Coduri module', S.scan.modules ? modDtc : '—', S.scan.modules ? (modDtc ? 'bad' : 'ok') : ''],
    ['Module găsite', S.scan.modules ? mods.length : '—', ''],
    ['Monitoare incomplete', st ? st.monitors.filter(m => !m.complete).length : '—', st ? (st.monitors.some(m => !m.complete) ? 'warnb' : 'ok') : ''],
    ['Baterie', S.scan.voltage != null ? S.scan.voltage.toFixed(1) + ' V' : '—', S.scan.voltage != null ? (S.scan.voltage < 11.8 ? 'bad' : S.scan.voltage < 12.4 ? 'warnb' : 'ok') : ''],
  ];
  $('#dash-tiles').innerHTML = tiles.map(([n, v, c]) => `<div class="tile big ${c}"><div class="n">${n}</div><div class="v">${esc(v)}</div></div>`).join('');
  $('#dash-veh').innerHTML = S.scan.info ? kvRows(S.scan.info) || '<tr><td class="muted">—</td></tr>' : '<tr><td class="muted">Rulați o scanare.</td></tr>';
  const all = [];
  if (d) { d.stored.forEach(x => all.push({ ...x, src: 'Motor (memorat)' })); d.pending.forEach(x => all.push({ ...x, src: 'Motor (în așteptare)' })); d.permanent.forEach(x => all.push({ ...x, src: 'Motor (permanent)' })); }
  mods.forEach(m => (m.dtcs || []).forEach(x => all.push({ ...x, src: m.mod.id + ' (' + m.bus + ')' })));
  $('#dash-dtc').innerHTML = all.length ? all.map(x => dtcHtml(x, esc(x.src) + ' · ')).join('') : (d ? '<span class="badge ok">Nicio eroare găsită</span>' : '<span class="muted">Rulați o scanare.</span>');
}
$('#btn-fullscan').addEventListener('click', () => exclusive('Scanare completă', async () => {
  const withMS = $('#scan-ms').checked && S.elm.isCAN;
  const steps = withMS ? 9 : 8; let n = 0;
  const step = (t) => { n++; $('#scan-bar').style.width = (n / steps * 100) + '%'; $('#scan-step').textContent = t; };
  S.scan.ts = new Date(); S.scan.protocol = PROTOCOLS[S.elm.protocol];
  step('Tensiune baterie…'); setVoltage(await S.elm.voltage());
  step('Informații vehicul (VIN, calibrare)…'); await readVehicleInfo(); renderInfo();
  step('Stare MIL și monitoare…'); await refreshMil(); renderReady(S.scan.status);
  step('Coduri motor (03/07/0A)…'); S.scan.dtcs = await S.obd.readDTCs(); renderDtcs(S.scan.dtcs);
  step('Freeze frame…'); S.scan.ff = await S.obd.readFreezeFrame(0); renderFF(S.scan.ff);
  step('Rezultate teste Mode 06…'); S.scan.m06 = await S.obd.readMode06(); renderM06(S.scan.m06);
  if (S.elm.isCAN) {
    step('Scanare module Ford pe HS-CAN…');
    const prev = busSel; busSel = 'HS';
    if (S.ford.bus !== 'HS') await S.ford.switchBus('HS', [], S.settings.hs.split('\n'));
    await scanModules((i, t, m) => { $('#scan-step').textContent = `Module HS-CAN ${i + 1}/${t}: ${m.name}`; });
    if (withMS) {
      step('Scanare module Ford pe MS-CAN…');
      if (await confirmBox('Comutați adaptorul pe MS-CAN (dacă are comutator), apoi confirmați. Anulați pentru a sări peste MS-CAN.')) {
        busSel = 'MS';
        await S.ford.switchBus('MS', S.settings.ms.split('\n'), S.settings.hs.split('\n'));
        await scanModules((i, t, m) => { $('#scan-step').textContent = `Module MS-CAN ${i + 1}/${t}: ${m.name}`; });
        await confirmBox('Readuceți comutatorul adaptorului pe HS-CAN, apoi confirmați.');
        await S.ford.switchBus('HS', S.settings.ms.split('\n'), S.settings.hs.split('\n'));
      }
    }
    busSel = prev; renderModules();
  } else step('Vehicul non-CAN — scanare module omisă');
  step('Analiză automată…');
  if (window.afterFullScan) await window.afterFullScan();
  $('#scan-bar').style.width = '100%'; $('#scan-step').textContent = '✅ Scanare finalizată la ' + S.scan.ts.toLocaleTimeString();
  renderDash(); toast('Scanare completă finalizată — vedeți fila Analiză');
}));

/* ------------------------------ raport ------------------------------ */
function reportHtml() {
  const s = S.scan, i = s.info || {};
  const rowsDtc = [];
  if (s.dtcs) { s.dtcs.stored.forEach(x => rowsDtc.push(['PCM/OBD', x.code, describeDTC(x.code), 'memorat'])); s.dtcs.pending.forEach(x => rowsDtc.push(['PCM/OBD', x.code, describeDTC(x.code), 'în așteptare'])); s.dtcs.permanent.forEach(x => rowsDtc.push(['PCM/OBD', x.code, describeDTC(x.code), 'permanent'])); }
  Object.values(s.modules || {}).filter(m => m.present).forEach(m => (m.dtcs || []).forEach(x => rowsDtc.push([m.mod.id + ' (' + m.bus + ')', x.full, describeDTC(x.code) + (x.ftbText ? ' — ' + x.ftbText : ''), x.statusText])));
  // coloană cu primele cauze / verificări din fișa codului
  rowsDtc.forEach(r => {
    const code = r[1].split(':')[0];
    const det = DtcInfo.dtcDetails(code, { engine: S.profile && S.profile.engine });
    r.push(det.drive.text.split('.')[0] + '. ' + (det.causes ? 'Cauze: ' + det.causes.slice(0, 3).join('; ') + '. ' : '') + 'Verificați: ' + det.steps.slice(0, 2).join(' '));
  });
  const tbl = (head, rows) =>`<table><tr>${head.map(h => '<th>' + esc(h) + '</th>').join('')}</tr>${rows.map(r => '<tr>' + r.map(c => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('')}</table>`;
  return `<h1>Raport diagnoză auto — FordDiag OBD2</h1>
  <p>Data: ${esc((s.ts || new Date()).toLocaleString('ro-RO'))} · Adaptor: ${esc(S.elm ? S.elm.version : '—')} · Protocol: ${esc(S.elm ? PROTOCOLS[S.elm.protocol] : '—')}</p>
  <h2>Vehicul</h2>${tbl(['Câmp', 'Valoare'], Object.keys(INFO_LABELS).filter(k => i[k]).map(k => [INFO_LABELS[k], i[k]]).concat(s.voltage != null ? [['Tensiune baterie', s.voltage.toFixed(2) + ' V']] : []))}
  <h2>Stare motor</h2>${s.status ? `<p>${s.status.mil ? 'MIL/Check Engine: <b>APRINS</b>' : 'MIL: <b>stins</b>'} · coduri confirmate raportate: ${s.status.dtcCount} · ${s.status.diesel ? 'diesel' : 'benzină'}</p>` + tbl(['Monitor readiness', 'Stare'], s.status.monitors.map(m => [m.name, m.complete ? 'Complet' : 'Incomplet'])) : '<p>—</p>'}
  <h2>Coduri de eroare (${rowsDtc.length})</h2>${rowsDtc.length ? tbl(['Modul', 'Cod', 'Descriere', 'Stare', 'Recomandare'], rowsDtc) : '<p>Nicio eroare găsită.</p>'}
  ${s.ff && s.ff.values.length ? '<h2>Freeze frame' + (s.ff.dtc ? ' (' + esc(s.ff.dtc) + ')' : '') + '</h2>' + tbl(['Parametru', 'Valoare'], s.ff.values.map(v => [v.name, (v.text ? v.value : fmt(v.value)) + ' ' + v.unit])) : ''}
  ${s.modules ? '<h2>Module scanate</h2>' + tbl(['Modul', 'Adresă', 'Bus', 'Stare'], Object.values(s.modules).map(m => [m.mod.id + ' — ' + m.mod.name, m.mod.tx, m.bus, !m.present ? 'nu a răspuns' : m.ok ? (m.dtcs.length + ' coduri') : m.error])) : ''}
  ${s.m06 && s.m06.rows && s.m06.rows.length ? '<h2>Teste Mode 06</h2>' + tbl(['Monitor', 'TID', 'Valoare', 'Min', 'Max', 'Rezultat'], s.m06.rows.map(x => [x.midName, hx(x.tid), fmt(x.value, 3) + ' ' + x.unit, fmt(x.min, 3), fmt(x.max, 3), x.pass ? 'OK' : 'EȘUAT'])) : ''}
  <p style="font-size:.8rem;color:#666;margin-top:16px">Descrierile codurilor specifice producătorului sunt orientative. Confirmați diagnosticul conform manualului de service Ford înainte de înlocuirea pieselor.</p>`;
}
function renderReport() { $('#rep-preview').innerHTML = reportHtml(); }
$('#btn-rep-html').addEventListener('click', () => {
  const html = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Raport diagnoză ${esc((S.scan.info || {}).vin || '')}</title><style>body{font:14px system-ui,sans-serif;max-width:900px;margin:20px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 6px;text-align:left}h2{border-bottom:1px solid #ccc}</style></head><body>${reportHtml()}</body></html>`;
  download('raport-diagnoza-' + ((S.scan.info || {}).vin || 'vehicul') + '-' + stamp() + '.html', html, 'text/html');
});
$('#btn-rep-print').addEventListener('click', () => { renderReport(); window.print(); });
$('#btn-rep-json').addEventListener('click', () => download('forddiag-date-' + stamp() + '.json', JSON.stringify(S.scan, (k, v) => (k === 'mod' ? v.id : v), 2), 'application/json'));
$('#btn-log-dl').addEventListener('click', () => download('forddiag-jurnal-' + stamp() + '.txt', S.logLines.join('\r\n')));

/* ------------------------------ setări ------------------------------ */
function loadSettingsUI() {
  $('#set-baud').value = String(S.settings.baud); $('#set-timeout').value = S.settings.timeout; $('#set-live-int').value = S.settings.liveInt;
  $('#set-ms').value = S.settings.ms; $('#set-hs').value = S.settings.hs; $('#set-multipid').checked = S.settings.multipid;
}
$('#btn-set-save').addEventListener('click', () => {
  S.settings = { baud: +$('#set-baud').value, timeout: Math.max(500, +$('#set-timeout').value || 4000), liveInt: Math.max(0, +$('#set-live-int').value || 0), ms: $('#set-ms').value, hs: $('#set-hs').value, multipid: $('#set-multipid').checked };
  store.set('settings', S.settings);
  if (S.elm) S.elm.timeoutMs = S.settings.timeout;
  if (S.obd) S.obd.noMulti = !S.settings.multipid;
  toast('Setări salvate');
});

/* ------------------------------ pornire ------------------------------ */
loadSettingsUI(); setConnUI(); renderDash(); buildLiveTiles();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeunload', e => { if (S.connected) { e.preventDefault(); e.returnValue = ''; } });
