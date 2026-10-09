/* =====================================================================
 * knowledge.js — Bază de cunoștințe pentru diagnoză
 *   - profile vehicule Ford 2007–2010 (model + motor)
 *   - cauze probabile și verificări pentru codurile frecvente
 *   - probleme cunoscute pe motorizări Ford (raportate frecvent în service)
 *   Informațiile sunt orientative: ordinea cauzelor = de la cea mai probabilă / ieftină.
 * ===================================================================== */
'use strict';

/* ------------------------------ motoare ------------------------------ */
const ENGINES = {
  'duratec-1.25':   { name: '1.25 Duratec 16V (Sigma)', disp: 1.242, fuel: 'benzina', turbo: false },
  'duratec-1.4':    { name: '1.4 Duratec 16V (Sigma)', disp: 1.388, fuel: 'benzina', turbo: false },
  'duratec-1.6':    { name: '1.6 Duratec 16V (Sigma)', disp: 1.596, fuel: 'benzina', turbo: false },
  'tivct-1.6':      { name: '1.6 Duratec Ti-VCT', disp: 1.596, fuel: 'benzina', turbo: false },
  'duratechE-1.8':  { name: '1.8 Duratec-HE (MZR)', disp: 1.798, fuel: 'benzina', turbo: false },
  'duratechE-2.0':  { name: '2.0 Duratec-HE (MZR)', disp: 1.999, fuel: 'benzina', turbo: false },
  'duratechE-2.3':  { name: '2.3 Duratec-HE (MZR)', disp: 2.261, fuel: 'benzina', turbo: false },
  'duratec-2.5T':   { name: '2.5 Duratec turbo (ST/RS/Kuga/Mondeo)', disp: 2.522, fuel: 'benzina', turbo: true },
  'ecoboost-2.0':   { name: '2.0 EcoBoost SCTi (2010)', disp: 1.999, fuel: 'benzina', turbo: true },
  'tdci-1.4':       { name: '1.4 TDCi (DV4)', disp: 1.399, fuel: 'diesel', turbo: true },
  'tdci-1.6':       { name: '1.6 TDCi (DV6)', disp: 1.560, fuel: 'diesel', turbo: true },
  'tdci-1.8':       { name: '1.8 TDCi (Lynx)', disp: 1.753, fuel: 'diesel', turbo: true },
  'tdci-2.0':       { name: '2.0 TDCi (DW10)', disp: 1.997, fuel: 'diesel', turbo: true },
  'tdci-2.2':       { name: '2.2 TDCi (DW12 / Duratorq)', disp: 2.179, fuel: 'diesel', turbo: true },
  'tdci-2.2T':      { name: '2.2 TDCi Transit (Duratorq Puma)', disp: 2.198, fuel: 'diesel', turbo: true },
  'tdci-2.4T':      { name: '2.4 TDCi Transit (Duratorq Puma)', disp: 2.402, fuel: 'diesel', turbo: true },
  'us-2.0':         { name: '2.0 Duratec (Focus SUA)', disp: 1.999, fuel: 'benzina', turbo: false },
  'us-2.3':         { name: '2.3 Duratec (Fusion/Escape)', disp: 2.261, fuel: 'benzina', turbo: false },
  'us-2.5':         { name: '2.5 Duratec (Fusion/Escape 2009+)', disp: 2.488, fuel: 'benzina', turbo: false },
  'us-3.0':         { name: '3.0 Duratec V6', disp: 2.967, fuel: 'benzina', turbo: false },
  'us-3.5':         { name: '3.5 Duratec V6', disp: 3.496, fuel: 'benzina', turbo: false },
  'us-4.0':         { name: '4.0 SOHC V6 (Explorer/Ranger/Mustang)', disp: 4.015, fuel: 'benzina', turbo: false },
  'us-4.6':         { name: '4.6 Modular V8 (2V/3V)', disp: 4.606, fuel: 'benzina', turbo: false },
  'us-5.4':         { name: '5.4 Triton 3V V8', disp: 5.408, fuel: 'benzina', turbo: false },
};

