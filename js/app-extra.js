/* =====================================================================
 * app-extra.js — Profil vehicul, analiză automată, teste ghidate,
 *                trip & performanță, istoric, cadrane, HUD, wake lock
 *   (folosește funcțiile globale din app.js: S, $, $$, esc, exclusive, …)
 * ===================================================================== */
'use strict';

/* ------------------------------ profil vehicul ------------------------------ */
S.profile = store.get('profile', { vehicle: '', engine: '' });
function getEngine() { return ENGINES[S.profile.engine] || null; }
function renderProfile() {
  const vs = $('#prof-veh'), es = $('#prof-eng');
  vs.innerHTML = '<option value="">— alegeți modelul —</option>' + VEHICLES.map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('');
  vs.value = S.profile.vehicle;
  const veh = VEHICLES.find(v => v.id === S.profile.vehicle);
  const list = veh ? veh.engines : [];
  es.innerHTML = '<option value="">— motor —</option>' + list.map(id => `<option value="${id}">${esc(ENGINES[id].name)}</option>`).join('');
  es.value = list.includes(S.profile.engine) ? S.profile.engine : '';
  const e = getEngine();
  $('#prof-hint').textContent = e ? `${e.disp.toFixed(3)} L · ${e.fuel === 'diesel' ? 'diesel' : 'benzină'}${e.turbo ? ' · turbo' : ''}` : 'Profilul îmbunătățește analiza automată și testele.';
}
$('#prof-veh').addEventListener('change', e => { S.profile.vehicle = e.target.value; S.profile.engine = ''; store.set('profile', S.profile); renderProfile(); });
$('#prof-eng').addEventListener('change', e => { S.profile.engine = e.target.value; store.set('profile', S.profile); renderProfile(); });

/** Ghicește modelul din VIN (dacă profilul nu e setat) */
function guessProfileFromScan() {
  if (S.profile.vehicle) return;
  const model = ((S.scan.info || {}).model || '').split('/')[0].toLowerCase();
  const map = [['focus mk2', 'focus2'], ['c-max', 'cmax'], ['mondeo', 'mondeo4'], ['s-max', 'smax'], ['kuga', 'kuga1'], ['fiesta mk6', 'fiesta6'], ['fiesta mk7', 'fiesta7'], ['transit connect', 'connect'], ['transit', 'transit']];
  const hit = map.find(([k]) => model.includes(k));
  if (hit) { S.profile.vehicle = hit[1]; store.set('profile', S.profile); renderProfile(); toast('Model detectat din VIN: ' + VEHICLES.find(v => v.id === hit[1]).name + ' — alegeți motorul în Panou.'); }
}
renderProfile();

/* ------------------------------ wake lock ------------------------------ */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && !wakeLock && 'wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (_) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (S.live.running || (S.trip && S.trip.running))) keepAwake(true); });
$('#btn-live-start').addEventListener('click', () => keepAwake(true));
$('#btn-live-stop').addEventListener('click', () => { if (!hudOpen) keepAwake(false); });

/* ------------------------------ cadrane + HUD ------------------------------ */
if (store.get('gauges', false)) $('#live-tiles').classList.add('gauges');
$('#btn-gauge').addEventListener('click', () => { const on = $('#live-tiles').classList.toggle('gauges'); store.set('gauges', on); });

let hudOpen = false;
function hudKeys() {
  const pref = [0x0D, 0x0C, 0x05, 0x42];
  const keys = livePidList();
  const chosen = pref.filter(p => keys.includes(p));
  for (const k of keys) if (chosen.length < 4 && !chosen.includes(k)) chosen.push(k);
  return chosen.slice(0, 4);
}
$('#btn-hud').addEventListener('click', async () => {
  const keys = hudKeys();
  if (!keys.length) { toast('Selectați parametri în Date live.'); return; }
  $('#hud-vals').innerHTML = keys.map(k => `<div class="hud-v" id="hud-${k}"><div class="v">—</div><div class="n">${esc(OBD_PIDS[k].name)} · ${esc(OBD_PIDS[k].unit)}</div></div>`).join('');
  $('#hud').classList.remove('hidden'); hudOpen = true;
  if (store.get('hudMirror', false)) $('#hud-vals').classList.add('mirror');
  try { await document.documentElement.requestFullscreen(); } catch (_) {}
  keepAwake(true);
  if (!S.live.running) startLive();
});
$('#hud-close').addEventListener('click', () => {
  $('#hud').classList.add('hidden'); hudOpen = false;
  try { if (document.fullscreenElement) document.exitFullscreen(); } catch (_) {}
  if (!S.live.running) keepAwake(false);
});
$('#hud-mirror').addEventListener('click', () => store.set('hudMirror', $('#hud-vals').classList.toggle('mirror')));
window.onLiveValue = (key, r) => {
  if (!hudOpen) return;
  const el = document.getElementById('hud-' + key);
  if (el && r) el.querySelector('.v').textContent = r.text ? r.value : (typeof r.value === 'number' ? (Math.abs(r.value) >= 100 ? Math.round(r.value) : r.value.toFixed(1)) : r.value);
};

