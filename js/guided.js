/* =====================================================================
 * guided.js — Teste ghidate pas cu pas
 *   Fiecare test primește un context `ctx` furnizat de interfață:
 *     ctx.ask(html, buton)  → așteaptă confirmarea utilizatorului (sau abandon)
 *     ctx.say(html)         → afișează instrucțiunea curentă
 *     ctx.sample(opts)      → { series: {pid:[..], volt:[..]}, t:[..] } pe durata opts.ms
 *     ctx.has(pid)          → PID suportat de ECU
 *     ctx.obd, ctx.elm, ctx.engine (profil motor sau null)
 *   Returnează constatări { level, title, text }.
 * ===================================================================== */
'use strict';

const G = {
  avg: a => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null),
  min: a => (a && a.length ? Math.min(...a) : null),
  max: a => (a && a.length ? Math.max(...a) : null),
  r1: v => (v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1)),
  r2: v => (v == null ? '—' : (Math.round(v * 100) / 100).toFixed(2)),
};
function socFromVoltage(v) {
  // stare de încărcare aproximativă baterie plumb-acid 12 V în repaus (≥ 2 h)
  const t = [[12.73, 100], [12.62, 90], [12.50, 80], [12.37, 70], [12.24, 60], [12.10, 50], [11.96, 40], [11.81, 30], [11.66, 20], [11.51, 10]];
  for (const [vt, p] of t) if (v >= vt) return p;
  return 0;
}

