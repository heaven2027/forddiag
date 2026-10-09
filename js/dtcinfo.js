/* =====================================================================
 * dtcinfo.js — Fișă completă pentru un cod de eroare
 *   descriere, sistem, gravitate („pot să conduc?”), cauze, pași de remediere,
 *   note Ford pe motor, context, linkuri de căutare online, întrebare pentru AI.
 *   Pentru codurile fără fișă dedicată (DTC_KNOWLEDGE), pașii se generează din
 *   tipul defectului (circuit deschis / scurt / plauzibilitate / comunicație …).
 * ===================================================================== */
'use strict';

/* ------------------------------ sistemul afectat ------------------------------ */
function dtcSystem(code) {
  const L = code[0], d1 = code[1], d2 = code[2];
  if (L === 'P') {
    const sub = { '0': 'Măsurare aer/combustibil și emisii auxiliare', '1': 'Măsurare aer/combustibil', '2': 'Măsurare aer/combustibil (circuit injectoare)', '3': 'Sistem de aprindere / rateuri', '4': 'Control emisii auxiliare (EGR, EVAP, catalizator, aer secundar)', '5': 'Viteză vehicul, ralanti și intrări auxiliare', '6': 'Calculator (PCM) și ieșiri auxiliare', '7': 'Transmisie', '8': 'Transmisie', '9': 'Transmisie / SAE rezervat', A: 'Propulsie hibridă', B: 'Propulsie hibridă', C: 'Propulsie hibridă' };
    if (d1 === '2' || d1 === '0') return 'Motor/transmisie — ' + (sub[d2] || 'general');
    if (d1 === '1') return 'Motor/transmisie (cod Ford) — ' + (sub[d2] || 'general');
    return 'Motor/transmisie — ' + (sub[d2] || 'general');
  }
  if (L === 'U') return { '0': 'Rețea — electric magistrală / pierdere comunicație / date invalide', '1': 'Rețea (cod Ford)', '2': 'Rețea (cod Ford)', '3': 'Rețea / modul (SAE rezervat)' }[d1] || 'Rețea comunicații';
  if (L === 'B') return 'Caroserie (confort, iluminare, PATS, airbag, bord)' + (d1 !== '0' ? ' — cod Ford' : '');
  if (L === 'C') return 'Șasiu (ABS, ESP, direcție, suspensie)' + (d1 !== '0' ? ' — cod Ford' : '');
  return '';
}
function isGeneric(code) {
  const L = code[0], d1 = code[1];
  return (L === 'P' && (d1 === '0' || d1 === '2' || (d1 === '3' && code[2] >= '4'))) || (L !== 'P' && d1 === '0');
}

/* ------------------------------ „pot să conduc?” ------------------------------ */
function driveAdvice(code, desc) {
  const c = code.toUpperCase(), d = desc.toLowerCase();
  if (/^P03\d\d/.test(c)) return { level: 'bad', text: 'Conduceți cât mai puțin și fără accelerări puternice. Dacă lampa MIL/Check Engine CLIPEȘTE, opriți: rateurile supraîncălzesc și distrug catalizatorul în câteva minute.' };
  if (/supraîncălzire|supratemperatură|P0217|P1299|P1285/i.test(c + d)) return { level: 'bad', text: 'OPRIȚI motorul imediat. Continuarea mersului poate deforma chiulasa / arde garnitura.' };
  if (/presiune ulei/.test(d)) return { level: 'bad', text: 'OPRIȚI motorul și verificați nivelul uleiului. Fără presiune de ulei motorul se poate gripa.' };
  if (/airbag|pretensioner|centur/.test(d) || /^B19/.test(c)) return { level: 'warn', text: 'Vehiculul se poate conduce, dar airbag-urile / pretensionerele pot fi dezactivate. Reparați cât mai curând.' };
  if (/abs|frân|turație roată|esp|girație/.test(d) || /^C/.test(c)) return { level: 'warn', text: 'Frânele normale funcționează, dar ABS/ESP pot fi dezactivate. Conduceți prudent (mai ales pe ud) și reparați curând.' };
  if (/clapetă|pedală|mod avarie|putere limitată/.test(d)) return { level: 'warn', text: 'Motorul poate intra în mod avarie (putere redusă) brusc. Evitați depășirile și autostrada până la reparare.' };
  if (/pats|transponder|imobiliz|cheie/.test(d)) return { level: 'warn', text: 'Motorul poate refuza pornirea. Păstrați cheia de rezervă la îndemână.' };
  if (/transmisie|treapta|schimbare|tcc|ambreiaj|tft/.test(d)) return { level: 'warn', text: 'Cutia poate intra în mod avarie (treaptă fixă). Evitați sarcinile mari; verificați nivelul uleiului de cutie.' };
  if (/dpf|filtru particule|turbo|supraalimentare|presiune rampă/.test(d)) return { level: 'warn', text: 'Putere redusă posibilă. Se poate conduce moderat până la service; nu ignorați — riscul crește (DPF colmatat, turbină).' };
  if (/evap|bușon|aer secundar|catalizator|încălzire sondă/.test(d) || c === 'P1000') return { level: 'ok', text: 'Se poate conduce normal. Defectul afectează emisiile / ITP, nu siguranța. Programați reparația.' };
  if (/pierdere comunicație|date invalide|magistral/.test(d)) return { level: 'warn', text: 'Efectul depinde de modulul afectat. Dacă totul funcționează normal, poate fi un cod istoric (după baterie descărcată).' };
  return { level: 'warn', text: 'De regulă se poate conduce cu prudență până la service. Dacă apar simptome (pierdere de putere, zgomote, fum, temperatură mare), opriți.' };
}