const VEHICLES = [
  { id: 'focus2',   name: 'Focus Mk2 (2004–2011)',          engines: ['duratec-1.4', 'duratec-1.6', 'tivct-1.6', 'duratechE-1.8', 'duratechE-2.0', 'duratec-2.5T', 'tdci-1.6', 'tdci-1.8', 'tdci-2.0'] },
  { id: 'cmax',     name: 'C-Max (2003–2010)',              engines: ['duratec-1.6', 'tivct-1.6', 'duratechE-1.8', 'duratechE-2.0', 'tdci-1.6', 'tdci-1.8', 'tdci-2.0'] },
  { id: 'mondeo4',  name: 'Mondeo Mk4 (2007–2014)',         engines: ['tivct-1.6', 'duratechE-2.0', 'duratechE-2.3', 'duratec-2.5T', 'ecoboost-2.0', 'tdci-1.8', 'tdci-2.0', 'tdci-2.2'] },
  { id: 'smax',     name: 'S-Max / Galaxy (2006–2015)',     engines: ['duratechE-2.0', 'duratechE-2.3', 'duratec-2.5T', 'ecoboost-2.0', 'tdci-1.8', 'tdci-2.0', 'tdci-2.2'] },
  { id: 'kuga1',    name: 'Kuga Mk1 (2008–2012)',           engines: ['duratec-2.5T', 'tdci-2.0'] },
  { id: 'fiesta6',  name: 'Fiesta Mk6 / Fusion (2002–2008)', engines: ['duratec-1.25', 'duratec-1.4', 'duratec-1.6', 'tdci-1.4', 'tdci-1.6'] },
  { id: 'fiesta7',  name: 'Fiesta Mk7 (2008–2017)',         engines: ['duratec-1.25', 'duratec-1.4', 'tivct-1.6', 'tdci-1.4', 'tdci-1.6'] },
  { id: 'transit',  name: 'Transit (2006–2013)',            engines: ['tdci-2.2T', 'tdci-2.4T'] },
  { id: 'connect',  name: 'Transit Connect (2002–2013)',    engines: ['tdci-1.8'] },
  { id: 'us-focus', name: 'Focus SUA (2008–2011)',          engines: ['us-2.0'] },
  { id: 'us-fusion',name: 'Fusion / Milan SUA (2006–2012)', engines: ['us-2.3', 'us-2.5', 'us-3.0', 'us-3.5'] },
  { id: 'us-escape',name: 'Escape / Mariner (2008–2012)',   engines: ['us-2.5', 'us-3.0'] },
  { id: 'us-f150',  name: 'F-150 (2004–2010)',              engines: ['us-4.6', 'us-5.4'] },
  { id: 'us-expl',  name: 'Explorer (2006–2010)',           engines: ['us-4.0', 'us-4.6'] },
  { id: 'us-must',  name: 'Mustang (2005–2010)',            engines: ['us-4.0', 'us-4.6'] },
  { id: 'other',    name: 'Alt model / necunoscut',         engines: Object.keys(ENGINES) },
];