const GUIDED_TESTS = [
  {
    id: 'battery', name: 'Baterie și încărcare', icon: '🔋',
    desc: 'Tensiune în repaus, cădere de tensiune la demaraj, încărcare la ralanti și sub sarcină.',
    async run(ctx) {
      const R = [];
      await ctx.ask('Motorul <b>oprit</b>, contactul pe ON, toți consumatorii stinși (lumini, ventilator). Ideal: mașina a stat ≥ 2 ore.');
      let s = await ctx.sample({ volt: true, ms: 4000 });
      const v0 = G.avg(s.series.volt);
      const soc = socFromVoltage(v0);
      R.push({ level: v0 >= 12.4 ? 'ok' : v0 >= 12.1 ? 'warn' : 'bad', title: `Tensiune în repaus: ${G.r2(v0)} V`, text: `Stare de încărcare estimată ≈ ${soc}%. (Valoare corectă doar după ≥ 2 h de repaus.)` });

      await ctx.ask('Apăsați <b>Continuă</b> și apoi <b>porniți motorul</b> în următoarele 10 secunde.', 'Continuă — pornesc motorul');
      s = await ctx.sample({ volt: true, ms: 12000, fast: true });
      const vc = G.min(s.series.volt);
      if (vc == null) R.push({ level: 'warn', title: 'Demarajul nu a putut fi măsurat', text: 'Unele adaptoare se resetează la demaraj. Repetați testul.' });
      else R.push({ level: vc >= 10.0 ? 'ok' : vc >= 9.6 ? 'warn' : 'bad', title: `Tensiune minimă la demaraj: ${G.r2(vc)} V`, text: vc >= 10 ? 'Bateria și demarorul sunt în parametri.' : vc >= 9.6 ? 'La limită — bateria începe să slăbească (mai ales iarna).' : (v0 >= 12.4 ? 'Bateria încărcată dar cade mult la demaraj → baterie uzată (sulfatare) sau demaror cu consum mare.' : 'Bateria e descărcată — încărcați-o și repetați testul.') + ' (Rata de eșantionare a adaptorului poate rata vârful real.)' });

      await ctx.ask('Lăsați motorul la <b>ralanti</b>, fără consumatori.');
      s = await ctx.sample({ volt: true, pids: [0x0C], ms: 10000 });
      const vi = G.avg(s.series.volt);
      R.push({ level: vi >= 13.4 && vi <= 14.8 ? 'ok' : vi > 14.8 ? 'bad' : 'warn', title: `Încărcare la ralanti: ${G.r2(vi)} V`, text: vi > 14.8 ? 'Supraîncărcare — regulator defect.' : vi < 13.4 ? 'Încărcare slabă. Notă: vehiculele Ford cu Smart Charge / senzor BMS (Mondeo Mk4, S-Max, Galaxy, Kuga) coboară intenționat tensiunea la ~12,8–13,2 V când bateria e plină.' : 'Alternatorul încarcă normal.' });

      await ctx.ask('Porniți <b>faza lungă, ventilatorul la maxim și luneta încălzită</b>, apoi țineți motorul la <b>~2000 rpm</b>.');
      s = await ctx.sample({ volt: true, pids: [0x0C], ms: 12000 });
      const vl = G.avg(s.series.volt), rpm = G.avg(s.series[0x0C]);
      R.push({ level: vl >= 13.2 ? 'ok' : vl >= 12.8 ? 'warn' : 'bad', title: `Încărcare sub sarcină: ${G.r2(vl)} V la ${Math.round(rpm || 0)} rpm`, text: vl >= 13.2 ? 'Alternatorul face față consumatorilor.' : 'Alternatorul nu acoperă consumul — verificați cureaua, alternatorul (diode/perii), bornele.' });
      return R;
    },
  },
  {
    id: 'thermostat', name: 'Termostat (încălzire motor)', icon: '🌡️',
    desc: 'Urmărește curba de încălzire de la motor rece. Detectează termostat blocat deschis.',
    async run(ctx) {
      await ctx.ask('Porniți testul cu <b>motorul rece</b> (stat ≥ 4 ore). Porniți motorul și lăsați-l la ralanti sau plecați la drum (recomandat la diesel). Testul durează max. 20 minute; îl puteți opri oricând cu <b>Oprește și evaluează</b>.');
      const s = await ctx.sample({ pids: [0x05, 0x0C, 0x0D], ms: 20 * 60 * 1000, periodMs: 2000, stopWhen: v => v[0x05] >= 92, allowStop: true });
      const ect = s.series[0x05] || [], t = s.t;
      if (ect.length < 3) return [{ level: 'warn', title: 'Date insuficiente', text: 'Nu s-a putut citi temperatura lichidului de răcire.' }];
      const start = ect[0], end = ect[ect.length - 1], mins = t[t.length - 1] / 60;
      const timeTo = th => { const i = ect.findIndex(v => v >= th); return i < 0 ? null : t[i] / 60; };
      const t70 = timeTo(70), t80 = timeTo(80);
      const R = [{ level: 'info', title: `Încălzire: ${G.r1(start)} → ${G.r1(end)} °C în ${G.r1(mins)} min`, text: `Timp până la 70 °C: ${t70 ? G.r1(t70) + ' min' : 'neatins'} · până la 80 °C: ${t80 ? G.r1(t80) + ' min' : 'neatins'}.` }];
      if (start > 50) R.push({ level: 'warn', title: 'Motorul nu era rece la start', text: 'Rezultatul e mai puțin concludent.' });
      // deschiderea termostatului: scădere bruscă 2–6 °C după vârf, apoi stabilizare
      let peak = -99, dip = 0;
      for (const v of ect) { if (v > peak) peak = v; dip = Math.max(dip, peak - v); }
      if (end >= 85) R.push({ level: 'ok', title: 'Motorul atinge temperatura de lucru', text: dip >= 2 ? `S-a observat deschiderea termostatului (scădere ${G.r1(dip)} °C după ${G.r1(peak)} °C).` : 'Termostatul pare funcțional.' });
      else if (mins >= 12 && end < 75) R.push({ level: 'bad', title: 'Motorul nu se încălzește suficient', text: (ctx.engine && ctx.engine.fuel === 'diesel') ? 'La diesel, la ralanti încălzirea e lentă — dacă testul a fost în mers, termostatul e probabil blocat deschis.' : 'Termostat probabil blocat deschis (sau senzor ECT decalibrat). Consecințe: consum mărit, P0128, încălzire slabă în habitaclu.' });
      else R.push({ level: 'info', title: 'Test neconcludent', text: 'Lăsați testul să ruleze mai mult (≥ 12 min).' });
      return R;
    },
  },
  {
    id: 'trims', name: 'Corecții combustibil (ralanti / 2500 rpm)', icon: '⛽',
    desc: 'Separă aerul fals de problemele de alimentare sau MAF (doar benzină).',
    async run(ctx) {
      if (ctx.engine && ctx.engine.fuel === 'diesel') return [{ level: 'info', title: 'Test disponibil doar pentru motoare pe benzină', text: '' }];
      const pids = [0x06, 0x07, 0x08, 0x09, 0x0C, 0x05, 0x10, 0x04].filter(p => ctx.has(p));
      await ctx.ask('Motorul <b>cald</b> (≥ 80 °C), la ralanti, fără consumatori, A/C oprit.');
      const a = await ctx.sample({ pids, ms: 30000 });
      if (G.avg(a.series[0x05]) < 70) await ctx.ask('⚠️ Motorul pare rece. Rezultatele pot fi eronate. Continuați oricum?');
      await ctx.ask('Țineți motorul constant la <b>~2500 rpm</b> timp de 30 secunde (vehicul staționar, frâna de mână trasă).');
      const b = await ctx.sample({ pids, ms: 30000 });
      const R = [];
      const res = [];
      for (const [st, lt, bank] of [[0x06, 0x07, 1], [0x08, 0x09, 2]]) {
        if (!a.series[st] || !a.series[lt]) continue;
        const idle = G.avg(a.series[st]) + G.avg(a.series[lt]);
        const high = G.avg(b.series[st]) + G.avg(b.series[lt]);
        res.push({ bank, idle, high });
        R.push({ level: 'info', title: `Bancul ${bank}: ralanti ${G.r1(idle)}% · 2500 rpm ${G.r1(high)}%`, text: `(STFT+LTFT; normal între −10% și +10%)` });
      }
      const maf = G.avg(a.series[0x10]), mafH = G.avg(b.series[0x10]);
      if (maf != null) R.push({ level: 'info', title: `MAF: ${G.r2(maf)} g/s la ralanti · ${G.r2(mafH)} g/s la 2500 rpm`, text: ctx.engine ? `Orientativ, la ralanti cald un motor de ${ctx.engine.disp.toFixed(1)} L consumă ~${G.r1(ctx.engine.disp * 1.2)}–${G.r1(ctx.engine.disp * 2.2)} g/s.` : '' });
      for (const r of res) {
        if (r.idle > 10 && r.high < r.idle - 6) R.push({ level: 'bad', title: `Bancul ${r.bank}: sărac la ralanti, se corectează la turație`, text: 'Tipic pentru <b>aer fals</b> (vacuum leak): furtun PCV, garnitură galerie, servofrână, furtune vacuum. La turație mare, aerul fals contează proporțional mai puțin.' });
        else if (r.idle > 10 && r.high > 10) R.push({ level: 'bad', title: `Bancul ${r.bank}: sărac la toate turațiile`, text: 'Tipic pentru <b>debit de combustibil insuficient</b> (filtru, pompă, regulator) sau <b>MAF murdar</b> care subestimează aerul.' });
        else if (r.idle < -10 && r.high > r.idle + 6) R.push({ level: 'warn', title: `Bancul ${r.bank}: bogat la ralanti`, text: 'Posibil: supapa de purjare EVAP blocată deschis sau un injector care picură.' });
        else if (r.idle < -10 && r.high < -10) R.push({ level: 'warn', title: `Bancul ${r.bank}: bogat la toate turațiile`, text: 'Presiune combustibil prea mare, MAF care supraestimează, injectoare.' });
        else if (Math.abs(r.idle) <= 10 && Math.abs(r.high) <= 10) R.push({ level: 'ok', title: `Bancul ${r.bank}: amestec corect`, text: '' });
      }
      if (!res.length) R.push({ level: 'warn', title: 'ECU nu raportează corecțiile de combustibil', text: '' });
      return R;
    },
  },
  {
    id: 'o2', name: 'Sondă lambda amonte (B1S1)', icon: '🧪',
    desc: 'Verifică amplitudinea și frecvența de comutare a sondei lambda (motor cald, 2500 rpm).',
    async run(ctx) {
      const narrow = ctx.has(0x14), wide = ctx.has(0x24) ? 0x24 : ctx.has(0x34) ? 0x34 : null;
      if (!narrow && !wide) return [{ level: 'warn', title: 'ECU nu raportează sonda lambda B1S1', text: 'Pe motoarele diesel sonda e de bandă largă și adesea nu e expusă prin OBD standard.' }];
      await ctx.ask('Motorul <b>cald</b>. Țineți constant <b>~2500 rpm</b> timp de 20 secunde.');
      const pid = narrow ? 0x14 : wide;
      const s = await ctx.sample({ pids: [pid], ms: 20000, fast: true });
      const v = s.series[pid] || [];
      if (v.length < 10) return [{ level: 'warn', title: 'Date insuficiente', text: '' }];
      const dur = s.t[s.t.length - 1] || 20;
      if (narrow) {
        const mn = G.min(v), mx = G.max(v), n = Analysis.crossings(v, 0.45), hz = n / 2 / dur;
        const R = [{ level: 'info', title: `Interval ${G.r2(mn)}–${G.r2(mx)} V · ${n} traversări în ${G.r1(dur)} s (~${G.r2(hz)} Hz)`, text: `Rată eșantionare: ${G.r1(v.length / dur)} citiri/s — frecvența reală poate fi mai mare decât cea măsurată.` }];
        if (mx - mn < 0.3) R.push({ level: 'bad', title: 'Sonda nu comută', text: 'Sondă defectă/îmbătrânită, buclă deschisă, sau amestec mult deviat (verificați corecțiile).' });
        else if (mn > 0.3) R.push({ level: 'warn', title: 'Sonda nu coboară sub 0,3 V', text: 'Amestec bogat sau sondă contaminată (lichid de răcire, silicon).' });
        else if (mx < 0.7) R.push({ level: 'warn', title: 'Sonda nu urcă peste 0,7 V', text: 'Amestec sărac, aer fals în evacuare înaintea sondei, sau sondă îmbătrânită.' });
        else if (hz < 0.3) R.push({ level: 'warn', title: 'Sonda comută lent', text: 'Sondă îmbătrânită (P0133 / P1131 posibile în viitor).' });
        else R.push({ level: 'ok', title: 'Sonda lambda funcționează normal', text: '' });
        return R;
      }
      const lam = G.avg(v), dev = G.max(v.map(x => Math.abs(x - lam)));
      return [{ level: Math.abs(lam - 1) < 0.05 ? 'ok' : 'warn', title: `Lambda medie ${G.r2(lam)} (abatere max ${G.r2(dev)})`, text: 'Sondă de bandă largă: în buclă închisă media trebuie să fie ≈ 1,00.' }];
    },
  },
  {
    id: 'cat', name: 'Eficiență catalizator', icon: '♻️',
    desc: 'Compară activitatea sondei amonte cu cea aval (motor cald, 2500 rpm).',
    async run(ctx) {
      if (!ctx.has(0x14) || !ctx.has(0x15)) return [{ level: 'warn', title: 'ECU nu raportează sondele B1S1 și B1S2 (tensiune)', text: 'Testul necesită sonde lambda clasice (benzină).' }];
      await ctx.ask('Motorul <b>bine încălzit</b> (după ≥ 10 min de mers). Țineți constant <b>~2500 rpm</b> timp de 30 secunde.');
      const s = await ctx.sample({ pids: [0x14, 0x15], ms: 30000, fast: true });
      const up = s.series[0x14] || [], dn = s.series[0x15] || [];
      const nu = Analysis.crossings(up, 0.45), nd = Analysis.crossings(dn, 0.45);
      const ratio = nu ? nd / nu : null, dAvg = G.avg(dn), dRange = G.max(dn) - G.min(dn);
      const R = [{ level: 'info', title: `Amonte: ${nu} comutări · Aval: ${nd} comutări · raport ${ratio == null ? '—' : G.r2(ratio)}`, text: `Sonda aval: medie ${G.r2(dAvg)} V, variație ${G.r2(dRange)} V.` }];
      if (nu < 4) R.push({ level: 'warn', title: 'Sonda amonte comută prea puțin pentru evaluare', text: 'Rulați întâi testul „Sondă lambda”.' });
      else if (ratio > 0.6 || dRange > 0.6) R.push({ level: 'bad', title: 'Catalizator ineficient', text: 'Sonda aval urmărește sonda amonte → catalizatorul nu mai stochează oxigen (P0420 probabil). Verificați întâi să nu existe rateuri sau scurgeri de evacuare.' });
      else if (dAvg < 0.45) R.push({ level: 'warn', title: 'Sonda aval indică permanent sărac', text: 'Posibil aer fals în evacuare (fisură, garnitură) sau sondă aval defectă.' });
      else R.push({ level: 'ok', title: 'Catalizator eficient', text: 'Sonda aval este stabilă.' });
      return R;
    },
  },
  {
    id: 'misfire', name: 'Rateuri pe cilindri (Mode 06)', icon: '🔥',
    desc: 'Citește contoarele de rateuri ale fiecărui cilindru și creșterea lor la ralanti.',
    async run(ctx) {
      const cyl = ctx.engine ? (ctx.engine.disp > 4 ? 8 : ctx.engine.disp > 2.6 ? 6 : 4) : 8;
      await ctx.ask('Porniți motorul și lăsați-l la ralanti (cald, fără consumatori).');
      const a = await ctx.obd.readMisfire(cyl);
      if (!a) return [{ level: 'warn', title: 'ECU nu raportează contoare de rateuri pe cilindru', text: 'Funcție disponibilă de regulă pe Ford benzină CAN (2008+). Folosiți codurile P030x.' }];
      ctx.say('Măsurare 60 s la ralanti…');
      await ctx.sample({ pids: [0x0C], ms: 60000, periodMs: 1000 });
      const b = await ctx.obd.readMisfire(cyl);
      const rows = a.map((r, i) => ({ cyl: r.cyl, ewma: (b[i] || r).ewma, before: r.current, after: (b[i] || r).current }));
      const delta = rows.map(r => (r.after != null && r.before != null ? Math.max(0, r.after - r.before) : null));
      const tbl = '<table class="tbl"><tr><th>Cilindru</th><th>Medie 10 cicluri</th><th>Ciclu curent</th><th>Creștere în 60 s</th></tr>' + rows.map((r, i) => `<tr><td>${r.cyl}</td><td>${r.ewma ?? '—'}</td><td>${r.after ?? '—'}</td><td><b>${delta[i] ?? '—'}</b></td></tr>`).join('') + '</table>';
      const R = [{ level: 'info', title: 'Contoare rateuri', text: tbl }];
      const tot = delta.reduce((s, x) => s + (x || 0), 0);
      const worst = rows[delta.indexOf(Math.max(...delta.map(x => x || 0)))];
      if (tot === 0) R.push({ level: 'ok', title: 'Niciun rateu în timpul testului', text: '' });
      else if (worst && (delta[rows.indexOf(worst)] || 0) > tot * 0.6) R.push({ level: 'bad', title: `Rateuri concentrate pe cilindrul ${worst.cyl}`, text: 'Inversați bobina/bujia cu un cilindru vecin și repetați: dacă rateul se mută → bobină/bujie; dacă rămâne → injector sau compresie.' });
      else R.push({ level: 'warn', title: 'Rateuri distribuite pe mai mulți cilindri', text: 'Cauză comună: amestec sărac / aer fals, presiune combustibil, bujii uzate, bobină tip bloc (Duratec Sigma).' });
      return R;
    },
  },
  {
    id: 'idle', name: 'Stabilitate ralanti', icon: '〰️',
    desc: 'Măsoară variația turației și a sarcinii la ralanti.',
    async run(ctx) {
      await ctx.ask('Motorul cald, la ralanti, fără consumatori.');
      const pids = [0x0C, 0x04, 0x0B, 0x10].filter(p => ctx.has(p));
      const s = await ctx.sample({ pids, ms: 30000, fast: true });
      const r = s.series[0x0C] || [];
      if (r.length < 10) return [{ level: 'warn', title: 'Date insuficiente', text: '' }];
      const m = G.avg(r), sd = Math.sqrt(G.avg(r.map(x => (x - m) ** 2)));
      const R = [{ level: 'info', title: `Ralanti ${Math.round(m)} rpm (min ${Math.round(G.min(r))} / max ${Math.round(G.max(r))}, abatere ±${Math.round(sd)})`, text: `Sarcină medie ${G.r1(G.avg(s.series[0x04]))}%` }];
      if (m > 1100) R.push({ level: 'warn', title: 'Ralanti ridicat', text: 'Motor rece, aer fals, IAC blocată deschis, sau clapetă neînvățată.' });
      if (sd > 60) R.push({ level: 'bad', title: 'Ralanti instabil', text: 'Rulați testul „Rateuri pe cilindri” și „Corecții combustibil”. Curățați corpul clapetei / IAC.' });
      else if (sd > 30) R.push({ level: 'warn', title: 'Ralanti ușor instabil', text: '' });
      else R.push({ level: 'ok', title: 'Ralanti stabil', text: '' });
      return R;
    },
  },
  {
    id: 'pedal', name: 'Pedală accelerație și clapetă', icon: '🦶',
    desc: 'Verifică pistele senzorului de pedală (fără întreruperi) cu motorul oprit.',
    async run(ctx) {
      const pids = [0x49, 0x4A, 0x11, 0x45, 0x4C].filter(p => ctx.has(p));
      if (!pids.length) return [{ level: 'warn', title: 'ECU nu raportează poziția pedalei', text: '' }];
      await ctx.ask('Motorul <b>OPRIT</b>, contactul pe ON. După ce apăsați Continuă, <b>apăsați încet pedala până la capăt și eliberați-o încet</b>, de 2 ori, în 15 secunde.');
      const s = await ctx.sample({ pids, ms: 15000, fast: true });
      const R = [];
      for (const p of pids) {
        const v = s.series[p] || [];
        if (v.length < 5) continue;
        let jumps = 0;
        for (let i = 1; i < v.length; i++) if (Math.abs(v[i] - v[i - 1]) > 35) jumps++;
        R.push({ level: jumps ? 'warn' : 'info', title: `${OBD_PIDS[p].name}: ${G.r1(G.min(v))}% → ${G.r1(G.max(v))}%`, text: jumps ? `${jumps} salturi bruște — posibilă pistă uzată sau mișcare prea rapidă a pedalei.` : 'Variație continuă.' });
      }
      const d = s.series[0x49], e = s.series[0x4A];
      if (d && e && d.length === e.length && d.length > 5) {
        const ratios = d.map((x, i) => (x > 5 ? e[i] / x : null)).filter(x => x != null);
        const m = G.avg(ratios), sd = Math.sqrt(G.avg(ratios.map(x => (x - m) ** 2)));
        R.push({ level: sd < 0.08 ? 'ok' : 'warn', title: `Corelație piste D/E: raport ${G.r2(m)} ± ${G.r2(sd)}`, text: sd < 0.08 ? 'Pistele pedalei sunt corelate (OK).' : 'Pistele nu se urmăresc proporțional — posibil senzor pedală defect (P2138).' });
      }
      return R;
    },
  },
];

window.GUIDED_TESTS = GUIDED_TESTS;
window.socFromVoltage = socFromVoltage;