/* ------------------------------ pași generați din tipul defectului ------------------------------ */
const STEP_RULES = [
  [/circuit deschis|întrerupt|lipsă semnal|fără semnal/, ['Verificați mufa componentei: pini oxidați, împinși sau rupți; zăvorul mufei.', 'Verificați continuitatea cablajului între componentă și calculator (multimetru, < 1 Ω).', 'Verificați siguranța și alimentarea componentei (12 V sau referința de 5 V).']],
  [/semnal scăzut|circuit scăzut|scurt la masă|tensiune scăzută/, ['Căutați un fir cu izolația ros care atinge caroseria/motorul (scurt la masă).', 'Deconectați componenta: dacă valoarea citită sare la maxim, componenta e defectă; dacă rămâne mică, cablajul e în scurt.', 'Verificați tensiunea de referință 5 V a senzorului.']],
  [/semnal ridicat|circuit ridicat|scurt la baterie|tensiune ridicată/, ['Verificați masa senzorului (fir de masă întrerupt → semnal maxim).', 'Căutați un scurt între firul de semnal și o alimentare.', 'Măsurați senzorul conform valorilor din manualul de service.']],
  [/domeniu\/performanță|neplauzibil|corelație|performanță/, ['Comparați valoarea senzorului în Date live cu valori normale / cu un senzor înrudit (ex. ECT vs IAT la rece, MAP vs barometric cu motor oprit).', 'Verificați cauzele mecanice care pot face valoarea reală anormală (scurgeri, înfundări, blocaje).', 'Abia apoi înlocuiți senzorul.']],
  [/intermitent|neregulat/, ['Cu motorul pornit, mișcați cablajul și mufa (wiggle test) urmărind valoarea în Date live.', 'Căutați zone unde cablajul se freacă sau e expus la căldură/vibrații.']],
  [/pierdere comunicație/, ['Verificați alimentarea și masa modulului indicat (siguranțe!).', 'Verificați tensiunea bateriei — sub 11 V modulele pierd comunicația.', 'Verificați mufa modulului și conectorii magistralei CAN (oxidare, apă).', 'Dacă vehiculul funcționează normal: ștergeți codul și verificați dacă revine (poate fi istoric).']],
  [/date invalide/, ['Citiți codurile modulului care trimite datele (fila Module Ford).', 'Poate necesita actualizare software / configurare As-Built la service Ford sau FORScan.']],
  [/rateuri/, ['Citiți contoarele pe cilindri (Teste ghidate → Rateuri pe cilindri).', 'Verificați bujiile (uzură, distanță electrozi) și bobinele: inversați bobina cu alt cilindru și urmăriți dacă defectul se mută.', 'Verificați corecțiile de combustibil (aer fals) și, dacă persistă, compresia.']],
  [/încălzire sondă/, ['Verificați siguranța încălzirii sondelor lambda.', 'Măsurați rezistența încălzirii sondei (tipic 2–20 Ω la rece) la mufă.', 'Dacă rezistența e infinită → sondă defectă.']],
  [/sondă o2|lambda/, ['Verificați scurgerile de evacuare înaintea sondei (aer fals → sondă indică sărac).', 'Rulați testul ghidat „Sondă lambda”.', 'Verificați corecțiile de combustibil — un amestec real deviat nu e vina sondei.']],
  [/evap|bușon|canistr|purjare/, ['Verificați bușonul rezervorului (garnitură, clic la strângere).', 'Inspectați furtunele EVAP din compartimentul motor și de lângă rezervor.', 'Testați supapa de purjare / aerisire (comandă și etanșeitate). Ideal: test cu fum.']],
  [/egr|dpfe/, ['Demontați și curățați supapa EGR și canalele de calamină.', 'Verificați furtunele de vacuum / senzorul DPFE (Ford benzină).', 'Verificați comanda supapei (actuator electric sau vacuum).']],
  [/solenoid|supapă|actuator|releu|motor actuator/, ['Măsurați rezistența bobinei componentei și comparați cu valoarea din manual.', 'Verificați că primește alimentare și comandă (lampă de test / multimetru).', 'Verificați mecanic dacă se blochează (calamină, murdărie).']],
  [/injector/, ['Măsurați rezistența injectorului (benzină tipic 12–16 Ω; diesel piezo/electromagnetic — vezi manual).', 'Verificați mufa și cablajul injectorului.', 'La diesel: test de retur al injectoarelor.']],
  [/bobină/, ['Inversați bobina cu alt cilindru: dacă defectul se mută, bobina e defectă.', 'Verificați mufa bobinei și alimentarea 12 V.']],
  [/tensiune sistem|tensiune baterie|alternator|încărcare/, ['Rulați testul ghidat „Baterie și încărcare”.', 'Curățați și strângeți bornele bateriei și masele motor-caroserie.', 'Verificați cureaua accesoriilor și alternatorul.']],
  [/transmisie|treapta|schimbare|tcc|convertizor|tft|domeniu transmisie/, ['Verificați nivelul și starea uleiului de cutie (culoare, miros de ars).', 'Citiți codurile modulului TCM (fila Module Ford).', 'Verificați mufa cutiei de viteze / blocul de supape (pierderi de ulei în mufă).']],
  [/dpf|filtru particule|funingine|cenușă/, ['Mers 20–30 min pe drum deschis la > 2500 rpm pentru regenerare.', 'Verificați furtunele senzorului de presiune diferențială DPF.', 'Dacă nu reușește: regenerare forțată la service (FORScan/IDS) sau curățare DPF.']],
  [/turbo|supraalimentare|wastegate|geometrie/, ['Verificați furtunele intercoolerului (fisuri, coliere, pete de ulei).', 'Verificați vacuumul / comanda actuatorului turbo.', 'Verificați jocul axului turbinei și urmele de ulei.']],
  [/presiune rampă|presiune combustibil|pompă/, ['Înlocuiți filtrul de combustibil (diesel: și aerisiți sistemul).', 'Verificați presiunea combustibilului cu manometru / în Date live.', 'Verificați pompa și regulatorul de presiune.']],
  [/pats|transponder|cheie/, ['Încercați cheia de rezervă.', 'Verificați antena PATS din jurul contactului (mufă).', 'Programarea cheilor necesită FORScan/IDS sau service.']],
  [/turație roată|abs/, ['Verificați cablajul senzorului de turație a roții (des frecat de bielete / brațe).', 'Scoateți și curățați senzorul (pilitură metalică).', 'Verificați inelul de impulsuri / rulmentul roții.']],
  [/airbag|pretensioner|ocupant/, ['⚠️ Deconectați bateria și așteptați ≥ 1 minut înainte de a lucra la sistemul airbag.', 'Verificați mufele de sub scaunele față (frecvent deconectate la mutarea scaunelor).', 'Verificați banda spiralată a volanului (clockspring) dacă defectul e la airbag-ul șoferului.']],
  [/sonde o2 inversate/, ['Mufele sondelor lambda bancul 1 / bancul 2 au fost inversate (frecvent după înlocuirea sondelor sau a evacuării) — verificați traseul cablurilor.']],
  [/debitmetru|maf/, ['Verificați mufa senzorului MAF și alimentarea lui (12 V + masă).', 'Curățați senzorul MAF cu spray dedicat.', 'Comparați debitul MAF în Date live cu valoarea așteptată (testul „Corecții combustibil”).']],
  [/injectoare/, ['Verificați alimentarea comună a injectoarelor (siguranță/releu) și mufele.', 'Măsurați rezistența fiecărui injector.']],
  [/bobine/, ['Verificați alimentarea 12 V și mufa bobinei/bobinelor.', 'La bobina tip bloc (Duratec Sigma): verificați fisuri și urme de arc electric.']],
  [/neînvățat/, ['Efectuați procedura de învățare a variației arborelui cotit (decelerări repetate de la ~4000 rpm fără frână, sau cu FORScan/IDS) după înlocuirea senzorului CKP, volantei sau PCM.']],
  [/intrare turație/, ['Verificați semnalul de turație motor primit de TCM (cablaj PCM–TCM sau magistrala CAN).']],
  [/alt modul/, ['Cod informativ: scanați toate modulele (fila Module Ford) pentru a găsi codul real.']],
  [/ax came|vct|sincronizare prea/, ['Verificați nivelul și calitatea uleiului (ulei vechi / vâscozitate greșită blochează sistemul VCT).', 'Verificați solenoidul VCT: rezistență (tipic 6–13 Ω), sită/filtru înfundat, comandă.', 'Dacă persistă: verificați calarea distribuției și uzura lanțului/curelei.']],
  [/amestec|post-catalizator|aer fals|scurgere aer/, ['Rulați testul ghidat „Corecții combustibil” (ralanti vs 2500 rpm) pentru a separa aerul fals de alimentare.', 'Căutați aer fals: furtun PCV, garnitura galeriei de admisie, furtunele de vacuum, servofrâna (test cu fum ideal).', 'Curățați senzorul MAF; verificați presiunea combustibilului și filtrul.', 'Verificați scurgerile de evacuare înaintea sondei lambda.']],
  [/catalizator/, ['Rezolvați întâi orice cod de rateuri, amestec sau sondă lambda — acestea distrug / păcălesc catalizatorul.', 'Rulați testul ghidat „Catalizator” (sonda aval trebuie să fie stabilă).', 'Verificați scurgerile de evacuare între catalizator și sonda aval.', 'Abia apoi înlocuiți catalizatorul (sau sonda aval dacă e leneșă).']],
  [/termostat|lichid răcire insuficientă/, ['Rulați testul ghidat „Termostat”.', 'Verificați nivelul lichidului de răcire și aerisirea sistemului.', 'Comparați temperatura citită cu cea reală (senzor ECT decalibrat).']],
  [/supraîncălzire|supratemperatură|temperatură internă/, ['Opriți motorul; la rece verificați nivelul lichidului de răcire.', 'Verificați funcționarea ventilatorului (pornește la ~100 °C sau cu A/C pornit).', 'Verificați pompa de apă, termostatul, radiatorul înfundat și pierderile (inclusiv urme de gaze în vasul de expansiune).']],
  [/ventilator/, ['Verificați siguranța și releul ventilatorului (inversați cu un releu identic).', 'Alimentați direct motorul ventilatorului pentru a-l testa.', 'Verificați mufa modulului ventilatorului (FCM la unele Ford).']],
  [/bujii incandescente|bujie incandescentă|încălzitor aer admisie/, ['Măsurați rezistența fiecărei bujii incandescente (tipic 0,5–2 Ω); infinit = bujie arsă.', 'Verificați modulul/releul bujiilor și siguranța mare (60–80 A).', 'Verificați bara/firele de alimentare de pe bujii (oxidare).']],
  [/aer secundar/, ['Verificați pompa de aer secundar (pornește la pornire la rece ~1 min).', 'Verificați supapa de comutare și furtunele (adesea înfundate cu condens).', 'Verificați releul și siguranța pompei.']],
  [/ralanti|iac/, ['Curățați corpul clapetei și supapa IAC (unde există) de depuneri.', 'Căutați aer fals.', 'După curățare: lăsați motorul la ralanti 10 min pentru reînvățare (sau procedură cu FORScan).']],
  [/imrc|clapete galerie|galerie admisie/, ['Verificați vizual tija și actuatorul clapetelor galeriei de admisie (se rupe/desprinde).', 'Verificați vacuumul / comanda electrică a actuatorului.', 'Curățați clapetele de calamină dacă sunt blocate.']],
  [/clapetă|etc|pedală|tp /, ['Curățați corpul clapetei (motor oprit, contact OFF) — depunerile pot bloca clapeta.', 'Verificați mufa corpului clapetei și a pedalei (pini oxidați).', 'Rulați testul ghidat „Pedală accelerație”.', 'După înlocuire / curățare poate fi necesară reînvățarea.']],
  [/modul control|procesor|memorie|ram|rom|checksum|programare|kam|vid|vin neprogramat|configurație|software|ecu defect|defect intern|nvm|as-built/, ['Verificați tensiunea bateriei și masele modulului (o alimentare slabă produce false erori interne).', 'Ștergeți codul: dacă revine imediat, modulul necesită reprogramare/configurare (FORScan sau service Ford) sau înlocuire.', 'Dacă modulul a fost înlocuit recent: trebuie configurat (As-Built / VID) pentru vehicul.']],
  [/magistral|bus off|comunicație|scp|can /, ['Verificați tensiunea bateriei și masele.', 'Verificați mufa OBD și conectorii modulelor (apă, oxidare) — rezistența între pinii 6 și 14 ai prizei OBD trebuie să fie ~60 Ω (HS-CAN) cu contactul OFF.', 'Deconectați pe rând modulele suspecte pentru a găsi unul care blochează magistrala.']],
  [/cruise/, ['Verificați butoanele de pe volan și banda spiralată (clockspring).', 'Verificați comutatoarele de frână/ambreiaj care dezactivează cruise control-ul.']],
  [/comutator|contact|frână/, ['Verificați reglajul și funcționarea comutatorului (ex. comutatorul pedalei de frână: stopurile se aprind?).', 'Verificați mufa și alimentarea comutatorului.', 'Înlocuiți comutatorul dacă semnalul nu se schimbă în Date live.']],
  [/presiune ulei/, ['OPRIȚI motorul și verificați nivelul uleiului.', 'Verificați presiunea reală cu un manometru mecanic.', 'Verificați senzorul/comutatorul de presiune și mufa lui (pierderi de ulei în mufă).']],
  [/apă în combustibil/, ['Purjați apa din filtrul de motorină (șurub de golire).', 'Înlocuiți filtrul de motorină dacă e vechi; alimentați la altă stație.']],
  [/scurgere sistem combustibil|contribuție|echilibrare|sincronizare injecție|presiune control injectoare/, ['Verificați pierderile vizibile de motorină pe conducte și injectoare.', 'Test de retur al injectoarelor (diferențe mari = injector uzat).', 'Verificați compresia cilindrului indicat.']],
  [/lampă|ieșire|turometru/, ['Verificați becul/LED-ul și cablajul ieșirii indicate.', 'Verificați mufa bordului și a calculatorului.']],
  [/raport|marșarier/, ['Verificați nivelul și starea uleiului de cutie.', 'Verificați codurile TCM și senzorii de turație intrare/ieșire.', 'Patinare persistentă = uzură internă (ambreiaje/benzi) — service specializat.']],
  [/turație maximă|limitator/, ['Cod informativ: motorul a atins limitatorul de turație/viteză. Verificați dacă a existat o supraturație reală (schimbare greșită de treaptă).']],
  [/autotest|koer|monitoare obd/, ['Cod informativ al autotestului Ford. Repetați autotestul respectând condițiile (motor cald, consumatori opriți, fără accelerare).', 'Pentru P1000: conduceți un ciclu complet.']],
  [/4x4|anvelope\/punte/, ['Verificați configurarea dimensiunii anvelopelor / raportului de punte în PCM (FORScan/IDS) după schimbarea roților.', 'Verificați comutatorul 4x4 și cablajul cutiei de transfer.']],
  [/demaror/, ['Verificați releul de pornire și semnalul de la contact.', 'Verificați comutatorul pedalei de ambreiaj / domeniul P-N.']],
  [/servodirecție/, ['Verificați nivelul lichidului de servodirecție.', 'Verificați comutatorul/senzorul de presiune și mufa lui.']],
  [/octanic|detonație/, ['Folosiți combustibil cu cifra octanică recomandată.', 'Verificați senzorul de detonație (cuplu de strângere, mufă).']],
  [/idm|semnal diagnoză aprindere/, ['Verificați bobinele și cablajul primar al aprinderii.', 'Verificați masa modulului de aprindere.']],
  [/alimentare|tensiune/, ['Rulați testul ghidat „Baterie și încărcare”.', 'Verificați siguranțele și releul de alimentare al calculatorului.']],
  [/– scăzut|scăzut$/, ['Verificați un scurt la masă al circuitului sau o componentă defectă (rezistență prea mică).']],
  [/– ridicat|ridicat$/, ['Verificați un circuit întrerupt / scurt la alimentare al componentei.']],
  [/senzor/, ['Verificați mufa și cablajul senzorului.', 'Comparați valoarea senzorului în Date live cu valoarea reală așteptată.', 'Verificați alimentarea (5 V) și masa senzorului.']],
];

