/* =====================================================================
 * vehicle-history.js — Fila „Info vehicul”
 *   carte de identitate (VIN decodat / citit din mașină) + 4 sub-file:
 *   Prezentare · Documente (rovinietă, RCA, ITP) · Service (jurnal + remindere)
 *   · Verificare istoric (integritate citită din mașină + surse oficiale)
 * ===================================================================== */
'use strict';

const isVin = v => /^[A-HJ-NPR-Z0-9]{17}$/.test(v || '');
const fmtKm = n => n == null || n === '' ? '—' : Math.round(n).toLocaleString('ro-RO') + ' km';
const fmtDate = d => d ? new Date(d).toLocaleDateString('ro-RO') : '—';
const todayStr = () => new Date().toISOString().slice(0, 10);
const daysUntil = d => Math.round((new Date(d) - new Date(todayStr())) / 86400000);
const asciiOf = b => b.filter(c => c >= 0x20 && c < 0x7f).map(c => String.fromCharCode(c)).join('').trim();
function addMonths(dateStr, m) { const d = new Date(dateStr || Date.now()); d.setMonth(d.getMonth() + m); return d.toISOString().slice(0, 10); }
function copyText(txt, what) { if (!txt) return; try { navigator.clipboard.writeText(txt); toast(what + ' copiat'); } catch (_) {} }

function currentVin() {
  const v = (S.scan.info || {}).vin;
  if (isVin(v)) return v;
  const typed = ($('#vin-in').value || '').trim().toUpperCase();
  return isVin(typed) ? typed : 'necunoscut';
}
const kmNowKey = () => 'kmNow.' + currentVin();
const docKey = () => 'docs.' + currentVin();

/* ------------------------------ carte de identitate ------------------------------ */
function vehicleData() {
  const fromCar = S.scan.info && isVin(S.scan.info.vin);
  const vin = currentVin();
  const dec = isVin(vin) ? decodeVIN(vin) : {};
  return { fromCar, vin, d: Object.assign({}, dec, fromCar ? S.scan.info : {}) };
}
renderInfo = function () {
  const { fromCar, vin, d } = vehicleData();
  const eng = S.profile && ENGINES[S.profile.engine];
  const year = d.modelYear ? String(d.modelYear).match(/\d{4}/) : null;
  $('#veh-model').textContent = isVin(vin) ? [d.model || 'Ford', year && year[0]].filter(Boolean).join(' · ') : 'Vehicul necunoscut';
  $('#veh-sub').textContent = isVin(vin) ? (eng ? eng.name : 'Motorizare: alegeți-o în Diagnoză → Panou (nu este codificată în VIN)') : 'Conectați-vă la mașină sau introduceți VIN-ul mai jos';
  const chips = [];
  if (d.body) chips.push(d.body);
  if (d.plant) chips.push('🏭 ' + d.plant);
  if (d.pid81) chips.push('⛽ ' + d.pid81);
  if (isVin(vin)) chips.push(`<span class="chip src">${fromCar ? '📡 citit din mașină' : '⌨️ din VIN introdus'}</span>`);
  $('#veh-chips').innerHTML = chips.map(c => c.startsWith('<span') ? c : `<span class="chip">${esc(c)}</span>`).join('');
  if (fromCar && $('#vin-in').value.toUpperCase() !== vin) $('#vin-in').value = vin;
  renderVinCheck();
  // tabel date vehicul (doar ce e util)
  const rows = [['VIN', vin !== 'necunoscut' ? `<span class="mono">${esc(vin)}</span>` : ''], ['Model', esc(d.model || '')], ['An', esc(year ? year[0] : '')], ['Motorizare', esc(eng ? eng.name : '')],
    ['Caroserie', esc(d.body || '')], ['Uzină', esc(d.plant || '')], ['Combustibil', esc(d.pid81 || '')], ['Standard emisii', esc(d.pid28 || '')],
    ['Software motor', d.calId ? `<span class="mono">${esc(d.calId)}</span>` : ''], ['Kilometraj', esc(store.get(kmNowKey(), '') ? fmtKm(store.get(kmNowKey())) : '')]].filter(r => r[1]);
  $('#info-out').innerHTML = rows.length ? rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('') : '<tr><td class="muted">Nicio informație încă.</td></tr>';
  renderOverviewTiles();
};