/* ------------------------------ instantaneu date live ------------------------------ */
async function takeSnapshot(seconds = 6) {
  const want = [0x0C, 0x05, 0x06, 0x07, 0x08, 0x09, 0x04, 0x14, 0x15, 0x10, 0x0B, 0x1F, 0x42];
  const pids = want.filter(p => S.obd.supported.has(p));
  const series = {};
  const t0 = Date.now(); let samples = 0, lastV = 0;
  await S.elm.resetHeader();
  while (Date.now() - t0 < seconds * 1000) {
    const r = await S.obd.readPids(pids);
    for (const p of pids) if (r[p] && typeof r[p].value === 'number') (series[p] = series[p] || []).push(r[p].value);
    if (Date.now() - lastV > 1500) { const v = await S.elm.voltage(); if (v != null) (series.volt = series.volt || []).push(v); lastV = Date.now(); }
    samples++;
  }
  let fuelStatus = null;
  if (S.obd.supported.has(0x03)) { const f = await S.obd.readPid(0x03); if (f) fuelStatus = f.value; }
  return { series, samples, seconds, fuelStatus, ts: new Date() };
}

/* ------------------------------ analiză ------------------------------ */
function renderAnalysis() {
  const res = S.scan.analysis;
  if (!res) { $('#ai-out').innerHTML = '<div class="card muted">Nicio analiză încă.</div>'; return; }
  const cnt = l => res.filter(x => x.level === l).length;
  const label = { bad: 'Grav', warn: 'Atenție', info: 'Informativ', ok: 'OK' };
  $('#ai-out').innerHTML = `<div class="sumbar"><span class="badge bad">${cnt('bad')} grave</span><span class="badge warn">${cnt('warn')} atenție</span><span class="badge">${cnt('info')} informative</span><span class="badge ok">${cnt('ok')} OK</span>${getEngine() ? '<span class="badge">' + esc(getEngine().name) + '</span>' : '<span class="badge warn">profil motor nesetat (Panou)</span>'}</div>` +
    res.map(f => `<div class="finding ${f.level}"><h4>${label[f.level]} · ${f.title}</h4>${f.text ? '<div class="txt">' + f.text + '</div>' : ''}${f.actions && f.actions.length ? '<div class="act"><b>Ce să verificați:</b><ul>' + f.actions.map(a => '<li>' + a + '</li>').join('') + '</ul></div>' : ''}${f.code ? `<div class="row"><button class="small primary" data-sheet="${esc(f.code)}" data-sheet-src="${esc(f.src === 'motor' ? '' : f.src || '')}">📋 Fișa completă, soluții și căutare online ›</button></div>` : ''}</div>`).join('');
  $$('#ai-out [data-sheet]').forEach(b => b.addEventListener('click', () => openDtcSheet({ code: b.dataset.sheet, src: b.dataset.sheetSrc })));
}
function runAnalysis() {
  S.scan.analysis = Analysis.analyze(S.scan, S.scan.snap, S.profile.engine ? S.profile : null);
  renderAnalysis();
}
$('#btn-ai').addEventListener('click', () => exclusive('Analiză automată', async () => {
  $('#ai-out').innerHTML = '<div class="card">Citire date… (≈ 15 s)</div>';
  S.scan.ts = S.scan.ts || new Date();
  if (!S.scan.info) { await readVehicleInfo(); guessProfileFromScan(); }
  await refreshMil();
  S.scan.dtcs = await S.obd.readDTCs(); renderDtcs(S.scan.dtcs);
  if (!S.scan.ff) S.scan.ff = await S.obd.readFreezeFrame(0);
  $('#ai-out').innerHTML = '<div class="card">Instantaneu date live (6 s)… lăsați motorul la ralanti.</div>';
  S.scan.snap = await takeSnapshot(6);
  runAnalysis(); renderDash();
}));
$('#btn-ai-offline').addEventListener('click', () => { if (!S.scan.ts && !S.scan.dtcs) { toast('Nu există o scanare. Conectați-vă sau încărcați una din Istoric.'); return; } runAnalysis(); });

window.afterFullScan = async () => {
  guessProfileFromScan();
  S.scan.snap = await takeSnapshot(6);
  runAnalysis();
  if ($('#scan-autosave').checked) await saveScan(true);
};

