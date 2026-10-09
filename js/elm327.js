/* =====================================================================
 * elm327.js — Driver ELM327 / STN11xx (OBDLink)
 *   - coadă de comenzi serializată, detecție prompt '>'
 *   - inițializare, detecție protocol, selectare antet / filtru (module Ford)
 *   - parsare răspunsuri CAN (ISO-TP mono/multi-cadru, cu antete) și
 *     non-CAN (J1850 PWM/VPW, ISO 9141, KWP2000)
 * ===================================================================== */
'use strict';

const PROTOCOLS = {
  '0': 'Automat', '1': 'SAE J1850 PWM (41.6k) — Ford vechi', '2': 'SAE J1850 VPW (10.4k)',
  '3': 'ISO 9141-2', '4': 'ISO 14230-4 KWP (init 5 baud)', '5': 'ISO 14230-4 KWP (init rapid)',
  '6': 'ISO 15765-4 CAN 11bit 500k (HS-CAN Ford)', '7': 'ISO 15765-4 CAN 29bit 500k',
  '8': 'ISO 15765-4 CAN 11bit 250k', '9': 'ISO 15765-4 CAN 29bit 250k',
  'A': 'SAE J1939 CAN', 'B': 'CAN utilizator 1 (MS-CAN Ford 125k)', 'C': 'CAN utilizator 2',
};

class ELM327 {
  constructor(transport, log = () => {}) {
    this.t = transport;
    this.log = log;
    this.buffer = '';
    this.pending = null;
    this.queue = Promise.resolve();
    this.protocol = null;     // număr protocol (string hex)
    this.isCAN = true;
    this.currentHeader = null;
    this.currentFilter = null;
    this.version = '';
    this.isSTN = false;
    this.timeoutMs = 4000;
    this.t.onData(txt => this._onData(txt));
  }

  _onData(txt) {
    this.buffer += txt;
    if (this.buffer.includes('>')) {
      const idx = this.buffer.lastIndexOf('>');
      const resp = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (this.pending) { const p = this.pending; this.pending = null; clearTimeout(p.timer); p.resolve(resp); }
    }
  }