function genericSteps(desc) {
  const d = desc.toLowerCase(), out = [];
  for (const [re, steps] of STEP_RULES) if (re.test(d)) for (const s of steps) if (!out.includes(s)) out.push(s);
  if (!out.length) out.push('Verificați componenta și cablajul indicat în descriere.', 'Consultați manualul de service pentru valorile de referință.');
  return out.slice(0, 8);
}

/** Fișa completă a codului */
function dtcDetails(code, ctx = {}) {
  code = code.toUpperCase();
  const desc = describeDTC(code);
  const know = DTC_KNOWLEDGE[code];
  const engine = ctx.engine ? ENGINES[ctx.engine] : null;
  const fordNotes = engine && ENGINE_ISSUES[ctx.engine] ? ENGINE_ISSUES[ctx.engine].filter(i => i.includes(code)) : [];
  const steps = [];
  if (know) know.checks.forEach(s => steps.push(s));
  genericSteps(desc).forEach(s => { if (!steps.includes(s)) steps.push(s); });
  steps.push('După reparație: ștergeți codurile, conduceți un ciclu complet și verificați că nu revine (fila Istoric → comparație).');
  return {
    code, desc, system: dtcSystem(code), generic: isGeneric(code), known: !!(DTC_DB[code]),
    severity: dtcSeverity(code), drive: driveAdvice(code, desc),
    causes: know ? know.causes : null, steps, fordNotes,
    ftb: ctx.ftbText || '', active: ctx.active, confirmed: ctx.confirmed, src: ctx.src || '',
  };
}