/* raport: adaugă analiza și testele */
const _reportHtmlBase = reportHtml;
reportHtml = function () {
  let html = _reportHtmlBase();
  const lbl = { bad: 'GRAV', warn: 'ATENȚIE', info: 'INFO', ok: 'OK' };
  const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (S.scan.analysis && S.scan.analysis.length) {
    html += '<h2>Analiză automată</h2><table><tr><th>Nivel</th><th>Constatare</th><th>Detalii / ce să verificați</th></tr>' +
      S.scan.analysis.filter(f => f.level !== 'info' || /Cod|Context/.test(f.title)).map(f => `<tr><td>${lbl[f.level]}</td><td>${esc(strip(f.title))}</td><td>${esc(strip(f.text))}${f.actions && f.actions.length ? '<br><i>' + esc(f.actions.map(strip).join(' · ')) + '</i>' : ''}</td></tr>`).join('') + '</table>';
  }
  const tests = S.scan.tests || {};
  const ids = Object.keys(tests);
  if (ids.length) {
    html += '<h2>Teste ghidate</h2>' + ids.map(id => {
      const t = tests[id]; const def = GUIDED_TESTS.find(g => g.id === id);
      return `<p><b>${esc(def ? def.name : id)}</b> (${esc(new Date(t.ts).toLocaleString('ro-RO'))})</p><table>${t.results.map(r => `<tr><td>${lbl[r.level] || ''}</td><td>${esc(strip(r.title))}</td><td>${esc(strip(r.text))}</td></tr>`).join('')}</table>`;
    }).join('');
  }
  if (S.profile.engine) html = html.replace('<h2>Vehicul</h2>', `<h2>Vehicul</h2><p>Profil: ${esc((VEHICLES.find(v => v.id === S.profile.vehicle) || {}).name || '')} · ${esc(getEngine().name)}</p>`);
  return html;
};

/* ------------------------------ teste ghidate ------------------------------ */
function renderTestList() {
  $('#tests-list').innerHTML = GUIDED_TESTS.map(t => `<div class="tile testcard" data-test="${t.id}"><div class="ic">${t.icon}</div><div><b>${esc(t.name)}</b></div><div class="n">${esc(t.desc)}</div>${S.scan.tests && S.scan.tests[t.id] ? '<span class="badge ok">efectuat</span>' : ''}</div>`).join('');
  $$('#tests-list [data-test]').forEach(el => el.addEventListener('click', () => runGuided(el.dataset.test)));
}
let testAbort = false, testStopReq = false;
$('#btn-test-abort').addEventListener('click', () => { testAbort = true; if (testAsk) testAsk.reject(new Error('Test abandonat')); });
$('#btn-test-stop').addEventListener('click', () => { testStopReq = true; });
let testAsk = null;

function runGuided(id) {
  const test = GUIDED_TESTS.find(t => t.id === id);
  if (!S.connected) { toast('Conectați-vă la vehicul.'); return; }
  exclusive('Test: ' + test.name, async () => {
    testAbort = false; testStopReq = false;
    $('#test-run').classList.remove('hidden'); $('#test-result').innerHTML = '';
    $('#test-title').textContent = test.icon + ' ' + test.name;
    $('#test-live').innerHTML = ''; $('#test-bar').style.width = '0';
    keepAwake(true);
    await S.elm.resetHeader();
    const ctx = {
      obd: S.obd, elm: S.elm, engine: getEngine(),
      has: p => S.obd.supported.has(p),
      say: html => { $('#test-say').innerHTML = html; },
      ask: (html, btn = 'Continuă') => new Promise((resolve, reject) => {
        if (testAbort) { reject(new Error('Test abandonat')); return; }
        $('#test-say').innerHTML = html;
        const b = $('#btn-test-next'); b.textContent = btn; b.classList.remove('hidden');
        testAsk = { reject };
        b.onclick = () => { b.classList.add('hidden'); b.onclick = null; testAsk = null; resolve(); };
      }),
      sample: async (o) => {
        const pids = (o.pids || []).filter(p => S.obd.supported.has(p));
        const series = {}, t = [];
        const t0 = Date.now();
        testStopReq = false;
        $('#btn-test-stop').classList.toggle('hidden', !o.allowStop);
        if (!o.allowStop) $('#test-say').innerHTML += '<br><b>Măsurare în curs…</b>';
        $('#test-live').innerHTML = pids.map(p => `<div class="tile"><div class="n">${esc(OBD_PIDS[p].name)}</div><div><span class="v" id="tl-${p}">—</span> <span class="u">${esc(OBD_PIDS[p].unit)}</span></div></div>`).join('') + (o.volt ? '<div class="tile"><div class="n">Tensiune baterie</div><div><span class="v" id="tl-volt">—</span> <span class="u">V</span></div></div>' : '');
        while (Date.now() - t0 < o.ms && !testAbort && !testStopReq) {
          const it = Date.now(); const vals = {};
          if (pids.length) {
            const r = await S.obd.readPids(pids);
            for (const p of pids) if (r[p] && typeof r[p].value === 'number') { (series[p] = series[p] || []).push(r[p].value); vals[p] = r[p].value; const el = document.getElementById('tl-' + p); if (el) el.textContent = fmt(r[p].value); }
          }
          if (o.volt) { const v = await S.elm.voltage(); if (v != null) { (series.volt = series.volt || []).push(v); vals.volt = v; $('#tl-volt').textContent = v.toFixed(2); } }
          t.push((Date.now() - t0) / 1000);
          // aliniere lungimi serii (pentru corelații)
          $('#test-bar').style.width = Math.min(100, (Date.now() - t0) / o.ms * 100) + '%';
          if (o.stopWhen && o.stopWhen(vals)) break;
          const wait = (o.periodMs || 0) - (Date.now() - it);
          if (wait > 0) await sleep(wait);
        }
        $('#btn-test-stop').classList.add('hidden');
        if (testAbort) throw new Error('Test abandonat');
        return { series, t };
      },
    };
    try {
      const results = await test.run(ctx);
      S.scan.tests = S.scan.tests || {};
      S.scan.tests[test.id] = { ts: Date.now(), results };
      $('#test-result').innerHTML = `<div class="card"><h3>Rezultat: ${esc(test.name)}</h3>` + results.map(f => `<div class="finding ${f.level}"><h4>${f.title}</h4>${f.text ? '<div class="txt">' + f.text + '</div>' : ''}</div>`).join('') + '</div>';
      log('✔ Test ' + test.name + ' finalizat');
    } catch (e) {
      $('#test-result').innerHTML = `<div class="card muted">${esc(e.message)}</div>`;
      if (e.message !== 'Test abandonat') throw e;
    } finally {
      $('#test-run').classList.add('hidden'); $('#btn-test-next').classList.add('hidden'); testAsk = null;
      keepAwake(false); renderTestList();
    }
  });
}
renderTestList();