/* ------------------------------ probleme cunoscute pe motor ------------------------------ */
const ENGINE_ISSUES = {
  'tivct-1.6': ['Carcasa termostatului din plastic fisurează → pierderi de lichid / P0128', 'Furtune PCV și garnitură galerie admisie → amestec sărac P0171', 'Bobină inducție defectă → rateuri P0300–P0304', 'Solenoizi VCT înfundați (ulei neschimbat) → P0011/P0012/P0016'],
  'duratec-1.6': ['Bobina de inducție (bloc unic) → rateuri P0300–P0304', 'Carcasa termostatului fisurată → P0128 / pierderi lichid', 'Supapa de ralanti (IAC) murdară → ralanti instabil P0505/P0506'],
  'duratec-1.4': ['Bobina de inducție → rateuri', 'Termostat / carcasă → P0128', 'Supapa IAC murdară → ralanti instabil'],
  'duratec-1.25': ['Bobina de inducție → rateuri', 'Termostat / carcasă → P0128', 'Supapa IAC murdară → ralanti instabil'],
  'duratechE-1.8': ['Furtunul PCV de sub galeria de admisie se fisurează → P0171 + ralanti instabil', 'Clapetele galeriei de admisie (IMRC/swirl) se blochează → P2004/P2006/P2008', 'Senzorul MAF murdar → P0101/P0171'],
  'duratechE-2.0': ['Furtunul PCV de sub galeria de admisie se fisurează → P0171 + ralanti instabil', 'Clapetele galeriei de admisie (IMRC/swirl) se blochează → P2004/P2006/P2008', 'Senzorul MAF murdar → P0101/P0171'],
  'duratechE-2.3': ['Furtun PCV / scurgeri vacuum → P0171', 'Clapetele galeriei de admisie → P2004/P2006/P2008'],
  'duratec-2.5T': ['Supapa de recirculare (diverter) turbo → P0299 / pierdere putere', 'Furtune intercooler fisurate → P0299/P0171', 'Lichid răcire: buşon vas expansiune / pompă apă → supraîncălzire'],
  'ecoboost-2.0': ['Depuneri de carbon pe supape (injecție directă) → rateuri la rece', 'Pompa de înaltă presiune / senzor presiune rampă → P0087/P0191'],
  'tdci-1.6': ['Garniturile injectoarelor pierd compresie („black death”) → miros, zgomot, P0087', 'Filtrul din racordul banjo de alimentare cu ulei a turbinei se înfundă → turbină distrusă P0299/P0234', 'DPF (pe unele versiuni cu aditiv Eolys) → P2002/P242F/P2463', 'Supapa EGR înfundată → P0401/P0400'],
  'tdci-1.8': ['Pompa de injecție (Delphi sau Siemens) uzată → P0087/P0251/pornire grea la cald', 'Injectoare → fum, rateuri, P0263–P0272', 'Supapa EGR / răcitorul EGR → P0401/P0403', 'Bujii incandescente / modul → P0380/P0670'],
  'tdci-2.0': ['Supapa EGR înfundată → P0401/P0400/P2413', 'Volanta cu masă dublă (DMF) → vibrații, zgomot la oprire', 'DPF colmatat (Mondeo/S-Max/Kuga) → P2002/P242F/P2463', 'Geometrie variabilă turbo blocată → P0299/P0234/P2263'],
  'tdci-2.2': ['DPF colmatat → P2002/P242F/P2463', 'Supapa EGR → P0401', 'Injectoare piezo → P0263–P0272'],
  'tdci-2.2T': ['Supapa EGR și răcitor EGR → P0401/P0403', 'Injectoare → P0263–P0272 / fum alb', 'Senzor presiune turbo / furtune intercooler → P0299'],
  'tdci-2.4T': ['Supapa EGR și răcitor EGR → P0401/P0403', 'Injectoare → P0263–P0272', 'Volanta cu masă dublă / ambreiaj'],
  'us-3.0': ['Corp clapetă electronic (ETB) → P2111/P2112/P2135, mod avarie', 'Garnitură galerie admisie / PCV → P0171/P0174'],
  'us-2.3': ['Clapete galerie admisie (IMRC) → P2004/P2008', 'Furtun PCV → P0171'],
  'us-2.5': ['Corp clapetă electronic → P2111/P2112', 'Furtun PCV → P0171'],
  'us-4.6': ['Bujiile 3V se rup la demontare (2004–2008) – procedură specială', 'Bobine (COP) → rateuri P0301–P0308', 'Senzor DPFE (EGR) → P0401/P1400/P1405'],
  'us-5.4': ['Fazoroi VCT / lanț distribuție / tensionare → zgomot la ralanti, P0012/P0022/P0340', 'Bujiile 3V se rup la demontare (2004–2008)', 'Bobine (COP) → rateuri P0301–P0308'],
  'us-4.0': ['Lanț distribuție / ghidaje (SOHC) → zgomot, P0340/P0016', 'Senzor DPFE → P0401/P1405'],
};