/* ------------------------------ verificare VIN ------------------------------ */
const VIN_TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
function vinCheckDigit(v) {
  let sum = 0;
  for (let i = 0; i < 17; i++) { const c = v[i]; const n = /\d/.test(c) ? +c : VIN_TRANSLIT[c]; if (n == null) return null; sum += n * VIN_WEIGHTS[i]; }
  const r = sum % 11; return r === 10 ? 'X' : String(r);
}
/** Verificări de validitate; întoarce { verdict, checks:[{st:'ok'|'warn'|'bad'|'info', title, text}] } */
function validateVin(v, d) {
  const C = [], add = (st, title, text) => C.push({ st, title, text: text || '' });
  if (v.length !== 17) add('bad', `Lungime incorectă: ${v.length} caractere`, 'Un VIN are exact 17 caractere (vehicule după 1981).');
  else add('ok', 'Lungime corectă (17 caractere)');
  const bad = [...v].map((c, i) => (/[IOQ]/.test(c) || !/[A-Z0-9]/.test(c) ? `poz. ${i + 1} „${c}”` : null)).filter(Boolean);
  if (bad.length) add('bad', 'Caractere nepermise: ' + bad.join(', '), 'Literele I, O și Q nu există în VIN (se confundă cu 1 și 0). Verificați transcrierea.');
  else if (v.length === 17) add('ok', 'Doar caractere permise');
  if (v.length !== 17 || bad.length) return finish();
  const wmi = v.slice(0, 3);
  // coduri producător Ford / Lincoln / Mercury (exacte, nu prefixe — ex. 1M8 nu este Ford)
  const FORD_WMI = ['WF0', 'WF1', 'VS6', 'SFA', 'NM0', 'X9F', 'Z6F', '1FA', '1FB', '1FC', '1FD', '1FM', '1FT', '2FA', '2FM', '2FT', '3FA', '3FE', '3FT', '3FM', '1LN', '2LM', '5LM', '1ME', '2ME', '4M2', 'MAJ', 'MNB', '6FP', '9BF', 'LVS', 'AFA', 'PR8'];
  const isFord = FORD_WMI.includes(wmi);
  if (isFord) add('ok', 'Producător Ford: ' + (d.manufacturer || wmi), 'Cod producător (WMI) ' + wmi);
  else add('warn', 'Codul producătorului (' + wmi + ') nu este Ford', d.manufacturer && !/^WMI/.test(d.manufacturer) ? d.manufacturer : 'Aplicația este optimizată pentru Ford; decodarea detaliată poate lipsi.');
  if (/^[1-5]/.test(v)) {
    const cd = vinCheckDigit(v);
    if (cd === v[8]) add('ok', 'Cifra de control este corectă', `Poziția 9 = ${v[8]} (calculat ${cd}).`);
    else add('bad', 'Cifra de control NU corespunde', `Poziția 9 este „${v[8]}”, dar calculul dă „${cd}”. VIN-ul este transcris greșit sau nu este autentic.`);
  } else add('info', 'Cifra de control nu se aplică', 'VIN-urile europene nu folosesc obligatoriu cifra de control (poziția 9).');
  const year = parseInt((String(d.modelYear || '').match(/\d{4}/) || [])[0], 10);
  const now = new Date().getFullYear();
  if (year && year >= 1990 && year <= now + 1) add('ok', 'An: ' + year, year >= 2007 && year <= 2010 ? 'În intervalul pentru care aplicația are funcții Ford extinse (2007–2010).' : 'Aplicația funcționează, dar funcțiile Ford extinse sunt gândite pentru 2007–2010.');
  else add('warn', 'Anul nu a putut fi determinat', 'Verificați data de fabricație pe eticheta de pe stâlpul ușii.');
  if (d.region === 'EU') {
    if (v.slice(4, 6) === 'XX') add('ok', 'Structură Ford Europa corectă', 'Pozițiile 5–6 = „XX”, ca la toate Ford-urile europene.');
    else add('warn', 'Structură neobișnuită pentru Ford Europa', `Pozițiile 5–6 sunt „${v.slice(4, 6)}” în loc de „XX”. Verificați transcrierea.`);
    if (!d.model) add('warn', 'Modelul nu a putut fi identificat din VIN', 'Cod model necunoscut în poziția 9.');
  }
  const carVin = S.scan.info && S.scan.info.vin;
  if (isVin(carVin) && carVin !== v) add('warn', 'Diferă de VIN-ul citit din mașină', carVin);
  else if (isVin(carVin) && carVin === v) add('ok', 'Identic cu VIN-ul citit din calculatorul mașinii');
  const integ = S.scan.integrity;
  if (integ && integ.findings.some(f => /alt vehicul|fără VIN/.test(f.title))) add('warn', 'Unele module au alt VIN', 'Vedeți Verificare istoric.');
  return finish();
  function finish() {
    const verdict = C.some(c => c.st === 'bad') ? 'bad' : C.some(c => c.st === 'warn') ? 'warn' : 'ok';
    return { verdict, checks: C };
  }
}
function renderVinCheck() {
  const typed = ($('#vin-in').value || '').trim().toUpperCase();
  const v = isVin(currentVin()) ? currentVin() : typed;
  if (!v) {
    $('#vin-check').innerHTML = '<p class="muted">Introduceți VIN-ul sus și apăsați „Verifică VIN” (sau citiți-l din mașină).</p>';
    $('#vin-pos').innerHTML = ''; renderVinLinks(null); return;
  }
  const d = v.length === 17 ? Object.assign({}, decodeVIN(v), S.scan.info && S.scan.info.vin === v ? S.scan.info : {}) : {};
  const res = validateVin(v, d);
  const ico = { ok: '✅', warn: '⚠️', bad: '❌', info: 'ℹ️' };
  const verdictTxt = { ok: 'VIN valid', warn: 'VIN valid, cu observații', bad: 'VIN invalid sau transcris greșit' }[res.verdict];
  const grp = i => (i < 3 ? 'g1' : i < 9 ? 'g2' : 'g3');
  $('#vin-check').innerHTML = `<div class="vin-verdict ${res.verdict}">${ico[res.verdict]} ${verdictTxt}</div>
    <div class="vin-strip">${[...v.padEnd(17, '·')].map((c, i) => `<span class="${grp(i)}">${esc(c)}<small>${i + 1}</small></span>`).join('')}</div>
    <p class="muted" style="margin-top:-6px"><span style="color:#8fb6ff">■</span> producător (1–3) · <span style="color:#7fe0a8">■</span> descriere vehicul (4–9) · <span style="color:#ffd27a">■</span> an, uzină, serie (10–17)</p>
    <ul class="vin-checks">${res.checks.map(c => `<li><span class="ic">${ico[c.st]}</span><span class="tx"><b>${esc(c.title)}</b>${c.text ? '<span>' + esc(c.text) + '</span>' : ''}</span></li>`).join('')}</ul>`;
  $('#vin-pos').innerHTML = d.positions ? `<h3 class="sheet-sec">Ce înseamnă fiecare caracter</h3><div class="tblwrap"><table class="tbl"><tr><th>Poz.</th><th>Cod</th><th>Semnificație</th></tr>${[{ pos: '1–3', code: v.slice(0, 3), meaning: 'Producător: ' + (d.manufacturer || '') }].concat(d.positions.filter(p => p.pos !== '1–3')).map(p => `<tr><td>${p.pos}</td><td class="mono"><b>${esc(p.code)}</b></td><td>${esc(p.meaning)}</td></tr>`).join('')}</table></div>` +
    (d.region === 'EU' ? '<p class="muted">Motorizarea, culoarea și dotările nu sunt codificate în VIN-ul european — le găsiți pe eticheta de pe stâlpul ușii (cod motor, cod vopsea, dată fabricație).</p>' : '') : '';
  renderVinLinks(res.verdict !== 'bad' && v.length === 17 ? v : null);
}
function renderVinLinks(v) {
  const L = [
    ['carVertical', 'Decodare VIN gratuită + raport istoric UE (kilometraj, daune, fotografii)', 'https://www.carvertical.com/ro'],
    ['autoDNA', 'Decodare VIN gratuită + raport istoric UE (kilometraj, daune, furt)', 'https://www.autodna.com/'],
    ['🇷🇴 RAR — Istoric vehicul', 'Kilometraj la ITP, valabilitate ITP (oficial)', 'https://www.rarom.ro/'],
  ];
  if (v) L.push(['Google', 'Caută VIN-ul în anunțuri și licitații vechi (poze, daune)', 'https://www.google.com/search?q=' + encodeURIComponent('"' + v + '"')]);
  $('#vin-links').innerHTML = L.map(([n, d, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span><span class="en">${esc(n)}</span><br><span class="ed">${esc(d)}</span></span><span class="ea">↗</span></a>`).join('') +
    '<p class="muted">VIN-ul se copiază automat la clic, ca să îl lipiți în site.</p>';
  $$('#vin-links a').forEach(a => a.addEventListener('click', () => { if (v) copyText(v, 'VIN-ul'); }));
}
$('#btn-vin').addEventListener('click', () => {
  const v = ($('#vin-in').value || '').trim().toUpperCase();
  if (!v) { toast('Introduceți VIN-ul.'); $('#vin-in').focus(); return; }
  showPane('overview'); renderVinCheck();
  setTimeout(() => $('#vin-card').scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
});
$('#vin-in').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-vin').click(); });

function onVinInput() {
  const v = $('#vin-in').value.replace(/\s/g, '').toUpperCase();
  if ($('#vin-in').value !== v) $('#vin-in').value = v;
  const msg = $('#vin-msg');
  if (!v) { msg.textContent = ''; msg.className = 'vin-msg'; }
  else if (/[IOQ]/.test(v)) { msg.textContent = 'VIN-ul nu conține literele I, O sau Q — verificați (probabil cifrele 1 sau 0).'; msg.className = 'vin-msg err'; }
  else if (v.length < 17) { msg.textContent = `${v.length}/17 caractere`; msg.className = 'vin-msg'; }
  else { msg.textContent = /^[1-5]/.test(v) ? 'VIN nord-american' : 'Decodat după structura VIN Ford Europa. Motorul, culoarea și dotările sunt pe eticheta de pe stâlpul ușii.'; msg.className = 'vin-msg'; }
  if (S.scan.info && isVin(S.scan.info.vin) && v !== S.scan.info.vin && isVin(v)) S.scan.info = null;   // alt vehicul decât cel citit
  refreshAll();
}
$('#vin-in').addEventListener('input', onVinInput);
$('#btn-vin-copy').addEventListener('click', () => { if (isVin(currentVin())) copyText(currentVin(), 'VIN-ul'); else toast('Nu există un VIN valid.'); });
$('#btn-info').addEventListener('click', () => exclusive('Informații vehicul', async () => {
  await readVehicleInfo();
  if (!(S.scan.info || {}).vin) toast('ECU nu a raportat VIN-ul (frecvent la modelele mai vechi) — introduceți-l manual.', 5000);
  guessProfileFromScan(); refreshAll(); renderDash();
}));

/* ------------------------------ sub-file ------------------------------ */
function showPane(p) {
  $$('#info-sub button').forEach(b => b.classList.toggle('active', b.dataset.v === p));
  $$('#tab-info .info-pane').forEach(el => el.classList.toggle('hidden', el.dataset.pane !== p));
  store.set('infoPane', p);
}
$$('#info-sub button').forEach(b => b.addEventListener('click', () => showPane(b.dataset.v)));

/* ------------------------------ documente ------------------------------ */
const DOC_FIELDS = { rovTo: '#doc-rov-to', rcaIns: '#doc-rca-ins', rcaTo: '#doc-rca-to', itpDate: '#doc-itp-date', itpStation: '#doc-itp-station', itpKm: '#doc-itp-km', itpTo: '#doc-itp-to' };
function readDocs() { const d = {}; for (const [k, sel] of Object.entries(DOC_FIELDS)) d[k] = ($(sel).value || '').trim(); return d; }
function loadDocs() { const d = store.get(docKey(), {}); for (const [k, sel] of Object.entries(DOC_FIELDS)) $(sel).value = d[k] || ''; }
function docState(to) {
  if (!to) return { cls: '', txt: 'necompletat', short: 'necompletat' };
  const n = daysUntil(to);
  if (n < 0) return { cls: 'bad', txt: `expirat de ${-n} zile`, short: 'EXPIRAT' };
  if (n === 0) return { cls: 'bad', txt: 'expiră azi', short: 'expiră azi' };
  return { cls: n <= 30 ? 'warn' : 'ok', txt: `încă ${n} zile`, short: n <= 30 ? `${n} zile` : 'valabil' };
}
function renderDocBadges() {
  const d = readDocs();
  for (const [id, to] of [['#st-rov', d.rovTo], ['#st-rca', d.rcaTo], ['#st-itp', d.itpTo]]) {
    const s = docState(to); $(id).textContent = s.short; $(id).className = 'badge ' + s.cls;
  }
}
function saveDocs() {
  // ITP: autoturisme ≤ 12 ani → 2 ani, > 12 ani → 1 an (regula actuală RO)
  if ($('#doc-itp-date').value && !$('#doc-itp-to').value) {
    const y = parseInt((String(vehicleData().d.modelYear || '').match(/\d{4}/) || [])[0], 10);
    const age = y ? new Date($('#doc-itp-date').value).getFullYear() - y : 99;
    $('#doc-itp-to').value = addMonths($('#doc-itp-date').value, age > 12 ? 12 : 24);
  }
  store.set(docKey(), readDocs());
  const km = +$('#doc-itp-km').value;
  if (km && km > (+store.get(kmNowKey(), 0) || 0) && $('#doc-itp-date').value) store.set(kmNowKey(), km);
  renderDocBadges(); renderOverviewTiles(); renderKmCheck();
}
Object.values(DOC_FIELDS).forEach(sel => $(sel).addEventListener('change', saveDocs));
$$('#tab-info [data-copy="vin"]').forEach(a => a.addEventListener('click', () => { if (isVin(currentVin())) copyText(currentVin(), 'VIN-ul'); }));

/** Kilometrajul nu are voie să scadă în timp (ITP + jurnal + km actual) */
async function renderKmCheck() {
  const pts = [];
  (await svcEntries() || []).filter(e => e.km && e.date).forEach(e => pts.push({ date: e.date, km: +e.km, src: e.type }));
  const d = readDocs();
  if (d.itpDate && d.itpKm) pts.push({ date: d.itpDate, km: +d.itpKm, src: 'ITP' });
  const now = +store.get(kmNowKey(), 0);
  if (now) pts.push({ date: todayStr(), km: now, src: 'kilometraj actual' });
  pts.sort((a, b) => a.date.localeCompare(b.date));
  const drops = [];
  for (let i = 1; i < pts.length; i++) if (pts[i].km < pts[i - 1].km - 50) drops.push(`${fmtDate(pts[i - 1].date)}: ${fmtKm(pts[i - 1].km)} (${pts[i - 1].src}) → ${fmtDate(pts[i].date)}: ${fmtKm(pts[i].km)} (${pts[i].src})`);
  $('#km-check').innerHTML = drops.length
    ? `<div class="finding bad"><h4>⚠️ Kilometrajul scade în timp</h4><div class="txt">${drops.map(esc).join('<br>')}<br>Posibil kilometraj dat înapoi sau o înregistrare greșită — comparați cu raportul RAR.</div></div>`
    : '';
}

/* ------------------------------ service ------------------------------ */
const SVC_DEFAULTS = { 'Revizie (ulei + filtre)': { km: 15000, months: 12 }, 'Lichid frână': { months: 24 }, 'ITP': { months: 12 } };
function suggestNext() {
  const def = SVC_DEFAULTS[$('#svc-type').value]; if (!def) return;
  const km = +$('#svc-km').value;
  if (def.km && km && !$('#svc-next-km').value) $('#svc-next-km').value = km + def.km;
  if (def.months && !$('#svc-next-date').value) $('#svc-next-date').value = addMonths($('#svc-date').value, def.months);
}
$('#svc-type').addEventListener('change', () => { $('#svc-next-km').value = ''; $('#svc-next-date').value = ''; suggestNext(); });
$('#svc-km').addEventListener('change', suggestNext);
function openSvcForm(open) {
  $('#svc-form-card').classList.toggle('hidden', !open);
  $('#btn-svc-new').classList.toggle('hidden', open);
  if (open) { $('#svc-date').value = todayStr(); if (!$('#svc-km').value && store.get(kmNowKey())) $('#svc-km').value = store.get(kmNowKey()); suggestNext(); $('#svc-desc').focus(); }
}
$('#btn-svc-new').addEventListener('click', () => openSvcForm(true));
$('#btn-svc-cancel').addEventListener('click', () => openSvcForm(false));
$('#svc-km-now').addEventListener('change', () => { store.set(kmNowKey(), +$('#svc-km-now').value || null); refreshAll(); });

async function svcEntries() {
  try { return (await ServiceDB.all()).filter(e => e.vin === currentVin()).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.km || 0) - (a.km || 0)); }
  catch (_) { return null; }
}
function dueOf(list) {
  const kmNow = +store.get(kmNowKey(), 0) || Math.max(0, ...list.map(e => +e.km || 0));
  const latest = {};
  for (const e of list) if (!latest[e.type]) latest[e.type] = e;
  return Object.values(latest).filter(e => e.nextKm || e.nextDate).map(e => {
    const kmLeft = e.nextKm ? e.nextKm - kmNow : null, dLeft = e.nextDate ? daysUntil(e.nextDate) : null;
    const level = (kmLeft != null && kmLeft < 0) || (dLeft != null && dLeft < 0) ? 'bad' : (kmLeft != null && kmLeft < 1000) || (dLeft != null && dLeft < 30) ? 'warn' : 'ok';
    const parts = [];
    if (kmLeft != null) parts.push(kmLeft < 0 ? `depășit cu ${fmtKm(-kmLeft)}` : `în ${fmtKm(kmLeft)}`);
    if (dLeft != null) parts.push(dLeft < 0 ? `întârziat ${-dLeft} zile` : `până la ${fmtDate(e.nextDate)}`);
    return { type: e.type, level, text: parts.join(' sau '), sortKey: Math.min(kmLeft != null ? kmLeft / 50 : 1e9, dLeft != null ? dLeft : 1e9) };
  }).sort((a, b) => a.sortKey - b.sortKey);
}
async function renderService() {
  $('#svc-km-now').value = store.get(kmNowKey(), '') || '';
  const list = await svcEntries();
  if (list == null) { $('#svc-list').innerHTML = '<p class="muted">Stocarea locală nu este disponibilă în acest browser.</p>'; return; }
  const due = dueOf(list);
  $('#svc-due').innerHTML = due.map(x => `<div class="finding ${x.level}"><h4>${x.level === 'bad' ? '⏰' : x.level === 'warn' ? '⏳' : '✅'} ${esc(x.type)}</h4><div class="txt">${esc(x.text)}</div></div>`).join('');
  const total = list.reduce((s, e) => s + (+e.cost || 0), 0);
  $('#svc-list').innerHTML = list.length
    ? `<div class="card"><div class="row between"><h3>Istoric lucrări</h3><span class="muted">${list.length} lucrări${total ? ' · ' + total.toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' lei' : ''}</span></div>` +
      list.map(e => `<div class="svc-item"><div class="when">${fmtDate(e.date)}<br><span class="timeline-km">${e.km ? fmtKm(e.km) : ''}</span></div>
        <div class="what"><b>${esc(e.type)}</b>${esc(e.desc || '')}${e.shop ? ' <small>· ' + esc(e.shop) + '</small>' : ''}${e.cost ? ' <span class="badge">' + (+e.cost).toLocaleString('ro-RO') + ' lei</span>' : ''}</div>
        <div><button class="small" data-svcdel="${e.id}" title="Șterge">✕</button></div></div>`).join('') + '</div>'
    : '<div class="card muted">Nicio lucrare notată pentru acest vehicul. Apăsați „Adaugă lucrare” după fiecare revizie sau reparație.</div>';
  $$('[data-svcdel]').forEach(b => b.addEventListener('click', async () => { if (await confirmBox('Ștergeți această lucrare?')) { await ServiceDB.del(+b.dataset.svcdel); refreshAll(); } }));
}
$('#btn-svc-add').addEventListener('click', async () => {
  const e = { vin: currentVin(), date: $('#svc-date').value, km: +$('#svc-km').value || null, type: $('#svc-type').value, shop: $('#svc-shop').value.trim(), desc: $('#svc-desc').value.trim(), cost: +$('#svc-cost').value || null, nextKm: +$('#svc-next-km').value || null, nextDate: $('#svc-next-date').value || null, ts: Date.now() };
  if (!e.date) { toast('Alegeți data lucrării.'); return; }
  if (e.vin === 'necunoscut' && !await confirmBox('VIN-ul nu este cunoscut. Salvați lucrarea fără VIN?')) return;
  try { await ServiceDB.add(e); } catch (err) { toast('Nu s-a putut salva: ' + err.message, 5000); return; }
  if (e.km && e.km > (+store.get(kmNowKey(), 0) || 0)) store.set(kmNowKey(), e.km);
  ['#svc-km', '#svc-shop', '#svc-desc', '#svc-cost', '#svc-next-km', '#svc-next-date'].forEach(id => { $(id).value = ''; });
  openSvcForm(false); toast('Lucrare salvată'); refreshAll();
});
$('#btn-svc-dtc').addEventListener('click', () => {
  const codes = [...new Set([...scanCodes(S.scan).values()].map(c => c.code))];
  if (!codes.length) { toast('Ultima scanare nu are coduri de eroare.'); return; }
  $('#svc-desc').value = 'Reparat: ' + codes.map(c => c + ' (' + describeDTC(c) + ')').join('; ');
});
$('#btn-svc-csv').addEventListener('click', async () => {
  const list = await svcEntries(); if (!list || !list.length) { toast('Nu există lucrări de exportat.'); return; }
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const lines = ['VIN;Data;Km;Tip;Descriere;Service;Cost lei;Următoarea km;Următoarea dată'].concat(list.map(e => [e.vin, e.date, e.km, e.type, e.desc, e.shop, e.cost, e.nextKm, e.nextDate].map(q).join(';')));
  download('jurnal-service-' + currentVin() + '-' + stamp() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
});

/* ------------------------------ prezentare: tile-uri stare ------------------------------ */
async function renderOverviewTiles() {
  const d = store.get(docKey(), {});
  const tile = (name, s, sub) => `<div class="tile ${s.cls === 'bad' ? 'bad' : s.cls === 'warn' ? 'warnb' : s.cls === 'ok' ? 'ok' : ''}"><div class="n">${name}</div><div class="st">${esc(s.txt)}</div><div class="sd">${esc(sub || '')}</div></div>`;
  let html = tile('🛣️ Rovinietă', docState(d.rovTo), d.rovTo ? 'până la ' + fmtDate(d.rovTo) : 'completați în Documente')
    + tile('🛡️ RCA', docState(d.rcaTo), d.rcaTo ? 'până la ' + fmtDate(d.rcaTo) + (d.rcaIns ? ' · ' + d.rcaIns : '') : 'completați în Documente')
    + tile('🔧 ITP', docState(d.itpTo), d.itpTo ? 'până la ' + fmtDate(d.itpTo) : 'completați în Documente');
  const list = await svcEntries();
  const next = list && dueOf(list)[0];
  html += tile('🛠️ Următoarea lucrare', next ? { cls: next.level === 'ok' ? 'ok' : next.level, txt: next.type.replace(/\s*\(.*\)/, '') } : { cls: '', txt: '—' }, next ? next.text : 'adăugați o revizie în Service');
  $('#ov-tiles').innerHTML = html;
}

/* ------------------------------ verificare istoric ------------------------------ */
async function readIntegrity(progress) {
  const out = { ts: Date.now(), carVin: (S.scan.info || {}).vin || null, pids: {}, modules: [], findings: [] };
  await S.elm.resetHeader();
  if (!out.carVin) { const i = await S.obd.vehicleInfo(); out.carVin = i.vin || null; if (i.vin) S.scan.info = Object.assign(S.scan.info || {}, i); }
  for (const p of [0x31, 0x4E, 0x30, 0x21, 0x4D]) {
    if (!S.obd.supported.has(p)) continue;
    const r = await S.obd.readPid(p);
    if (r && typeof r.value === 'number') out.pids[p] = r.value;
  }
  await refreshMil();
  out.status = S.scan.status || null;
  if (S.elm.isCAN) {
    for (let i = 0; i < FORD_MODULES.length; i++) {
      const m = FORD_MODULES[i];
      progress && progress(i, FORD_MODULES.length, m);
      if (!await S.ford.ping(m)) continue;
      const row = { id: m.id, name: m.name, vin: null, sw: null, odo: null };
      let r = await S.ford._req(m, '22F190', 2000), msg = r.msgs.find(x => x.bytes[0] === 0x62);
      if (msg) row.vin = asciiOf(msg.bytes.slice(3));
      r = await S.ford._req(m, '22F188', 2000); msg = r.msgs.find(x => x.bytes[0] === 0x62);
      if (msg) row.sw = asciiOf(msg.bytes.slice(3));
      r = await S.ford._req(m, '22DD01', 2000); msg = r.msgs.find(x => x.bytes[0] === 0x62 && x.bytes[1] === 0xDD && x.bytes[2] === 0x01);
      if (msg && msg.bytes.length >= 6) { const b = msg.bytes.slice(3); row.odo = (b[0] << 16) | (b[1] << 8) | b[2]; }
      out.modules.push(row);
    }
    await S.elm.resetHeader();
  }
  evaluateIntegrity(out);
  return out;
}
function mostCommon(arr) { const c = {}; let best = null; for (const v of arr) { c[v] = (c[v] || 0) + 1; if (!best || c[v] > c[best]) best = v; } return best; }
function evaluateIntegrity(o) {
  const add = (level, title, text) => o.findings.push({ level, title, text: text || '' });
  const km = o.pids[0x31], warm = o.pids[0x30];
  if (km != null || warm != null) {
    const since = [km != null ? fmtKm(km) + (km >= 65535 ? '+' : '') : null, warm != null ? warm + ' porniri' + (warm >= 255 ? '+' : '') : null].filter(Boolean).join(' / ');
    const recent = (km != null && km < 200) || (warm != null && warm < 15);
    const inc = o.status ? o.status.monitors.filter(m => !m.complete).length : 0;
    if (recent && inc) add('bad', 'Erorile au fost șterse foarte recent', `Acum ${since}, iar monitoarele de emisii nu sunt finalizate. Tipic pentru erori șterse înainte de vânzare sau ITP — conduceți 1–2 zile și scanați din nou.`);
    else if (recent) add('warn', 'Erorile au fost șterse recent', `Acum ${since} (sau bateria a fost deconectată).`);
    else add('ok', 'Erorile nu au fost șterse recent', `Ultima ștergere: acum ${since}.`);
  }
  if (o.pids[0x21] > 0) add('warn', `${fmtKm(o.pids[0x21])} parcurși cu MIL/Check Engine aprins`);
  if (o.modules.length) {
    const vins = o.modules.filter(m => m.vin), ref = o.carVin || mostCommon(vins.map(m => m.vin));
    const diff = vins.filter(m => isVin(m.vin) && ref && m.vin !== ref), blank = vins.filter(m => !isVin(m.vin));
    if (diff.length) add('bad', `${diff.length} modul(e) provin de la alt vehicul`, diff.map(m => `${m.id} (${m.name}): ${m.vin}`).join('<br>') + '<br>Modul second-hand montat fără reconfigurare.');
    if (blank.length) add('warn', `${blank.length} modul(e) fără VIN programat`, blank.map(m => m.id).join(', ') + ' — modul înlocuit și neconfigurat.');
    if (vins.length && !diff.length && !blank.length) add('ok', `Toate cele ${vins.length} module au VIN-ul mașinii`, 'Nicio piesă electronică de la alt vehicul.');
    const odos = o.modules.filter(m => m.odo > 0);
    if (odos.length >= 2) {
      const spread = Math.max(...odos.map(m => m.odo)) - Math.min(...odos.map(m => m.odo));
      add(spread > 1000 ? 'warn' : 'ok', spread > 1000 ? 'Kilometraj diferit între module' : 'Kilometraj identic între module', odos.map(m => `${m.id}: ${fmtKm(m.odo)}`).join(' · ') + ' <i>(citire experimentală — comparați cu bordul)</i>');
    }
  }
  if (!o.findings.length) add('info', 'Mașina nu a raportat date de istoric', 'Vehiculul nu suportă aceste informații prin OBD.');
}
function renderIntegrity() {
  const o = S.scan.integrity;
  if (!o) { $('#integrity-out').innerHTML = ''; return; }
  const ico = { bad: '⚠️', warn: '⚠️', info: 'ℹ️', ok: '✅' };
  $('#integrity-out').innerHTML = o.findings.map(f => `<div class="finding ${f.level}"><h4>${ico[f.level]} ${esc(f.title)}</h4>${f.text ? '<div class="txt">' + f.text + '</div>' : ''}</div>`).join('') +
    (o.modules.length ? `<details><summary class="muted">Detalii module (${o.modules.length})</summary><div class="tblwrap"><table class="tbl"><tr><th>Modul</th><th>VIN memorat</th><th>Software</th></tr>${o.modules.map(m => `<tr><td><b>${m.id}</b></td><td class="mono">${m.vin ? esc(m.vin) + (m.vin === o.carVin ? ' ✅' : ' ⚠️') : '—'}</td><td class="mono">${esc(m.sw || '—')}</td></tr>`).join('')}</table></div></details>` : '') +
    `<p class="muted">Verificat la ${new Date(o.ts).toLocaleString('ro-RO')}</p>`;
}
$('#btn-integrity').addEventListener('click', () => exclusive('Verificare istoric', async () => {
  $('#integrity-out').innerHTML = '<p class="muted">Citire… <span id="int-prog"></span></p>';
  S.scan.integrity = await readIntegrity((i, n, m) => { const el = $('#int-prog'); if (el) el.textContent = `modul ${i + 1}/${n}: ${m.name}`; });
  renderIntegrity(); refreshAll();
}));

function renderExtLinks() {
  const vin = currentVin();
  const L = [
    ['🇷🇴 RAR — Istoric vehicul / Auto-Pass', 'Kilometraj la ITP, reparații raportate, rechemări (oficial)', 'https://www.rarom.ro/'],
    ['carVertical', 'Raport istoric UE: kilometraj, daune, fotografii (contra cost)', 'https://www.carvertical.com/ro'],
    ['autoDNA', 'Raport istoric UE: kilometraj, daune, furt (contra cost)', 'https://www.autodna.com/'],
  ];
  if (isVin(vin)) L.push(['Google', 'Caută VIN-ul în anunțuri și licitații vechi', 'https://www.google.com/search?q=' + encodeURIComponent('"' + vin + '"')]);
  if (/^[1-5]/.test(vin)) L.push(['NHTSA (SUA)', 'Rechemări pentru vehicule din SUA', 'https://www.nhtsa.gov/recalls']);
  $('#ext-history-links').innerHTML = L.map(([n, d, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer"><span><span class="en">${esc(n)}</span><br><span class="ed">${esc(d)}</span></span><span class="ea">↗</span></a>`).join('');
  $$('#ext-history-links a').forEach(a => a.addEventListener('click', () => { if (isVin(currentVin())) copyText(currentVin(), 'VIN-ul'); }));
}

/* ------------------------------ reîmprospătare ------------------------------ */
function refreshAll() {
  loadDocs(); renderDocBadges();
  renderInfo(); renderExtLinks(); renderIntegrity();
  renderService(); renderKmCheck();
}
window.refreshSvc = refreshAll;
$$('#tabs button').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab === 'info') refreshAll(); }));

/* raport: secțiune integritate */
const _reportHtmlV = reportHtml;
reportHtml = function () {
  let html = _reportHtmlV();
  const o = S.scan.integrity;
  if (o) {
    const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    html += '<h2>Verificare istoric vehicul</h2><table><tr><th>Constatare</th><th>Detalii</th></tr>' + o.findings.map(f => `<tr><td>${esc(strip(f.title))}</td><td>${esc(strip(f.text))}</td></tr>`).join('') + '</table>';
  }
  return html;
};

showPane(store.get('infoPane', 'overview'));
refreshAll();