/* ------------------------------ căutare online + AI ------------------------------ */
function vehicleLabel(profile) {
  const v = profile && profile.vehicle !== 'other' && VEHICLES.find(x => x.id === profile.vehicle);
  const e = profile && ENGINES[profile.engine];
  return [v ? v.name.replace(/\s*\(.*\)/, '') : 'Ford', e ? e.name.replace(/\s*\(.*\)/, '') : ''].filter(Boolean).join(' ').replace(/^(?!Ford)/, 'Ford ');
}
function searchLinks(code, profile) {
  const veh = vehicleLabel(profile);
  const g = q => 'https://www.google.com/search?q=' + encodeURIComponent(q);
  const links = [
    { label: 'Google: cod + vehicul', url: g(`${code} ${veh}`) },
    { label: 'Google (română): cauze și soluții', url: g(`cod eroare ${code} ${veh} cauze soluție`) },
    { label: 'YouTube: cum se repară', url: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(`${code} ${veh} fix`) },
    { label: 'Forumuri Ford', url: g(`${code} ${veh} forum`) },
  ];
  if (/^P[0-3]/.test(code)) links.push({ label: 'OBD-Codes.com', url: 'https://www.obd-codes.com/' + code.toLowerCase() });
  return links;
}
function aiPrompt(det, ctx) {
  const lines = [
    `Am un ${vehicleLabel(ctx.profile)}${ctx.vin ? ' (VIN ' + ctx.vin + ')' : ''}${ctx.year ? ', an ' + ctx.year : ''}.`,
    `Diagnoza OBD arată codul ${det.code}${det.ftb ? ' (tip defect Ford: ' + det.ftb + ')' : ''} — „${det.desc}”${det.src ? ', raportat de modulul ' + det.src : ''}${det.active === false ? ', defect istoric (nu e activ acum)' : ''}.`,
  ];
  if (ctx.others && ctx.others.length) lines.push('Alte coduri prezente: ' + ctx.others.join(', ') + '.');
  if (ctx.ff) lines.push('Freeze frame: ' + ctx.ff + '.');
  if (ctx.live) lines.push('Date live: ' + ctx.live + '.');
  lines.push('Explică-mi ce înseamnă, care sunt cele mai probabile cauze pe acest model și motor (în ordinea probabilității și a costului), cum le verific pas cu pas cu unelte obișnuite și dacă pot conduce mașina până la reparație.');
  return lines.join('\n');
}

window.DtcInfo = { dtcDetails, searchLinks, aiPrompt, dtcSystem, driveAdvice, genericSteps };
