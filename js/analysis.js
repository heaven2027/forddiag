/* =====================================================================
 * analysis.js — Analiză automată (sistem expert bazat pe reguli)
 *   Intrări: rezultatul scanării (coduri, readiness, freeze frame, module),
 *            un instantaneu de date live (~6 s) și profilul vehiculului.
 *   Ieșire: listă de constatări { level: bad|warn|info|ok, title, text, actions[] }
 * ===================================================================== */
'use strict';

const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const minOf = a => a.length ? Math.min(...a) : null;
const maxOf = a => a.length ? Math.max(...a) : null;
const f1 = v => v == null ? '—' : (Math.round(v * 10) / 10).toString();
const f2 = v => v == null ? '—' : (Math.round(v * 100) / 100).toString();

/** Numără traversările pragului (comutări sondă lambda) */
function crossings(series, thr) {
  let n = 0;
  for (let i = 1; i < series.length; i++) if ((series[i - 1] - thr) * (series[i] - thr) < 0) n++;
  return n;
}

function analyze(scan, snap, profile) {
  const out = [];
  const add = (level, title, text, actions = []) => out.push({ level, title, text, actions });
  const engine = profile && ENGINES[profile.engine];
  const diesel = engine ? engine.fuel === 'diesel' : !!(scan.status && scan.status.diesel);

  /* ---------- coduri de eroare ---------- */
  const codes = [];
  if (scan.dtcs) {
    scan.dtcs.stored.forEach(d => codes.push({ code: d.code, src: 'motor', kind: 'memorat' }));
    scan.dtcs.pending.forEach(d => codes.push({ code: d.code, src: 'motor', kind: 'în așteptare' }));
    scan.dtcs.permanent.forEach(d => codes.push({ code: d.code, src: 'motor', kind: 'permanent' }));
  }
  Object.values(scan.modules || {}).forEach(m => (m.dtcs || []).forEach(d => codes.push({ code: d.code, src: m.mod.id, kind: d.confirmed ? 'confirmat' : 'istoric', active: d.active })));
  const has = c => codes.some(x => x.code === c);
  const hasRe = re => codes.some(x => re.test(x.code));

  if (scan.status && scan.status.mil) add('bad', 'Lampa de avarie motor (MIL/Check Engine) este aprinsă', `ECU raportează ${scan.status.dtcCount} cod(uri) confirmat(e) care cer aprinderea lămpii.`, ['Rezolvați codurile de mai jos înainte de ITP.']);

  // combinații de coduri (cauze comune)
  if (has('P0171') && has('P0174')) add('warn', 'Amestec sărac pe ambele bancuri (P0171 + P0174)', 'Un defect comun ambelor bancuri e mai probabil decât două defecte separate.', ['Verificați MAF, presiunea combustibilului, furtunul PCV / scurgerile de vacuum comune.']);
  if (has('P0172') && has('P0175')) add('warn', 'Amestec bogat pe ambele bancuri (P0172 + P0175)', 'Cauză comună probabilă.', ['Verificați presiunea combustibilului, supapa de purjare EVAP, MAF.']);
  if (hasRe(/^P030\d/) && hasRe(/^P017[14]/)) add('warn', 'Rateuri însoțite de amestec sărac', 'Rateurile pot fi provocate de amestecul sărac (aer fals), nu de aprindere.', ['Rezolvați întâi amestecul sărac.']);
  if (hasRe(/^P04[23]0/) && (hasRe(/^P030\d/) || hasRe(/^P017[1-5]/))) add('warn', 'Cod catalizator împreună cu rateuri / amestec incorect', 'Catalizatorul poate fi doar o consecință. Nu-l înlocuiți înainte de a rezolva cauza.', ['Rezolvați rateurile/amestecul, ștergeți codurile, reverificați după un ciclu de conducere.']);
  const uCount = codes.filter(c => /^U/.test(c.code)).length;
  if (uCount >= 3) add('warn', `Multe coduri de comunicație (${uCount} coduri U)`, 'Apar adesea după o baterie descărcată, pornire cu cabluri sau intervenții la instalația electrică.', ['Verificați bateria (testul „Baterie și încărcare”), ștergeți toate codurile și reverificați.']);
  if (has('P1000')) add('info', 'P1000: monitoarele OBD nu sunt finalizate', 'Normal după ștergerea codurilor sau după deconectarea bateriei. Nu este un defect.', ['Conduceți ~30 minute (oraș + drum deschis).']);
  if (has('P1299') || has('P0217') || has('P1285')) add('bad', 'PROTECȚIE SUPRATEMPERATURĂ MOTOR', 'Motorul s-a supraîncălzit. Continuarea mersului poate distruge garnitura de chiulasă.', ['Opriți motorul, verificați lichidul de răcire la rece, ventilatorul, pompa de apă.']);

  // fiecare cod cu bază de cunoștințe
  const seen = new Set();
  for (const c of codes) {
    if (seen.has(c.code)) continue; seen.add(c.code);
    const k = DTC_KNOWLEDGE[c.code];
    const where = codes.filter(x => x.code === c.code).map(x => x.src + ' (' + x.kind + ')').join(', ');
    const sev = dtcSeverity(c.code);
    add(sev === 'ridicată' ? 'bad' : sev === 'scăzută' ? 'info' : 'warn', `${c.code} — ${describeDTC(c.code)}`,
      'Raportat de: ' + where + (k ? '<br><b>Cauze probabile:</b><ol>' + k.causes.map(x => '<li>' + x + '</li>').join('') + '</ol>' : ''),
      k ? k.checks : ['Deschideți fișa codului pentru pașii de verificare și căutarea online.']);
    out[out.length - 1].code = c.code;
    out[out.length - 1].src = codes.find(x => x.code === c.code).src;
  }

  /* ---------- probleme cunoscute pe motorul ales ---------- */
  if (profile && ENGINE_ISSUES[profile.engine]) {
    const issues = ENGINE_ISSUES[profile.engine];
    const matched = issues.filter(i => (i.match(/[PCBU][0-9A-F]{4}/g) || []).some(code => has(code)));
    if (matched.length) add('warn', 'Coduri care corespund problemelor cunoscute ale motorului ' + engine.name, '<ul>' + matched.map(x => '<li>' + x + '</li>').join('') + '</ul>');
    add('info', 'Probleme frecvent raportate pentru ' + engine.name, '<ul>' + issues.map(x => '<li>' + x + '</li>').join('') + '</ul>');
  }

  /* ---------- readiness ---------- */
  if (scan.status) {
    const inc = scan.status.monitors.filter(m => !m.complete);
    if (inc.length) add(inc.length > 1 ? 'warn' : 'info', `${inc.length} monitor(e) readiness incomplet(e)`, inc.map(m => m.name).join(', ') + '. Unele programe de inspecție (ex. SUA, benzină 2001+) acceptă maximum 1 monitor incomplet; regulile diferă pe țări.', ['Conduceți un ciclu complet: pornire la rece, ralanti 2 min, oraș, 10 min la viteză constantă 80–100 km/h, decelerări fără frână.']);
    else add('ok', 'Toate monitoarele readiness sunt complete', 'Vehiculul este pregătit pentru testul de emisii.');
  }

  /* ---------- freeze frame ---------- */
  if (scan.ff && scan.ff.values && scan.ff.values.length) {
    const g = n => { const v = scan.ff.values.find(x => x.pid === n); return v && typeof v.value === 'number' ? v.value : null; };
    const ect = g(0x05), rpm = g(0x0C), spd = g(0x0D), load = g(0x04);
    const ctx = [];
    if (ect != null) ctx.push(ect < 60 ? `motor rece (${f1(ect)} °C)` : `motor cald (${f1(ect)} °C)`);
    if (rpm != null) ctx.push(rpm < 1000 ? 'la ralanti' : `la ${Math.round(rpm)} rpm`);
    if (spd != null) ctx.push(spd < 3 ? 'vehicul staționar' : `la ${Math.round(spd)} km/h`);
    if (load != null) ctx.push(`sarcină ${Math.round(load)}%`);
    add('info', 'Contextul apariției defectului (freeze frame' + (scan.ff.dtc ? ' ' + scan.ff.dtc : '') + ')', 'Defectul a apărut ' + ctx.join(', ') + '. Reproduceți aceleași condiții când verificați reparația.');
  }

  /* ---------- instantaneu date live ---------- */
  if (snap && snap.samples > 0) {
    const s = snap.series;
    const rpm = avg(s[0x0C] || []);
    const running = rpm != null && rpm > 400;
    const volt = avg(s.volt || s[0x42] || []);
    if (volt != null) {
      if (running) {
        if (volt < 13.0) add('bad', `Tensiune de încărcare scăzută: ${f2(volt)} V`, 'Cu motorul pornit, tensiunea ar trebui să fie 13,5–14,8 V.', ['Verificați alternatorul, cureaua, bornele și masa motor-caroserie.', 'Rulați testul „Baterie și încărcare”.']);
        else if (volt < 13.4) add('warn', `Tensiune de încărcare la limită: ${f2(volt)} V`, 'Poate fi normală pe vehiculele Ford cu încărcare inteligentă (Smart Charge/BMS: Mondeo Mk4, S-Max, Galaxy, Kuga), altfel indică alternator slab.');
        else if (volt > 14.9) add('bad', `Supraîncărcare: ${f2(volt)} V`, 'Regulator de tensiune defect – risc de deteriorare a bateriei și electronicii.');
        else add('ok', `Încărcare normală: ${f2(volt)} V`, '');
      } else {
        if (volt < 12.0) add('bad', `Baterie descărcată: ${f2(volt)} V`, 'Cu motorul oprit, o baterie încărcată are 12,5–12,8 V.', ['Încărcați bateria și testați-o cu un tester de sarcină.']);
        else if (volt < 12.4) add('warn', `Baterie parțial descărcată: ${f2(volt)} V`, '');
        else add('ok', `Tensiune baterie bună: ${f2(volt)} V`, '');
      }
    }
    const ect = avg(s[0x05] || []), runtime = maxOf(s[0x1F] || []);
    if (ect != null) {
      if (ect > 108) add('bad', `Temperatură lichid de răcire ridicată: ${f1(ect)} °C`, 'Risc de supraîncălzire.', ['Verificați nivelul lichidului, ventilatorul și termostatul.']);
      else if (running && runtime != null && runtime > 900 && ect < 75) add('warn', `Motorul nu atinge temperatura de lucru (${f1(ect)} °C după ${Math.round(runtime / 60)} min)`, 'Cauza tipică: termostat blocat deschis' + (diesel ? ' (la diesel, încălzirea la ralanti poate fi foarte lentă — verificați în mers).' : '.'), ['Rulați testul ghidat „Termostat”.']);
      else if (running && ect >= 80 && ect <= 105) add('ok', `Temperatură motor normală: ${f1(ect)} °C`, '');
    }
    if (running && !diesel) {
      for (const [st, lt, bank] of [[0x06, 0x07, 1], [0x08, 0x09, 2]]) {
        if (!s[st] || !s[lt]) continue;
        const total = avg(s[st]) + avg(s[lt]);
        const txt = `STFT ${f1(avg(s[st]))}% + LTFT ${f1(avg(s[lt]))}% = ${f1(total)}%`;
        if (total > 20) add('bad', `Amestec foarte sărac pe bancul ${bank}`, txt + '. ECU adaugă mult combustibil pentru a compensa.', ['Aer fals (PCV, galerie admisie), MAF murdar, presiune combustibil scăzută.', 'Rulați testul „Corecții combustibil” pentru a separa cauzele.']);
        else if (total > 10) add('warn', `Tendință de amestec sărac pe bancul ${bank}`, txt, ['Rulați testul „Corecții combustibil”.']);
        else if (total < -20) add('bad', `Amestec foarte bogat pe bancul ${bank}`, txt, ['Injector care picură, presiune combustibil mare, purjare EVAP blocată deschis.']);
        else if (total < -10) add('warn', `Tendință de amestec bogat pe bancul ${bank}`, txt);
        else add('ok', `Corecții de combustibil normale pe bancul ${bank}`, txt);
      }
      const o2 = s[0x14];
      if (o2 && o2.length >= 10) {
        const mn = minOf(o2), mx = maxOf(o2), n = crossings(o2, 0.45);
        if (mx - mn < 0.15) add('warn', 'Sonda lambda amonte (B1S1) nu comută', `Tensiune ${f2(mn)}–${f2(mx)} V în ${snap.seconds} s. Poate fi buclă deschisă (motor rece / decelerare) sau sondă îmbătrânită.`, ['Repetați cu motorul cald la 2500 rpm (testul „Sondă lambda”).']);
        else add('ok', 'Sonda lambda amonte comută', `${n} traversări ale pragului de 0,45 V, interval ${f2(mn)}–${f2(mx)} V.`);
        const o2d = s[0x15];
        if (o2d && o2d.length >= 10) {
          const nd = crossings(o2d, 0.45);
          if (n >= 4 && nd >= n * 0.6) add('warn', 'Sonda aval copiază sonda amonte', `Amonte ${n} comutări, aval ${nd}. Catalizatorul pare să nu mai stocheze oxigen.`, ['Rulați testul „Catalizator” cu motorul cald.']);
        }
      }
    }
    const load = avg(s[0x04] || []);
    if (running && rpm < 1000 && load != null && load > 45 && !diesel) add('info', `Sarcină calculată ridicată la ralanti: ${f1(load)}%`, 'Normal 15–35% fără consumatori. Valori mari: A/C pornit, consumatori, sau restricții la admisie/evacuare.');
    const rpmS = s[0x0C] || [];
    if (running && rpm < 1100 && rpmS.length > 8) {
      const sd = Math.sqrt(avg(rpmS.map(x => (x - rpm) ** 2)));
      if (sd > 60) add('warn', `Ralanti instabil (abatere ±${Math.round(sd)} rpm)`, 'Cauze: aer fals, IAC/clapetă murdară, rateuri, injectoare.', ['Rulați testul „Rateuri pe cilindri”.']);
    }
    if (snap.fuelStatus && /deschis.*defect/i.test(snap.fuelStatus)) add('warn', 'Sistemul de combustibil funcționează în buclă deschisă din cauza unui defect', snap.fuelStatus);
  }

  /* ---------- module ---------- */
  const mods = Object.values(scan.modules || {});
  if (mods.length) {
    const present = mods.filter(m => m.present);
    const withDtc = present.filter(m => (m.dtcs || []).length);
    if (!withDtc.length) add('ok', `Niciun cod în cele ${present.length} module care au răspuns`, present.map(m => m.mod.id).join(', '));
    const abs = present.find(m => m.mod.id === 'ABS'), rcm = present.find(m => m.mod.id === 'RCM');
    if (rcm && (rcm.dtcs || []).length) add('bad', 'Coduri în modulul airbag (RCM)', 'Sistemul de siguranță pasivă poate fi dezactivat.', ['Nu lucrați la sistemul airbag fără deconectarea bateriei și pauza de siguranță.']);
    if (abs && (abs.dtcs || []).some(d => /^C11[4-7]5|^C123[3-6]/.test(d.code))) add('warn', 'Problemă la un senzor de turație roată (ABS)', 'ABS/ESP pot fi dezactivate; poate afecta și vitezometrul / P0500.');
  }

  if (!codes.length && scan.dtcs) add('ok', 'Nu există coduri de eroare memorate în ECU motor', '');
  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

window.Analysis = { analyze, crossings, avg, minOf, maxOf };
