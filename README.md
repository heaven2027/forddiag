# FordDiag OBD2

Aplicație de diagnoză auto OBD-II / EOBD, cu funcții extinse pentru **Ford 2007–2010**
(Focus Mk2, C-Max, Mondeo Mk4, S-Max/Galaxy, Kuga Mk1, Fiesta Mk6/Mk7, Fusion, Transit,
F-150, Escape, Fusion SUA etc.). Conexiune la adaptor **ELM327** prin Bluetooth (sau USB).

Rulează pe **Windows** (Chrome / Edge) și **Android** (Chrome) dintr-un singur cod (aplicație web
instalabilă — PWA). Funcționează offline, nu trimite date nicăieri.

## Funcții

| Filă | Ce face |
|---|---|
| Conexiune | Bluetooth clasic / COM (Web Serial), Bluetooth LE (Web Bluetooth), mod Demo; protocol automat sau manual; detectare funcții adaptor și clone |
| Panou | Profil vehicul (model + motor Ford 2007–2010, ghicit din VIN). Scanare completă cu un clic: baterie, VIN, MIL, coduri, freeze frame, Mode 06, module HS-CAN (+ MS-CAN opțional), analiză automată, salvare în istoric |
| Analiză | Sistem expert: combină codurile, readiness, freeze frame, modulele și un instantaneu live de 6 s. Arată problemele ordonate după gravitate, cauze probabile, pași de verificare, combinații de coduri (cauză comună) și probleme cunoscute pe motorul ales |
| Teste ghidate | Baterie și încărcare (inclusiv demaraj), termostat, corecții combustibil ralanti/2500 rpm (aer fals vs alimentare), sondă lambda, catalizator, rateuri pe cilindru (Mode 06), stabilitate ralanti, pedală accelerație |
| Trip & performanță | Distanță, durată, viteză medie/maximă, consum instantaneu și mediu (PID 5E sau MAF), cronometru 0–100, 0–60, 60–100, 80–120, 0–160 km/h |
| Istoric | Scanări salvate local per VIN (IndexedDB), redeschidere, comparație înainte/după reparație (rezolvate / noi / persistente), export/import |
| Coduri | Citire coduri memorate (03), în așteptare (07), permanente (0A); ștergere (04); căutare în baza de coduri (RO) |
| Fișa codului | Clic pe orice cod (oriunde în aplicație): descriere, sistem afectat, generic/Ford, tip defect Ford, activ/istoric, „Pot să conduc?”, cauze probabile, pași de remediere bifabili, probleme cunoscute pe motorul ales, freeze frame, coduri înrudite, căutare online (Google, YouTube, forumuri, OBD-Codes) și întrebare gata formulată pentru un asistent AI (Claude / ChatGPT) |
| Date live | ~75 parametri Mode 01, citire multi-PID, plăci sau cadrane, grafic cu 2 serii, înregistrare CSV, mod HUD pe tot ecranul (cu oglindire pentru parbriz), ecranul rămâne aprins |
| Freeze frame | Instantaneul parametrilor la apariția defectului (Mode 02) |
| Readiness | Monitoare emisii (benzină/diesel) + rezultate teste Mode 06 cu limite min/max |
| Module Ford | Scanare ~27 module (PCM, TCM, ABS, airbag, PSCM, bord, GEM, climă, audio, uși, PAM …) pe HS-CAN și MS-CAN; citire/ștergere coduri per modul (UDS 0x19 / KWP 0x18 / 0x14), cod + tip defect Ford (FTB) + stare; identificare (DID F190/F188/F111/F113) |
| PID-uri extinse | PID-uri Ford Mode 22 predefinite (ex. temperatură ulei cutie 22 1E1C) + PID-uri proprii cu formulă |
| Info vehicul | VIN, ID calibrare, CVN, nume ECU, standard OBD, tip combustibil; decodor VIN Ford Europa pe poziții (caroserie, uzină, model + generație, an) + linkuri de verificare online UE |
| Integritate vehicul | Când au fost șterse codurile (km / porniri / ore), km parcurși cu MIL/Check Engine aprins, VIN memorat în fiecare modul (module înlocuite / neprogramate), software module, kilometraj din module (experimental, DID DD01) |
| Jurnal service | Revizii și reparații pe VIN (dată, km, tip, piese, service, cost), remindere pentru următoarea revizie / ITP / lichid frână, export CSV; linkuri către RAR Auto-Pass, carVertical, autoDNA |
| Documente RO | Rovinietă (CNAIR), RCA (BAAR/AIDA), ITP (RAR): deschidere site oficial cu VIN/nr. copiat, evidență valabilități cu avertizare la expirare, data/stația/km ITP, verificare kilometraj în scădere |
| Terminal | Comenzi AT / OBD brute |
| Raport | Raport HTML / PDF (tipărire), export JSON, jurnal comunicație |