  /** Trimite o comandă brută și returnează liniile răspunsului (fără ecou/prompt). */
  send(cmd, timeoutMs) {
    const run = async () => {
      // după un timeout, adaptorul poate încă trimite răspunsul vechi: îl așteptăm și îl aruncăm,
      // altfel ar fi luat drept răspunsul comenzii următoare (decalaj permanent)
      if (this.stale) {
        await new Promise(res => { const timer = setTimeout(res, 1200); this.pending = { timer, resolve: () => res() }; });
        this.pending = null; this.buffer = ''; this.stale = false;
      }
      return new Promise((resolve, reject) => {
        this.buffer = '';
        const timer = setTimeout(() => {
          this.pending = null; this.stale = true;
          this.log('⏱ timeout: ' + cmd, 'warn');
          resolve({ raw: '', lines: ['TIMEOUT'], error: 'TIMEOUT' });
        }, timeoutMs || this.timeoutMs);
        this.pending = {
          timer,
          resolve: raw => {
            const c = cmd.replace(/\s/g, '').toUpperCase();
            let lines = raw.replace(/\0/g, '').split(/[\r\n]+/).map(s => s.trim()).filter(Boolean);
            // elimină ecoul și mesajele informative; păstrează eșecul „BUS INIT: ...ERROR” (linia K)
            lines = lines.filter(l => l.replace(/\s/g, '').toUpperCase() !== c && !/^SEARCHING/i.test(l));
            lines = lines.flatMap(l => {
              const m = l.match(/^BUS INIT:?\s*\.*\s*(.*)$/i);
              if (!m) return [l];
              const rest = m[1].trim();
              if (!rest || /^OK$/i.test(rest)) return [];
              return [/ERROR/i.test(rest) ? 'BUS INIT ERROR' : rest];
            });
            const errs = ['NO DATA', 'UNABLE TO CONNECT', 'CAN ERROR', 'BUS ERROR', 'BUS BUSY', 'BUS INIT ERROR', 'FB ERROR', 'DATA ERROR', 'STOPPED', '?', 'ERROR', 'BUFFER FULL', 'LV RESET', 'ACT ALERT', '<RX ERROR'];
            const error = lines.find(l => errs.some(e => l.toUpperCase().startsWith(e))) || null;
            this.log('→ ' + cmd + '\n← ' + (lines.join(' | ') || '(gol)'), error ? 'warn' : 'io');
            resolve({ raw, lines, error });
          },
          reject,
        };
        this.t.write(cmd + '\r').catch(e => { clearTimeout(timer); this.pending = null; reject(e); });
      });
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  /**
   * Inițializare robustă (clone ELM327 v1.5/v2.1, OBDLink, Vgate).
   * onStep(text) raportează pașii în interfață.
   */
  async init(protocol = '0', onStep = () => {}) {
    const CE = (window.Transports && window.Transports.ConnError) || Error;
    onStep('Resetare adaptor…');
    let r = await this.send('ATZ', 4000);
    if (r.error === 'TIMEOUT') {
      // unele clone nu răspund la ATZ sau pierd primul mesaj după conectarea Bluetooth
      r = await this.send('ATWS', 3000);
      if (r.error === 'TIMEOUT') r = await this.send('ATI', 3000);
      if (r.error === 'TIMEOUT') throw new CE('Adaptorul nu răspunde la comenzi.', 'Verificați: ați ales portul „Outgoing” al adaptorului (nu „Incoming”); adaptorul are alimentare (LED aprins, contact ON); pentru USB încercați altă viteză în Setări (38400 / 115200). Dispozitivul ales trebuie să fie un adaptor ELM327 / OBDLink.');
    }
    const verRe = /ELM|STN|OBD|VGATE|V-?LINK/i;
    let ver = r.lines.find(l => verRe.test(l));
    if (!ver) { const ri = await this.send('ATI', 2000); ver = ri.lines.find(l => verRe.test(l)) || ri.lines.find(l => l !== 'OK'); }
    this.version = (ver || 'ELM327 (versiune necunoscută)').replace(/^ATZ/i, '').trim();
    onStep('Configurare adaptor (' + (this.version || 'ELM327') + ')…');
    for (const c of ['ATE0', 'ATL0', 'ATS1', 'ATH1', 'ATAT1', 'ATST64']) {
      r = await this.send(c, 2000);
      if (c === 'ATE0' && r.error === 'TIMEOUT') throw new CE('Adaptorul nu mai răspunde după resetare.', 'Deconectați și reconectați adaptorul din priza OBD, apoi reîncercați.');
    }
    r = await this.send('STI', 1500);       // detectare STN (OBDLink)
    if (!r.error && /STN/i.test(r.lines.join(' '))) { this.isSTN = true; this.version += ' / ' + r.lines.join(' '); }

    onStep(protocol === '0' ? 'Căutare protocol vehicul (poate dura până la 15 s)…' : 'Conectare la calculatorul mașinii…');
    await this.send('ATSP' + protocol);
    r = await this.send('0100', 15000);
    if (r.error && protocol === '0' && r.error !== 'UNABLE TO CONNECT') {
      // Ford 2008+ (și majoritatea Ford Europa 2005+) = HS-CAN 11 bit 500 kbps
      onStep('Reîncercare pe HS-CAN (Ford)…');
      await this.send('ATSP6');
      r = await this.send('0100', 8000);
    }
    if (r.error) {
      const map = {
        'UNABLE TO CONNECT': ['Adaptorul nu găsește calculatorul mașinii.', 'Puneți contactul pe ON (sau porniți motorul) și verificați că adaptorul e introdus complet în priza OBD. Încercați și protocolul „ISO 15765-4 CAN 11bit 500k”.'],
        'NO DATA': ['Calculatorul mașinii nu a răspuns.', 'Contactul trebuie să fie pe ON. Dacă problema persistă, alegeți manual protocolul (Ford 2008+: CAN 11bit 500k; Ford SUA până în 2007: J1850 PWM).'],
        'CAN ERROR': ['Eroare pe magistrala CAN.', 'Protocolul ales nu corespunde mașinii sau adaptorul e defect. Încercați „Automat” sau alt protocol CAN.'],
        'BUS INIT ERROR': ['Inițializarea liniei K a eșuat.', 'Mașina folosește probabil CAN — alegeți „Automat” sau „ISO 15765-4 CAN 11bit 500k”.'],
        'TIMEOUT': ['Adaptorul nu a răspuns în timp util.', 'Semnal Bluetooth slab sau adaptor blocat — scoateți și reintroduceți adaptorul, apoi reîncercați.'],
      };
      const key = Object.keys(map).find(k => r.error.toUpperCase().startsWith(k));
      const [msg, hint] = map[key] || ['Calculatorul mașinii nu răspunde (' + r.error + ').', 'Verificați contactul (ON) și protocolul.'];
      throw new CE(msg, hint);
    }
    await this.detectProtocol();
    await this.probeCapabilities();
    this.currentHeader = null; this.currentFilter = null;
    return { version: this.version, protocol: this.protocol, protocolName: PROTOCOLS[this.protocol] || this.protocol };
  }

  async detectProtocol() {
    const r = await this.send('ATDPN');
    const p = (r.lines[0] || '6').replace(/^A/, '').trim().toUpperCase();
    this.protocol = p;
    this.isCAN = ['6', '7', '8', '9', 'A', 'B', 'C'].includes(p);
    return p;
  }

  async voltage() {
    const r = await this.send('ATRV');
    const m = (r.lines[0] || '').match(/([\d.]+)\s*V?/i);
    return m ? parseFloat(m[1]) : null;
  }

  /** Setează antetul de transmisie (ex. '7E0', '760') și filtrul de recepție. */
  async setHeader(tx, rx) {
    if (!this.isCAN) return;
    if (this.currentHeader !== tx) {
      await this.send('ATSH' + tx);
      if (this.caps && !this.caps.flowControl) {
        // adaptorul nu suportă ATFC — se bazează pe flow control automat
      } else if (tx !== '7DF') {
        // flow control explicit pentru răspunsuri multi-cadru de la module
        const fc = await this.send('ATFCSH' + tx);
        if (!fc.error) { await this.send('ATFCSD300000'); await this.send('ATFCSM1'); }
      } else {
        await this.send('ATFCSM0');
      }
      this.currentHeader = tx;
    }
    const filt = rx || null;
    // fără suport ATCRA: răspunsurile se filtrează software după ID
    if (this.caps && !this.caps.receiveFilter) { this.currentFilter = filt; return; }
    if (this.currentFilter !== filt) {
      if (filt) await this.send('ATCRA' + filt); else await this.send('ATCRA');
      this.currentFilter = filt;
    }
  }

  async resetHeader() { await this.setHeader('7DF', null); }

  /**
   * Trimite o cerere OBD/UDS și returnează mesajele reasamblate:
   *   [{ ecu: '7E8', bytes: [0x41, 0x0C, ...] }, ...]
   */
  async request(hex, timeoutMs) {
    let r = await this.send(hex, timeoutMs);
    // erori tranzitorii de magistrală: o singură reîncercare
    if (r.error && /^(BUS BUSY|CAN ERROR|BUFFER FULL|DATA ERROR|STOPPED|<RX ERROR|FB ERROR)/.test(r.error)) {
      await new Promise(res => setTimeout(res, 120));
      r = await this.send(hex, timeoutMs);
    }
    if (r.error) return { error: r.error, messages: [] };
    return { error: null, messages: this.parse(r.lines) };
  }

  /** Testează ce comenzi avansate suportă adaptorul (clonele adesea nu le au). */
  async probeCapabilities() {
    const ok = async c => !(await this.send(c)).error;
    const caps = {
      flowControl: await ok('ATFCSM0'),
      receiveFilter: await ok('ATCRA'),
      protocolB: await ok('ATPBE001'),     // valoarea implicită — nu schimbă nimic
      describe: await ok('AT@1'),
    };
    const v = this.version || '';
    caps.suspectClone = /v2\.[1-9]/i.test(v) || (!caps.flowControl && /v1\.5/i.test(v));
    caps.realVersion = /v1\.[0-3]\b/.test(v) ? 'veche (fără AT PB)' : '';
    this.caps = caps;
    return caps;
  }

  parse(lines) {
    if (this.isCAN) return this._parseCAN(lines);
    return this._parseLegacy(lines);
  }

  _parseCAN(lines) {
    const frames = {};       // ecu -> { ff:bool, len, data:[] }
    const order = [];
    let noHeaderMode = null; // pentru răspunsuri fără antet (ATH0) cu "0: .."
    for (const raw of lines) {
      const l = raw.replace(/\s+/g, ' ').trim();
      // format fără antet multi-cadru: "014" / "0: 49 02 ..."
      if (/^[0-9A-F]{3}$/i.test(l) && !noHeaderMode) { noHeaderMode = { ecu: 'ECU', len: parseInt(l, 16), data: [] }; continue; }
      const m0 = l.match(/^([0-9A-F]):\s*(.*)$/i);
      if (m0 && noHeaderMode) { noHeaderMode.data.push(...hexBytes(m0[2])); continue; }
      const compact = l.replace(/ /g, '');
      if (!/^[0-9A-F]+$/i.test(compact)) continue;
      let id, rest;
      if (/^[0-9A-F]{8}/i.test(compact) && (this.protocol === '7' || this.protocol === '9')) { id = compact.slice(0, 8); rest = compact.slice(8); }
      else { id = compact.slice(0, 3); rest = compact.slice(3); }
      const b = hexBytes(rest);
      if (!b.length) continue;
      const pciType = b[0] >> 4;
      if (!frames[id]) { frames[id] = { len: 0, data: [] }; order.push(id); }
      const f = frames[id];
      if (pciType === 0) { f.len = b[0] & 0x0f; f.data = b.slice(1, 1 + f.len); f.done = true; }
      else if (pciType === 1) { f.len = ((b[0] & 0x0f) << 8) | b[1]; f.data = b.slice(2); }
      else if (pciType === 2) { f.data.push(...b.slice(1)); }
      else if (pciType === 3) { /* flow control — ignorat */ }
    }
    const out = [];
    if (noHeaderMode) out.push({ ecu: noHeaderMode.ecu, bytes: noHeaderMode.data.slice(0, noHeaderMode.len) });
    for (const id of order) {
      const f = frames[id];
      if (!f.data.length) continue;
      out.push({ ecu: id.toUpperCase(), bytes: f.len ? f.data.slice(0, f.len) : f.data });
    }
    return this._mergeNRC(out);
  }

  _parseLegacy(lines) {
    // J1850 / ISO9141 / KWP cu antete: 3 octeți antet + date + 1 octet checksum
    const byEcu = {}; const order = [];
    for (const raw of lines) {
      const b = hexBytes(raw);
      if (b.length < 5) continue;
      const ecu = b[2].toString(16).toUpperCase().padStart(2, '0');
      const data = b.slice(3, b.length - 1);
      if (!byEcu[ecu]) { byEcu[ecu] = []; order.push(ecu); }
      // răspunsurile multi-linie (ex. 09 02) au contor de secvență după PID — se concatenează
      byEcu[ecu].push(data);
    }
    const out = [];
    for (const ecu of order) {
      const parts = byEcu[ecu];
      if (parts.length === 1) { out.push({ ecu, bytes: parts[0] }); continue; }
      const svc = parts[0][0];
      // Mode 03/07: fiecare linie e un răspuns separat (43 + 3 DTC-uri)
      if (svc === 0x43 || svc === 0x47 || svc === 0x4A) {
        const all = [svc]; for (const p of parts) all.push(...p.slice(1));
        out.push({ ecu, bytes: all, legacyDtc: true });
      } else if (svc === 0x49) {
        // 49 PID SEQ d d d d
        const all = [0x49, parts[0][1], parts.length];
        parts.sort((a, b) => a[2] - b[2]).forEach(p => all.push(...p.slice(3)));
        out.push({ ecu, bytes: all });
      } else {
        parts.forEach(p => out.push({ ecu, bytes: p }));
      }
    }
    return out;
  }

  _mergeNRC(msgs) {
    // 7F xx 78 = "response pending": păstrăm doar răspunsul final
    return msgs.filter(m => !(m.bytes[0] === 0x7f && m.bytes[2] === 0x78));
  }
}

function hexBytes(s) {
  const c = String(s).replace(/[^0-9A-Fa-f]/g, '');
  const out = [];
  for (let i = 0; i + 1 < c.length; i += 2) out.push(parseInt(c.substr(i, 2), 16));
  return out;
}
function toHex(bytes, sep = ' ') { return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(sep); }

window.ELM327 = ELM327;
window.PROTOCOLS = PROTOCOLS;
window.hexBytes = hexBytes;
window.toHex = toHex;