/* ------------------------------ cauze și verificări pe cod ------------------------------ */
const DTC_KNOWLEDGE = {
  P0101: { causes: ['Senzor MAF murdar sau defect', 'Aer fals între MAF și clapetă (furtun fisurat, colier slăbit)', 'Filtru aer înfundat', 'Pe diesel: supapă EGR blocată deschis'], checks: ['Comparați MAF la ralanti cu valoarea așteptată (fila Teste → Corecții combustibil)', 'Curățați MAF cu spray dedicat (nu atingeți firul)', 'Verificați furtunul de admisie'] },
  P0102: { causes: ['Mufa MAF / cablaj întrerupt', 'Senzor MAF defect', 'Alimentare 12 V lipsă la MAF'], checks: ['Verificați mufa și siguranța', 'Măsurați semnalul MAF la ralanti'] },
  P0103: { causes: ['Senzor MAF defect', 'Scurt la alimentare în cablaj'], checks: ['Verificați cablajul MAF'] },
  P0106: { causes: ['Furtun vacuum MAP fisurat / desprins', 'Senzor MAP defect', 'Scurgeri de vacuum'], checks: ['Cu contact ON și motor oprit, MAP ≈ presiunea barometrică (~100 kPa)'] },
  P0113: { causes: ['Senzor IAT deconectat (adesea integrat în MAF)', 'Cablaj întrerupt'], checks: ['IAT afișat −40 °C = circuit deschis'] },
  P0117: { causes: ['Senzor temperatură lichid scurtcircuitat', 'Cablaj scurt la masă'], checks: ['Comparați ECT cu IAT la motor rece – trebuie apropiate'] },
  P0118: { causes: ['Senzor temperatură lichid deconectat / defect', 'Cablaj întrerupt'], checks: ['ECT −40 °C = circuit deschis'] },
  P0128: { causes: ['Termostat blocat deschis (cel mai frecvent)', 'Senzor temperatură lichid decalibrat', 'Nivel lichid scăzut'], checks: ['Rulați testul ghidat „Termostat”', 'Verificați carcasa termostatului pentru pierderi (Ford 1.4/1.6/1.25)'] },
  P0171: { causes: ['Aer fals: furtun PCV, garnitură galerie admisie, furtune vacuum, servofrână', 'Senzor MAF murdar', 'Presiune combustibil scăzută (filtru, pompă)', 'Injectoare înfundate', 'Scurgere evacuare înaintea sondei lambda'], checks: ['Rulați testul „Corecții combustibil”: sărac la ralanti dar normal la 2500 rpm → aer fals; sărac peste tot → MAF sau combustibil', 'Ascultați șuierat la ralanti, test cu fum', 'Verificați furtunul PCV (Duratec-HE: sub galeria de admisie)'] },
  P0172: { causes: ['Presiune combustibil prea mare / regulator defect', 'Injector care picură', 'Senzor MAF supraestimează', 'Canistra EVAP / supapa de purjare blocată deschis', 'Filtru aer foarte înfundat'], checks: ['Corecții negative mari la ralanti → purjare EVAP sau injector', 'Deconectați temporar furtunul de purjare și urmăriți STFT'] },
  P0174: { causes: ['Ca P0171, pe bancul 2 (motoare V6/V8)'], checks: ['Dacă apar P0171 și P0174 împreună → cauză comună (MAF, combustibil, PCV)'] },
  P0175: { causes: ['Ca P0172, pe bancul 2'], checks: ['P0172 + P0175 → cauză comună (presiune combustibil, MAF, EVAP)'] },
  P0234: { causes: ['Geometrie variabilă turbo blocată închis', 'Solenoid / actuator control turbo defect', 'Senzor presiune turbo defect'], checks: ['Verificați furtunele de vacuum ale actuatorului', 'Comparați presiunea turbo cerută vs reală'] },
  P0299: { causes: ['Furtun intercooler fisurat / desprins', 'Geometrie variabilă blocată (calamină)', 'Solenoid control turbo / vacuum insuficient', 'Turbină uzată (joc ax)', 'Pe 1.6 TDCi: filtru banjo ulei turbo înfundat'], checks: ['Verificați furtunele de presiune (pete de ulei)', 'Verificați vacuumul la actuator', 'Verificați jocul axului turbinei'] },
  P0087: { causes: ['Filtru motorină înfundat / aer în sistem', 'Pompă de transfer / pompă de înaltă presiune uzată', 'Retur excesiv injectoare', 'Regulator / supapă dozare defectă'], checks: ['Înlocuiți filtrul de motorină', 'Test retur injectoare', 'Pe 1.8 TDCi: verificați pompa de injecție'] },
  P0300: { causes: ['Bujii uzate', 'Bobină inducție defectă', 'Aer fals / amestec sărac', 'Compresie scăzută', 'Injectoare'], checks: ['Rulați testul „Rateuri pe cilindri” (Mode 06)', 'Inversați bobinele între cilindri și urmăriți dacă defectul se mută'] },
  P0301: { causes: ['Bujie / bobină cilindru 1', 'Injector cilindru 1', 'Compresie cilindru 1'], checks: ['Inversați bobina cu alt cilindru și urmăriți dacă codul se mută'] },
  P0302: { causes: ['Bujie / bobină cilindru 2', 'Injector cilindru 2', 'Compresie cilindru 2'], checks: ['Inversați bobina cu alt cilindru'] },
  P0303: { causes: ['Bujie / bobină cilindru 3', 'Injector cilindru 3', 'Compresie cilindru 3'], checks: ['Inversați bobina cu alt cilindru'] },
  P0304: { causes: ['Bujie / bobină cilindru 4', 'Injector cilindru 4', 'Compresie cilindru 4'], checks: ['Inversați bobina cu alt cilindru'] },
  P0335: { causes: ['Senzor poziție arbore cotit defect', 'Cablaj / mufă (frecare de bloc)', 'Coroană impulsuri deteriorată'], checks: ['Motorul nu pornește? → verificați turația afișată la demaraj (trebuie > 0)'] },
  P0340: { causes: ['Senzor ax came defect', 'Distribuție sărită / lanț întins', 'Cablaj'], checks: ['Verificați calarea distribuției dacă apare împreună cu P0016'] },
  P0380: { causes: ['Bujie incandescentă arsă', 'Modul / releu bujii', 'Cablaj'], checks: ['Măsurați rezistența fiecărei bujii (~0,5–2 Ω)'] },
  P0400: { causes: ['Supapă EGR înfundată cu calamină', 'Răcitor EGR colmatat', 'Supapa de vacuum EGR'], checks: ['Curățați / înlocuiți supapa EGR'] },
  P0401: { causes: ['Supapă EGR / canal EGR înfundat', 'Senzor DPFE (Ford benzină SUA) / furtunele DPFE', 'Solenoid vacuum EGR'], checks: ['Pe motoare SUA cu DPFE: verificați furtunele senzorului (P1405/P1406)'] },
  P0420: { causes: ['Catalizator uzat', 'Sondă lambda aval (B1S2) leneșă', 'Scurgere evacuare', 'Rateuri sau consum de ulei anterioare'], checks: ['Rulați testul „Catalizator”: sonda aval trebuie să fie stabilă (~0,6–0,8 V)', 'Eliminați întâi orice cod de rateuri sau amestec'] },
  P0442: { causes: ['Buşon rezervor uzat', 'Furtun EVAP fisurat', 'Supapă purjare / aerisire'], checks: ['Înlocuiți garnitura bușonului (cea mai ieftină cauză)'] },
  P0455: { causes: ['Bușon rezervor lipsă / slăbit', 'Furtun EVAP desprins', 'Supapă aerisire canistră blocată deschis'], checks: ['Strângeți bușonul până la clic, ștergeți codul și urmăriți'] },
  P0500: { causes: ['Senzor viteză (ABS) defect', 'Pe Ford: viteza vine adesea de la ABS → citiți modulul ABS'], checks: ['Scanare module Ford → ABS'] },
  P0505: { causes: ['Supapă aer ralanti (IAC) murdară', 'Clapetă murdară', 'Aer fals'], checks: ['Curățați IAC și corpul clapetei'] },
  P0506: { causes: ['Supapă IAC / clapetă murdară', 'Restricție admisie'], checks: ['Curățați corpul clapetei'] },
  P0507: { causes: ['Aer fals', 'IAC blocată deschis'], checks: ['Verificați scurgeri de vacuum'] },
  P0562: { causes: ['Baterie slabă', 'Alternator / regulator defect', 'Conexiuni masă / borne oxidate', 'Curea accesorii'], checks: ['Rulați testul „Baterie și încărcare”'] },
  P0563: { causes: ['Regulator alternator defect (supraîncărcare)'], checks: ['Tensiune > 14,8 V la ralanti = regulator defect'] },
  P0603: { causes: ['Baterie deconectată / descărcată recent (memorie KAM pierdută)', 'Alimentare permanentă PCM întreruptă'], checks: ['Ștergeți codul; dacă revine, verificați alimentarea permanentă a PCM'] },
  P0700: { causes: ['Cod informativ: TCM a înregistrat un defect'], checks: ['Scanare module Ford → TCM pentru codul real'] },
  P1000: { causes: ['Normal după ștergere coduri / deconectare baterie / reprogramare'], checks: ['Conduceți ~30 min (oraș + extraurban) pentru finalizarea monitoarelor'] },
  P1131: { causes: ['Amestec sărac real (vezi P0171)', 'Sondă lambda amonte leneșă / îmbătrânită'], checks: ['Rulați testele „Corecții combustibil” și „Sondă lambda”'] },
  P1132: { causes: ['Amestec bogat real (vezi P0172)', 'Sondă lambda contaminată'], checks: ['Rulați testul „Sondă lambda”'] },
  P1260: { causes: ['Cheie neprogramată / transponder defect', 'Antenă PATS (inel contact) defectă'], checks: ['Încercați cheia de rezervă', 'Citiți modulul bord/GEM pentru B1600/B1681'] },
  P1299: { causes: ['Supraîncălzire motor – lipsă lichid / pompă apă / ventilator / termostat blocat închis'], checks: ['OPRIȚI MOTORUL. Verificați nivelul lichidului (la rece)'] },
  P1450: { causes: ['Supapă aerisire canistră blocată închis', 'Furtun EVAP înfundat'], checks: ['Verificați supapa de aerisire (lângă rezervor)'] },
  P2002: { causes: ['DPF colmatat / fisurat', 'Senzor presiune diferențială DPF', 'Regenerări întrerupte (doar curse scurte)'], checks: ['Mers 20 min pe autostradă > 2500 rpm', 'Verificați furtunele senzorului de presiune DPF'] },
  P2004: { causes: ['Clapete galerie admisie blocate (calamină)', 'Actuator / tijă clapete'], checks: ['Pe 1.8/2.0 Duratec-HE: verificați tija actuatorului IMRC'] },
  P2111: { causes: ['Corp clapetă electronic murdar / defect'], checks: ['Curățați corpul clapetei; înlocuiți dacă persistă'] },
  P2112: { causes: ['Corp clapetă electronic murdar / defect'], checks: ['Curățați corpul clapetei'] },
  P2135: { causes: ['Corp clapetă (senzori interni)', 'Mufă / cablaj corp clapetă'], checks: ['Verificați mufa; de regulă se înlocuiește corpul clapetei'] },
  P2263: { causes: ['Furtune turbo / intercooler', 'Geometrie variabilă', 'Senzor presiune turbo', 'Supapă EGR blocată deschis'], checks: ['Verificați vacuumul și furtunele'] },
  P242F: { causes: ['Acumulare cenușă DPF (sfârșit de viață)', 'Consum ulei'], checks: ['DPF se curăță / înlocuiește; regenerarea nu elimină cenușa'] },
  P2463: { causes: ['Funingine excesivă: regenerări eșuate, curse scurte, EGR/injectoare'], checks: ['Regenerare forțată la service (FORScan/IDS)', 'Verificați întâi cauza (EGR, injectoare)'] },
  U0100: { causes: ['Alimentare / masă PCM', 'Magistrala CAN întreruptă', 'Baterie descărcată la pornire'], checks: ['Verificați bateria și masele; dacă motorul merge normal, poate fi istoric'] },
  U0121: { causes: ['Modul ABS fără alimentare / defect', 'Magistrala CAN'], checks: ['Siguranțe ABS; scanare modul ABS'] },
  U1900: { causes: ['Tensiune baterie scăzută la pornire', 'Modul care se resetează', 'Mufă CAN oxidată'], checks: ['Verificați bateria; ștergeți codurile și urmăriți revenirea'] },
  B1318: { causes: ['Baterie slabă', 'Consumator parazit', 'Borne / mase'], checks: ['Rulați testul „Baterie și încărcare”'] },
  B1342: { causes: ['Modulul și-a detectat un defect intern'], checks: ['Ștergeți; dacă revine imediat, modulul necesită înlocuire/reprogramare'] },
  B1600: { causes: ['Cheie fără transponder / transponder defect'], checks: ['Încercați cheia de rezervă'] },
  B1681: { causes: ['Antenă PATS (în jurul contactului) / cablaj'], checks: ['Verificați mufa antenei PATS'] },
  C1155: { causes: ['Senzor turație roată stânga-față / cablaj', 'Inel impulsuri (rulment) deteriorat sau murdar'], checks: ['Verificați cablajul senzorului (frecare de bielete)', 'Curățați senzorul de pilitură'] },
  C1145: { causes: ['Senzor turație roată dreapta-față / cablaj', 'Inel impulsuri / rulment'], checks: ['Verificați cablajul senzorului'] },
  C1165: { causes: ['Senzor turație roată dreapta-spate / cablaj', 'Inel impulsuri / rulment'], checks: ['Verificați cablajul senzorului'] },
  C1175: { causes: ['Senzor turație roată stânga-spate / cablaj', 'Inel impulsuri / rulment'], checks: ['Verificați cablajul senzorului'] },
};
// coduri echivalente pe bancul 2 / variante
DTC_KNOWLEDGE.P0305 = DTC_KNOWLEDGE.P0306 = DTC_KNOWLEDGE.P0307 = DTC_KNOWLEDGE.P0308 = { causes: ['Bujie / bobină pe cilindrul respectiv', 'Injector', 'Compresie'], checks: ['Inversați bobina cu alt cilindru'] };
DTC_KNOWLEDGE.P0430 = DTC_KNOWLEDGE.P0420; DTC_KNOWLEDGE.P0456 = DTC_KNOWLEDGE.P0442; DTC_KNOWLEDGE.P0457 = DTC_KNOWLEDGE.P0455;
DTC_KNOWLEDGE.P1151 = DTC_KNOWLEDGE.P1131; DTC_KNOWLEDGE.P1152 = DTC_KNOWLEDGE.P1132; DTC_KNOWLEDGE.P2006 = DTC_KNOWLEDGE.P2008 = DTC_KNOWLEDGE.P2004;
DTC_KNOWLEDGE.P2453 = DTC_KNOWLEDGE.P2452 = { causes: ['Furtune senzor presiune DPF fisurate / inversate / înfundate', 'Senzor presiune diferențială defect'], checks: ['Verificați furtunele senzorului DPF'] };

window.ENGINES = ENGINES;
window.VEHICLES = VEHICLES;
window.ENGINE_ISSUES = ENGINE_ISSUES;
window.DTC_KNOWLEDGE = DTC_KNOWLEDGE;