## Pornire

Browserul permite accesul la Bluetooth și la portul serial numai pe **HTTPS** sau **http://localhost**.
Dacă deschideți `index.html` direct (dublu-clic), conexiunea va fi blocată.

### Windows
1. Împerecheați adaptorul ELM327 din *Setări → Bluetooth* (PIN `1234` sau `0000`). Windows creează un port COM.
2. Rulați **`start-windows.bat`**. Pornește un mic server local (PowerShell, fără instalări) și deschide aplicația în browser.
3. Fila Conexiune → „Bluetooth clasic / COM” → *Conectare* → alegeți portul adaptorului.

### Android (și Windows, fără server local)
Urcați folderul pe un hosting HTTPS gratuit (GitHub Pages, Netlify, Cloudflare Pages), apoi deschideți
linkul în **Chrome**. Din meniu folosiți *Adaugă pe ecranul de pornire / Instalează aplicația*.
- Adaptor **Bluetooth LE** (Vgate iCar Pro BLE, Veepeak BLE+, OBDLink CX): alegeți „Bluetooth LE”.
- Adaptor **Bluetooth clasic**: împerecheați-l din setările telefonului, apoi alegeți „Bluetooth clasic / COM”.
  Necesită Chrome recent pentru Android (Web Serial prin Bluetooth RFCOMM, lansat în 2025).

## Adaptoare recomandate
- **OBDLink EX/MX+/CX** sau **Vgate vLinker FS/MC+**: rapide, compatibile complet.
- ELM327 v1.5 ieftin (clonă): merge pentru OBD standard. Unele clone nu suportă `ATFC…`/`ATPB`,
  deci scanarea modulelor poate fi incompletă.
- **MS-CAN** (bord, climă, audio, uși pe modelele europene) e pe pinii 3 și 11 ai prizei OBD, nu pe pinii OBD
  standard. E nevoie de un adaptor cu comutator HS/MS (tip „FORScan modified”) sau de un OBDLink. Comenzile
  de comutare se configurează în *Setări*. Implicit sunt `ATSPB` + `ATPB8104`: CAN 11 biți, ISO 15765, 500/4 = 125 kbps.

## Limitări (intenționate)
- Nu face programare, codare As-Built, chei PATS, codare injectoare, regenerare DPF forțată sau alte proceduri de dealer.
  Pentru acestea folosiți FORScan sau IDS.
- PID-urile Mode 22 și adresele unor module diferă între modele. Modulele care nu răspund sunt doar marcate ca absente.
- Descrierile codurilor Ford P1/B/C/U sunt orientative. Confirmați diagnosticul cu manualul de service.
- Ștergeți codurile cu **motorul oprit și contactul pe ON**.

## Structură
```
index.html        interfață
css/style.css     stiluri (responsive, telefon + PC)
js/transport.js   Web Serial, Web Bluetooth, simulator Demo
js/elm327.js      driver ELM327/STN: coadă comenzi, protocol, parsare ISO-TP / J1850 / KWP
js/obd.js         servicii OBD-II (01, 02, 03, 04, 06, 07, 09, 0A), decodare PID, VIN
js/ford.js        module Ford, UDS/KWP, PID-uri Mode 22, formule
js/dtcdb.js       baza de coduri de eroare (RO), ~750 coduri
js/knowledge.js   profile vehicule/motoare, cauze și verificări pe cod, probleme cunoscute pe motor
js/analysis.js    analiză automată (reguli)
js/guided.js      teste ghidate
js/trip.js        computer de bord și cronometru performanță
js/history.js     istoric scanări (IndexedDB)
js/app.js         logica interfeței (de bază)
js/app-extra.js   interfața pentru analiză, teste, trip, istoric, HUD
sw.js, manifest.json, icon.svg   PWA (instalare, offline)
server.ps1, start-windows.bat    server local pentru Windows
```

## Notă despre testare
Codul a fost verificat sintactic, dar **nu** a fost testat pe un vehicul sau un adaptor real. La primele
utilizări, porniți cu modul **Demo**, apoi conectați-vă la mașină și urmăriți fila *Raport → Jurnal comunicație*.
Dacă ceva nu merge, jurnalul arată exact ce comenzi s-au trimis și ce a răspuns adaptorul.