/* ------------------------------ trip & performanță ------------------------------ */
S.trip = { running: false, comp: null, perf: null, loop: null };
const PERF_MODES = { '0-100': [0, 100], '0-60': [0, 60], '80-120': [80, 120], '60-100': [60, 100], '0-160': [0, 160] };
function tripTiles() {
  const c = S.trip.comp || new TripComputer();
  const t = c.elapsed, hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = Math.floor(t) % 60;
  const items = [
    ['Distanță', c.dist.toFixed(2), 'km'], ['Durată', `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, ''],
    ['Viteză medie (în mers)', c.avgSpeed.toFixed(1), 'km/h'], ['Viteză maximă', c.maxSpeed.toFixed(0), 'km/h'],
    ['Consum instantaneu', c.instL100 != null ? c.instL100.toFixed(1) : (c.instLh != null ? c.instLh.toFixed(2) : '—'), c.instL100 != null ? 'L/100 km' : 'L/h'],
    ['Consum mediu', c.avgL100 != null ? c.avgL100.toFixed(1) : '—', 'L/100 km'], ['Combustibil consumat', c.fuelL.toFixed(2), 'L'],
    ['Timp la ralanti', Math.round(c.idle / 60), 'min'],
  ];
  $('#trip-tiles').innerHTML = items.map(([n, v, u]) => `<div class="tile big"><div class="n">${n}</div><div><span class="v">${v}</span><span class="u">${u}</span></div></div>`).join('');
}
function perfHistory() {
  const h = store.get('perfHist', []);
  $('#perf-hist').innerHTML = h.length ? '<tr><th>Data</th><th>Probă</th><th>Timp</th></tr>' + h.slice(-15).reverse().map(x => `<tr><td>${esc(new Date(x.ts).toLocaleString('ro-RO'))}</td><td>${esc(x.mode)} km/h</td><td><b>${x.time.toFixed(2)} s</b></td></tr>`).join('') : '';
}
async function startTrip() {
  if (!S.connected) { toast('Nu sunteți conectat.'); return; }
  if (S.trip.running) return;
  if (S.busy) { toast('O operație este deja în curs…'); return; }
  if (S.live.running) await stopLive();
  const e = getEngine();
  const fuel = e ? e.fuel : (S.scan.status && S.scan.status.diesel ? 'diesel' : 'benzina');
  if (!S.trip.comp) S.trip.comp = new TripComputer(fuel);
  S.trip.comp.fuel = fuel;
  const sup = S.obd.supported;
  $('#trip-note').textContent = sup.has(0x5E) ? 'Consum calculat din debitul de combustibil raportat de ECU (PID 5E).' : (fuel === 'benzina' && sup.has(0x10) ? 'Consum estimat din debitul de aer (MAF) la amestec stoichiometric (±10%).' : 'ECU nu raportează debitul de combustibil — consumul nu poate fi calculat (tipic la diesel fără PID 5E).');
  S.trip.running = true; S.busy = true;
  $('#btn-trip-start').disabled = true; $('#btn-trip-stop').disabled = false;
  keepAwake(true);
  await S.elm.resetHeader();
  S.trip.loop = (async () => {
    let lastUi = 0;
    while (S.trip.running && S.connected) {
      const perfActive = S.trip.perf && S.trip.perf.state !== 'terminat';
      const pids = perfActive ? [0x0D] : [0x0D, 0x0C, sup.has(0x5E) ? 0x5E : null, sup.has(0x10) ? 0x10 : null].filter(p => p != null && sup.has(p));
      const r = await S.obd.readPids(pids);
      const now = performance.now();
      const v = r[0x0D] ? r[0x0D].value : null;
      if (v == null) { await sleep(200); continue; }
      const prevLast = S.trip.comp.last;
      S.trip.comp.update({ t: now, speed: v, rpm: r[0x0C] ? r[0x0C].value : (prevLast ? prevLast.rpm : 0), maf: r[0x10] ? r[0x10].value : null, fuelRate: r[0x5E] ? r[0x5E].value : null });
      if (S.trip.perf) {
        const st = S.trip.perf.update(now, v);
        $('#perf-state').textContent = st; $('#perf-speed').textContent = Math.round(v) + ' km/h';
        if (st === 'măsurare') $('#perf-time').textContent = ((now - S.trip.perf.tStart) / 1000).toFixed(1) + ' s';
        if (st === 'terminat') {
          const res = S.trip.perf.result; $('#perf-time').textContent = res.toFixed(2) + ' s';
          const h = store.get('perfHist', []); h.push({ ts: Date.now(), mode: $('#perf-mode').value, time: res }); store.set('perfHist', h); perfHistory();
          toast(`${$('#perf-mode').value} km/h: ${res.toFixed(2)} s`, 6000); S.trip.perf = null; $('#perf-state').textContent = 'terminat';
        }
      }
      if (now - lastUi > 500) { tripTiles(); lastUi = now; }
    }
  })().catch(e => log('Trip oprit: ' + e.message, 'err')).finally(() => {
    S.trip.running = false; S.busy = false; $('#btn-trip-start').disabled = !S.connected; $('#btn-trip-stop').disabled = true; keepAwake(false); tripTiles();
  });
}
async function stopTrip() { S.trip.running = false; try { await S.trip.loop; } catch (_) {} }
$('#btn-trip-start').addEventListener('click', startTrip);
$('#btn-trip-stop').addEventListener('click', stopTrip);
$('#btn-trip-reset').addEventListener('click', () => { if (S.trip.comp) S.trip.comp.reset(); tripTiles(); });
$('#btn-perf-arm').addEventListener('click', async () => {
  const [a, b] = PERF_MODES[$('#perf-mode').value];
  S.trip.perf = new PerfTimer(a, b);
  $('#perf-state').textContent = 'armat'; $('#perf-time').textContent = '0.0 s';
  toast(a === 0 ? 'Opriți complet vehiculul, apoi accelerați.' : `Coborâți sub ${a} km/h, apoi accelerați peste ${b} km/h.`, 5000);
  if (!S.trip.running) startTrip();
});
$('#btn-perf-cancel').addEventListener('click', () => { S.trip.perf = null; $('#perf-state').textContent = 'inactiv'; });
tripTiles(); perfHistory();

/* ------------------------------ istoric ------------------------------ */
async function saveScan(silent) {
  if (!S.scan.ts && !S.scan.dtcs && !S.scan.info) { if (!silent) toast('Nu există date de salvat — rulați o scanare.'); return; }
  try {
    const data = JSON.parse(JSON.stringify(S.scan));
    const codes = scanCodes(S.scan).size;
    const vin = (S.scan.info || {}).vin || 'necunoscut';
    await HistoryDB.add({ vin, ts: Date.now(), model: (VEHICLES.find(v => v.id === S.profile.vehicle) || {}).name || (S.scan.info || {}).model || '', engine: (getEngine() || {}).name || '', codes, profile: S.profile, data });
    if (!silent) toast('Scanare salvată în istoric'); else log('Scanare salvată automat în istoric');
    renderHistory();
  } catch (e) { toast('Istoric indisponibil în acest browser: ' + e.message, 5000); }
}
function loadScanData(d) {
  if (d.ts) d.ts = new Date(d.ts);
  if (d.snap && d.snap.ts) d.snap.ts = new Date(d.snap.ts);
  S.scan = d;
  if (d.dtcs) renderDtcs(d.dtcs);
  if (d.status) renderReady(d.status);
  if (d.ff) renderFF(d.ff);
  if (d.m06) renderM06(d.m06);
  renderInfo(); renderModules(); renderDash(); renderAnalysis(); renderTestList();
}
async function renderHistory() {
  let all = [];
  try { all = await HistoryDB.all(); } catch (_) { $('#hist-list').innerHTML = '<div class="card muted">IndexedDB indisponibil (navigare privată?).</div>'; return; }
  all.sort((a, b) => b.ts - a.ts);
  if (!all.length) { $('#hist-list').innerHTML = '<div class="card muted">Nicio scanare salvată.</div>'; return; }
  $('#hist-list').innerHTML = '<div class="card tblwrap"><table class="tbl"><tr><th></th><th>Data</th><th>VIN</th><th>Vehicul</th><th>Coduri</th><th></th></tr>' +
    all.map(r => `<tr><td><input type="checkbox" class="hcmp" value="${r.id}"></td><td>${esc(new Date(r.ts).toLocaleString('ro-RO'))}</td><td class="mono">${esc(r.vin)}</td><td>${esc(r.model)}${r.engine ? '<br><small>' + esc(r.engine) + '</small>' : ''}</td><td><span class="badge ${r.codes ? 'bad' : 'ok'}">${r.codes}</span></td>
      <td><button class="small" data-hload="${r.id}">Deschide</button> <button class="small danger" data-hdel="${r.id}">✕</button></td></tr>`).join('') + '</table><div class="row"><button id="btn-hist-cmp">Compară cele 2 selectate</button></div></div>';
  $$('[data-hload]').forEach(b => b.addEventListener('click', async () => {
    const r = await HistoryDB.get(+b.dataset.hload);
    if (S.live.running) await stopLive();
    loadScanData(r.data); if (r.profile) { S.profile = r.profile; renderProfile(); }
    toast('Scanare încărcată (' + new Date(r.ts).toLocaleString('ro-RO') + '). Vedeți Panou / Analiză / Raport.');
  }));
  $$('[data-hdel]').forEach(b => b.addEventListener('click', async () => { if (await confirmBox('Ștergeți această scanare din istoric?')) { await HistoryDB.del(+b.dataset.hdel); renderHistory(); } }));
  $('#btn-hist-cmp').addEventListener('click', async () => {
    const ids = $$('.hcmp:checked').map(x => +x.value);
    if (ids.length !== 2) { toast('Selectați exact 2 scanări.'); return; }
    const [a, b] = (await Promise.all(ids.map(id => HistoryDB.get(id)))).sort((x, y) => x.ts - y.ts);
    const c = compareScans(a.data, b.data);
    const li = (arr, cls) => arr.length ? arr.map(x => `<div class="dtc sev-${cls} clickable" data-code="${esc(x.code)}" data-src="${esc(x.src)}" tabindex="0"><span class="code">${esc(x.code)}</span><span>${esc(describeDTC(x.code))}</span><span class="badge">${esc(x.src)}</span></div>`).join('') : '<span class="muted">—</span>';
    $('#hist-cmp').innerHTML = `<div class="card"><h3>Comparație: ${esc(new Date(a.ts).toLocaleString('ro-RO'))} → ${esc(new Date(b.ts).toLocaleString('ro-RO'))}</h3>${a.vin !== b.vin ? '<p class="note">⚠️ VIN-uri diferite.</p>' : ''}
      <h3>✅ Rezolvate (${c.resolved.length})</h3>${li(c.resolved, 'scăzută')}<h3>🆕 Apărute (${c.added.length})</h3>${li(c.added, 'ridicată')}<h3>⏳ Persistente (${c.persistent.length})</h3>${li(c.persistent, 'medie')}</div>`;
  });
}
$('#btn-hist-save').addEventListener('click', () => saveScan(false));
$('#btn-hist-export').addEventListener('click', async () => { try { download('forddiag-istoric-' + stamp() + '.json', JSON.stringify(await HistoryDB.all(), null, 1), 'application/json'); } catch (e) { toast(e.message); } });
$('#hist-import').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const arr = JSON.parse(await f.text());
    let n = 0;
    for (const r of Array.isArray(arr) ? arr : [arr]) { if (!r || !r.data) continue; delete r.id; await HistoryDB.add(r); n++; }
    toast(n + ' scanări importate'); renderHistory();
  } catch (err) { toast('Fișier invalid: ' + err.message, 5000); }
  e.target.value = '';
});
/* ------------------------------ fișa codului de eroare ------------------------------ */
function sheetContext(code) {
  const ctx = { profile: S.profile, vin: (S.scan.info || {}).vin, year: (S.scan.info || {}).modelYear };
  ctx.others = [...scanCodes(S.scan).values()].map(x => x.code).filter(c => c !== code);
  ctx.others = [...new Set(ctx.others)];
  if (S.scan.ff && S.scan.ff.dtc === code && S.scan.ff.values) ctx.ff = S.scan.ff.values.slice(0, 10).map(v => `${v.name} ${v.text ? v.value : fmt(v.value)} ${v.unit}`).join('; ');
  const sn = S.scan.snap && S.scan.snap.series;
  if (sn) {
    const a = k => (sn[k] && sn[k].length ? sn[k].reduce((s, x) => s + x, 0) / sn[k].length : null);
    const parts = [];
    if (a(0x0C) != null) parts.push('turație ' + Math.round(a(0x0C)) + ' rpm');
    if (a(0x05) != null) parts.push('lichid răcire ' + Math.round(a(0x05)) + ' °C');
    if (a(0x06) != null && a(0x07) != null) parts.push('STFT ' + a(0x06).toFixed(1) + '% / LTFT ' + a(0x07).toFixed(1) + '%');
    if (a('volt') != null) parts.push('tensiune ' + a('volt').toFixed(2) + ' V');
    ctx.live = parts.join(', ');
  }
  return ctx;
}
function openDtcSheet(o) {
  const det = DtcInfo.dtcDetails(o.code, { engine: S.profile.engine, ftbText: o.ftb, active: o.active, src: o.src });
  const ctx = sheetContext(det.code);
  const sevCls = det.severity === 'ridicată' ? 'bad' : det.severity === 'scăzută' ? '' : 'warn';
  const links = DtcInfo.searchLinks(det.code, S.profile);
  const prompt = DtcInfo.aiPrompt(det, ctx);
  const doneKey = 'steps.' + det.code;
  const done = new Set(store.get(doneKey, []));
  $('#sheet-title').textContent = det.code + (o.ftb ? ' · ' + o.ftb : '');
  $('#sheet-body').innerHTML = `
    <div class="sheet-desc">${esc(det.desc)}</div>
    <div class="row">
      <span class="badge">${esc(det.system)}</span>
      <span class="badge">${det.generic ? 'Cod generic (SAE)' : 'Cod specific Ford'}</span>
      <span class="badge ${sevCls}">gravitate ${det.severity}</span>
      ${o.src ? '<span class="badge">modul ' + esc(o.src) + '</span>' : ''}
      ${o.active === false ? '<span class="badge">istoric — nu e activ acum</span>' : ''}
    </div>
    <div class="sheet-sec"><h3>🚗 Pot să conduc?</h3><div class="drive ${det.drive.level}">${esc(det.drive.text)}</div></div>
    ${o.active === false ? '<p class="note">Defectul nu este prezent în acest moment (cod istoric). Poate fi o problemă intermitentă sau una deja rezolvată: ștergeți codul și urmăriți dacă reapare.</p>' : ''}
    ${det.causes ? `<div class="sheet-sec"><h3>🔎 Cauze probabile <small>(de la cea mai probabilă / ieftină)</small></h3><ol>${det.causes.map(c => '<li>' + esc(c) + '</li>').join('')}</ol></div>` : '<p class="muted sheet-sec">Pentru acest cod nu există o fișă scrisă manual. Pașii de mai jos sunt deduși din tipul defectului — folosiți și căutarea online de mai jos.</p>'}
    ${det.fordNotes.length ? `<div class="sheet-sec"><h3>🔧 Problemă cunoscută la ${esc(ENGINES[S.profile.engine].name)}</h3><ul>${det.fordNotes.map(n => '<li>' + esc(n) + '</li>').join('')}</ul></div>` : ''}
    <div class="sheet-sec"><h3>🛠️ Cum se rezolvă — pași de verificare</h3>
      <ol class="steps">${det.steps.map((s, i) => `<li class="${done.has(i) ? 'done' : ''}"><input type="checkbox" data-step="${i}" ${done.has(i) ? 'checked' : ''}><span>${esc(s)}</span></li>`).join('')}</ol>
      <p class="muted">Bifați pașii efectuați; se păstrează pe acest dispozitiv.</p></div>
    ${ctx.ff ? `<div class="sheet-sec"><h3>🧊 Condiții la apariție (freeze frame)</h3><p class="muted">${esc(ctx.ff)}</p></div>` : ''}
    ${ctx.others.length ? `<div class="sheet-sec"><h3>🔗 Alte coduri prezente</h3><div class="row">${ctx.others.map(c => `<button class="small" data-open="${esc(c)}">${esc(c)}</button>`).join('')}</div><p class="muted">Mai multe coduri pot avea o cauză comună — vedeți fila Analiză.</p></div>` : ''}
    <div class="sheet-sec"><h3>🌐 Caută online</h3><div class="links">${links.map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`).join('')}</div></div>
    <div class="sheet-sec"><h3>🤖 Întreabă un asistent AI</h3>
      <p class="muted">Întrebare gata formulată cu datele vehiculului tău. O puteți edita înainte de trimitere.</p>
      <textarea id="sheet-ai">${esc(prompt)}</textarea>
      <div class="row"><button id="sheet-copy">📋 Copiază</button><a class="btnlike" id="sheet-claude" target="_blank" rel="noopener noreferrer">Deschide în Claude ↗</a><a class="btnlike" id="sheet-gpt" target="_blank" rel="noopener noreferrer">Deschide în ChatGPT ↗</a></div>
    </div>`;
  const setAiLinks = () => {
    const q = encodeURIComponent($('#sheet-ai').value);
    $('#sheet-claude').href = 'https://claude.ai/new?q=' + q;
    $('#sheet-gpt').href = 'https://chatgpt.com/?q=' + q;
  };
  setAiLinks();
  $('#sheet-ai').addEventListener('input', setAiLinks);
  $('#sheet-copy').addEventListener('click', async () => {
    const txt = $('#sheet-ai').value;
    try { await navigator.clipboard.writeText(txt); } catch (_) { $('#sheet-ai').select(); try { document.execCommand('copy'); } catch (__) {} }
    toast('Întrebarea a fost copiată');
  });
  $$('#sheet-body [data-step]').forEach(cb => cb.addEventListener('change', () => {
    const i = +cb.dataset.step; cb.checked ? done.add(i) : done.delete(i); store.set(doneKey, [...done]);
    cb.closest('li').classList.toggle('done', cb.checked);
  }));
  $$('#sheet-body [data-open]').forEach(b => b.addEventListener('click', () => openDtcSheet({ code: b.dataset.open })));
  $('#sheet').classList.remove('hidden');
  $('#sheet .sheet-box').scrollTop = 0;
}
window.openDtcSheet = openDtcSheet;
function closeSheet() { $('#sheet').classList.add('hidden'); }
$('#sheet-close').addEventListener('click', closeSheet);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').classList.contains('hidden')) closeSheet(); });
function dtcFromEl(el) { return { code: el.dataset.code, ftb: el.dataset.ftb || '', src: el.dataset.src || '', active: el.dataset.active !== '0' }; }
document.addEventListener('click', e => {
  const el = e.target.closest('.dtc.clickable[data-code]');
  if (el && !e.target.closest('button, a, input')) openDtcSheet(dtcFromEl(el));
});
document.addEventListener('keydown', e => {
  const el = e.target.closest && e.target.closest('.dtc.clickable[data-code]');
  if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDtcSheet(dtcFromEl(el)); }
});

$$('#tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'hist') renderHistory(); if (b.dataset.tab === 'ai') renderAnalysis(); if (b.dataset.tab === 'trip') tripTiles(); }));
renderAnalysis();

/* ------------------------------ meniu pe două linii (categorii + secțiuni) ------------------------------ */
const lastTabOfGroup = store.get('lastTabs', {});
function showGroup(group, openTab) {
  $$('#groups button').forEach(b => b.classList.toggle('active', b.dataset.group === group));
  const subs = $$('#tabs button');
  subs.forEach(b => b.classList.toggle('show', b.dataset.group === group));
  if (openTab) {
    const target = subs.find(b => b.dataset.group === group && b.dataset.tab === (lastTabOfGroup[group] || '')) || subs.find(b => b.dataset.group === group);
    if (target && !target.classList.contains('active')) target.click();
  }
}
$$('#groups button').forEach(b => b.addEventListener('click', () => { showGroup(b.dataset.group, true); store.set('lastGroup', b.dataset.group); }));
$$('#tabs button').forEach(b => b.addEventListener('click', () => {
  lastTabOfGroup[b.dataset.group] = b.dataset.tab; store.set('lastTabs', lastTabOfGroup);
  showGroup(b.dataset.group, false);
  window.scrollTo({ top: 0 });
}));
showGroup(store.get('lastGroup', 'conn'), true);

/* insigne cu numărul de coduri pe meniu */
function updateNavBadges() {
  const d = S.scan.dtcs;
  const eng = d ? new Set([...d.stored, ...d.pending, ...d.permanent].map(x => x.code)).size : 0;
  const mods = Object.values(S.scan.modules || {}).reduce((s, m) => s + ((m.dtcs || []).length), 0);
  const set = (id, n) => { const el = $(id); el.textContent = n > 99 ? '99+' : n; el.classList.toggle('hidden', !n); };
  set('#tb-dtc', eng); set('#tb-mods', mods); set('#gb-diag', eng + mods);
}
const _renderDashBase = renderDash;
renderDash = function () { _renderDashBase(); updateNavBadges(); };
updateNavBadges();
