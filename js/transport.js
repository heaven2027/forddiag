/* =====================================================================
 * transport.js — Straturi de transport către adaptorul ELM327
 *   - SerialTransport : Web Serial (Bluetooth clasic SPP = port COM pe Windows,
 *                       RFCOMM pe Android Chrome recent, USB)
 *   - BleTransport    : Web Bluetooth (adaptoare BLE: Vgate iCar Pro BLE,
 *                       Veepeak BLE, OBDLink CX, clone FFF0/FFE0/18F0)
 *   - DemoTransport   : simulator ELM327 + vehicul Ford (fără mașină)
 * Toate expun: connect(), disconnect(), write(str), onData(cb), onClose(cb), name
 * ===================================================================== */
'use strict';

const sleepT = ms => new Promise(r => setTimeout(r, ms));

/** Eroare cu mesaj clar pentru utilizator (+ sugestie de rezolvare) */
class ConnError extends Error {
  constructor(msg, hint) { super(msg); this.hint = hint || ''; this.userFacing = true; }
}

class BaseTransport {
  constructor() { this._dataCb = () => {}; this._closeCb = () => {}; this.connected = false; }
  onData(cb) { this._dataCb = cb; }
  onClose(cb) { this._closeCb = cb; }
  _emit(text) { try { this._dataCb(text); } catch (e) { console.error(e); } }
  _closed() { if (this.connected) { this.connected = false; this._closeCb(); } }
  get canReconnect() { return false; }
}

/* ---------------------------- Web Serial ---------------------------- */
class SerialTransport extends BaseTransport {
  static isSupported() { return 'serial' in navigator; }
  constructor(baudRate = 38400, port = null) { super(); this.baudRate = baudRate; this.port = port; this.name = 'Serial/COM'; }
  get canReconnect() { return !!this.port; }

  async connect() {
    if (!this.port) {
      try {
        // fără filtre: Chrome afișează porturile COM, inclusiv cele Bluetooth (SPP) și USB
        this.port = await navigator.serial.requestPort({});
      } catch (e) {
        if (e.name === 'NotFoundError') throw new ConnError('Nu a fost selectat niciun port.', 'Lista e goală? Împerecheați întâi adaptorul din setările Bluetooth ale sistemului (PIN 1234 sau 0000), apoi reîncercați.');
        if (e.name === 'SecurityError') throw new ConnError('Browserul a blocat accesul la porturi.', 'Aplicația trebuie deschisă prin https:// sau http://localhost (start-windows.bat).');
        throw e;
      }
    }
    const opts = { baudRate: this.baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 };
    try {
      await this.port.open(opts);
    } catch (e) {
      if (e.name === 'InvalidStateError') {
        // portul era deja deschis (sesiune anterioară) — îl închidem și reîncercăm
        try { await this.port.close(); } catch (_) {}
        try { await this.port.open(opts); }
        catch (e2) { throw new ConnError('Portul este deja folosit.', 'Închideți alte aplicații OBD (Torque, FORScan, ELM327 Identifier) sau alte file ale acestei aplicații.'); }
      } else {
        throw new ConnError('Portul nu a putut fi deschis.', 'Verificați: adaptorul e în priza OBD și contactul pe ON; ați ales portul „Outgoing / Ieșire” (nu „Incoming”); adaptorul e în raza Bluetooth; nicio altă aplicație nu îl folosește. (' + (e.message || e.name) + ')');
      }
    }
    this.writer = this.port.writable.getWriter();
    this.connected = true;
    this._loop = this._readLoop();
    const info = this.port.getInfo ? this.port.getInfo() : {};
    this.name = info.bluetoothServiceClassId ? 'Bluetooth (port serial)' : (info.usbVendorId ? 'USB' : 'Port COM');
    // legătura Bluetooth SPP se stabilește la deschidere; octeții trimiși imediat se pot pierde
    await sleepT(info.usbVendorId ? 150 : 700);
  }

  async _readLoop() {
    const decoder = new TextDecoder();
    while (this.connected && this.port && this.port.readable) {
      this.reader = this.port.readable.getReader();
      let fatal = false;
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) { fatal = true; break; }
          if (value && value.length) this._emit(decoder.decode(value, { stream: true }));
        }
      } catch (e) {
        // erori recuperabile (buffer/cadru/paritate): fluxul se recreează, continuăm
        console.warn('Serial read error', e.name, e.message);
        fatal = !['BufferOverrunError', 'FramingError', 'ParityError', 'BreakError'].includes(e.name);
      } finally {
        try { this.reader.releaseLock(); } catch (_) {}
        this.reader = null;
      }
      if (fatal) break;
    }
    this._closed();
  }

  async write(str) {
    if (!this.writer || !this.connected) throw new Error('Port neconectat');
    await this.writer.write(new TextEncoder().encode(str));
  }

  async disconnect() {
    const was = this.connected;
    this.connected = false;
    try { if (this.reader) await this.reader.cancel(); } catch (_) {}
    try { if (this._loop) await this._loop; } catch (_) {}          // așteptăm eliberarea cititorului
    try { if (this.writer) { this.writer.releaseLock(); } } catch (_) {}
    try { if (this.port) await this.port.close(); } catch (_) {}
    this.writer = null; this._loop = null;
    if (was) this._closeCb();
  }
}

/* --------------------------- Web Bluetooth -------------------------- */
// servicii UART folosite de adaptoarele OBD BLE, în ordinea preferinței
const BLE_UART = [
  { svc: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', label: 'Vgate / Veepeak' },
  { svc: '0000fff0-0000-1000-8000-00805f9b34fb', label: 'FFF0' },
  { svc: '0000ffe0-0000-1000-8000-00805f9b34fb', label: 'FFE0' },
  { svc: '000018f0-0000-1000-8000-00805f9b34fb', label: '18F0' },
  { svc: '49535343-fe7d-4ae5-8fa9-9fafd205e455', label: 'ISSC UART' },
  { svc: '6e400001-b5a3-f393-e0a9-e50e24dcca9e', label: 'Nordic UART' },
  { svc: '0000fee7-0000-1000-8000-00805f9b34fb', label: 'FEE7' },
  { svc: '0000ae00-0000-1000-8000-00805f9b34fb', label: 'AE00' },
];
const BLE_SERVICES = BLE_UART.map(x => x.svc);

class BleTransport extends BaseTransport {
  static isSupported() { return 'bluetooth' in navigator; }
  constructor(device = null) { super(); this.device = device; this.name = 'Bluetooth LE'; this._queue = Promise.resolve(); this._chunk = 20; }
  get canReconnect() { return !!this.device; }

  async connect() {
    if (navigator.bluetooth.getAvailability) {
      const avail = await navigator.bluetooth.getAvailability().catch(() => true);
      if (!avail) throw new ConnError('Bluetooth este oprit sau indisponibil pe acest dispozitiv.', 'Porniți Bluetooth (pe Android și Locația), apoi reîncercați.');
    }
    if (!this.device) {
      try {
        this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      } catch (e) {
        if (e.name === 'NotFoundError') throw new ConnError('Nu a fost selectat niciun dispozitiv.', 'Adaptorul nu apare? Aici apar doar adaptoarele Bluetooth LE (4.0+). Pentru cele Bluetooth clasice alegeți „Bluetooth clasic / COM”. Pe Android activați și Locația.');
        if (e.name === 'SecurityError') throw new ConnError('Browserul a blocat accesul Bluetooth.', 'Aplicația trebuie deschisă prin https:// sau http://localhost.');
        throw e;
      }
    }
    if (!this._discListener) { this._discListener = () => this._closed(); this.device.addEventListener('gattserverdisconnected', this._discListener); }
    let server = null, lastErr = null;
    for (let i = 0; i < 3 && !server; i++) {      // conectarea GATT eșuează uneori la prima încercare
      try { server = await this.device.gatt.connect(); } catch (e) { lastErr = e; await sleepT(700); }
    }
    if (!server) throw new ConnError('Conectarea la adaptorul BLE a eșuat.', 'Apropiați dispozitivul de adaptor, verificați că nu e conectat la altă aplicație/telefon, apoi reîncercați. (' + (lastErr && lastErr.message) + ')');
    let services = [];
    try { services = await server.getPrimaryServices(); } catch (_) {}
    const rank = u => { const i = BLE_SERVICES.indexOf(String(u).toLowerCase()); return i < 0 ? 99 : i; };
    services.sort((a, b) => rank(a.uuid) - rank(b.uuid));
    let notifyChar = null, writeChar = null, used = null;
    for (const svc of services) {
      let chars = [];
      try { chars = await svc.getCharacteristics(); } catch (_) { continue; }
      const n = chars.find(c => c.properties.notify) || chars.find(c => c.properties.indicate);
      // preferăm o caracteristică de scriere separată dacă există (ex. FFF1 notificare / FFF2 scriere)
      const w = chars.find(c => c !== n && (c.properties.write || c.properties.writeWithoutResponse)) || chars.find(c => c.properties.write || c.properties.writeWithoutResponse);
      if (n && w) { notifyChar = n; writeChar = w; used = svc.uuid; break; }
    }
    if (!notifyChar || !writeChar) {
      try { this.device.gatt.disconnect(); } catch (_) {}
      throw new ConnError('Dispozitivul ales nu este un adaptor OBD BLE compatibil.', 'Nu expune un serviciu UART cunoscut (FFF0 / FFE0 / 18F0 / Vgate). Dacă adaptorul e Bluetooth clasic, folosiți „Bluetooth clasic / COM”.');
    }
    this.notifyChar = notifyChar; this.writeChar = writeChar;
    if (!this._notifListener) {
      const decoder = new TextDecoder();
      this._notifListener = ev => this._emit(decoder.decode(ev.target.value, { stream: true }));
    }
    notifyChar.addEventListener('characteristicvaluechanged', this._notifListener);
    await notifyChar.startNotifications();
    this.connected = true;
    const lbl = (BLE_UART.find(x => x.svc === String(used).toLowerCase()) || {}).label || used;
    this.name = 'BLE: ' + (this.device.name || 'adaptor') + ' (' + lbl + ')';
    await sleepT(200);
  }

  write(str) {
    // MTU BLE implicit = 20 octeți utili — trimitem pe bucăți, serializat; o eroare nu blochează coada
    const bytes = new TextEncoder().encode(str);
    const job = this._queue.catch(() => {}).then(async () => {
      if (!this.connected) throw new Error('BLE neconectat');
      const c = this.writeChar;
      for (let i = 0; i < bytes.length; i += this._chunk) {
        const chunk = bytes.slice(i, i + this._chunk);
        if (c.properties.writeWithoutResponse && c.writeValueWithoutResponse) await c.writeValueWithoutResponse(chunk);
        else if (c.writeValueWithResponse) await c.writeValueWithResponse(chunk);
        else await c.writeValue(chunk);
      }
    });
    this._queue = job;
    return job;
  }

  async disconnect() {
    const was = this.connected;
    this.connected = false;
    try { if (this.notifyChar) { await this.notifyChar.stopNotifications(); this.notifyChar.removeEventListener('characteristicvaluechanged', this._notifListener); } } catch (_) {}
    try { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); } catch (_) {}
    if (was) this._closeCb();
  }
}

/* ------------------------------ Demo -------------------------------- */
/* Simulează un ELM327 v1.5 conectat la un Ford Focus Mk2 1.6 Ti-VCT (2009) pe HS-CAN */
class DemoTransport extends BaseTransport {
  constructor() {
    super();
    this.name = 'Simulator (Demo)';
    this.t0 = Date.now();
    this.headers = false; this.spaces = true; this.echo = true;
    this.header = '7DF'; this.protocol = '6';
    this.dtcs = ['0171', '0420', '1131'];   // P0171, P0420, P1131
    this.pendingDtcs = ['0300'];
    this.milOn = true;
    this.moduleDtcs = {
      '760': [['51', '55', '00', '2F']],       // ABS: C1155 status 2F
      '737': [['93', '18', '16', '08']],       // RCM: B1318:16
      '726': [],
      '720': [['D0', '00', '00', '28']],       // IPC: U1000
    };
  }
  async connect() { this.connected = true; }
  async disconnect() { this._closed(); }

  async write(str) {
    const cmd = str.replace(/[\r\n]/g, '').replace(/\s+/g, '').toUpperCase();
    await new Promise(r => setTimeout(r, 25 + Math.random() * 40));
    let resp = this._handle(cmd);
    const echo = this.echo ? str.replace(/\n/g, '') : '';
    this._emit(echo + (echo.endsWith('\r') ? '' : (echo ? '\r' : '')) + resp + '\r\r>');
  }

  _sp(hex) { return this.spaces ? hex.match(/.{1,2}/g).join(' ') : hex; }
  _frame(id, bytesHex) {
    // bytesHex = date fără PCI; construim cadre ISO-TP
    const data = bytesHex;
    const len = data.length / 2;
    const out = [];
    if (len <= 7) {
      const pci = len.toString(16).padStart(2, '0').toUpperCase();
      const payload = (pci + data).padEnd(16, '0').slice(0, 2 + data.length);
      out.push(this.headers ? (this.spaces ? id + ' ' : id) + this._sp(payload) : this._sp(data));
      return out.join('\r');
    }
    if (this.headers) {
      const ff = '1' + len.toString(16).padStart(3, '0').toUpperCase() + data.slice(0, 12);
      out.push((this.spaces ? id + ' ' : id) + this._sp(ff));
      let rest = data.slice(12), sn = 1;
      while (rest.length) {
        const chunk = rest.slice(0, 14); rest = rest.slice(14);
        out.push((this.spaces ? id + ' ' : id) + this._sp('2' + (sn & 15).toString(16).toUpperCase() + chunk.padEnd(14, '0')));
        sn++;
      }
    } else {
      out.push(len.toString(16).padStart(3, '0').toUpperCase());
      out.push('0: ' + this._sp(data.slice(0, 12)));
      let rest = data.slice(12), sn = 1;
      while (rest.length) {
        out.push((sn & 15).toString(16).toUpperCase() + ': ' + this._sp(rest.slice(0, 14).padEnd(14, '0')));
        rest = rest.slice(14); sn++;
      }
    }
    return out.join('\r');
  }

  _hx(n, bytes = 1) { return Math.max(0, Math.round(n)).toString(16).padStart(bytes * 2, '0').toUpperCase().slice(-bytes * 2); }

  _handle(cmd) {
    if (cmd.startsWith('AT')) return this._at(cmd.slice(2));
    if (!/^[0-9A-F]+$/.test(cmd) || cmd.length % 2) return '?';
    const rid = (parseInt(this.header, 16) + 8).toString(16).toUpperCase();
    if (this.header !== '7DF' && this.header !== '7E0') return this._module(cmd);
    const t = (Date.now() - this.t0) / 1000;
    const rpm = 800 + 1400 * (1 + Math.sin(t / 6)) + Math.random() * 40;
    const speed = Math.max(0, 45 + 40 * Math.sin(t / 9));
    const mode = cmd.slice(0, 2), pid = cmd.slice(2, 4);
    const ecu = (data) => this._frame('7E8', data);
    if (mode === '01') {
      const map = {
        '00': 'BE3FB813', '20': '8007A001', '40': '7ED00000',
        '01': (this.milOn ? '83' : '00') + '076504',
        '03': '0200', '04': this._hx(25 + 30 * Math.random() + speed / 3),
        '05': this._hx(Math.min(90, 20 + t * 2) + 40), '06': this._hx(128 + 6 + Math.random() * 4),
        '07': this._hx(128 + 9), '0B': this._hx(30 + rpm / 60), '0C': this._hx(rpm * 4, 2),
        '0D': this._hx(speed), '0E': this._hx((12 + Math.random() * 6) * 2 + 128),
        '0F': this._hx(28 + 40), '10': this._hx((2 + rpm / 400) * 100, 2), '11': this._hx(15 + speed / 2),
        '13': '33', '14': this._hx((0.1 + Math.random() * 0.8) * 200) + 'FF', '15': '5AFF',
        '1C': '06', '1F': this._hx(t, 2), '21': this._hx(152, 2), '2E': this._hx(40),
        '2F': this._hx(61 * 2.55), '30': '0C', '31': this._hx(1248, 2), '33': '62',
        '42': this._hx((13.9 + Math.random() * 0.3) * 1000, 2), '43': this._hx(60, 2),
        '44': this._hx(32768, 2), '45': this._hx(14), '46': this._hx(19 + 40),
        '47': this._hx(40), '49': this._hx(38), '4A': this._hx(19), '4C': this._hx(20),
        '4D': this._hx(85, 2), '4E': this._hx(940, 2),
      };
      // cerere multi-PID (până la 6 PID-uri într-un mesaj CAN)
      const pids = cmd.slice(2).match(/.{2}/g);
      let out = '41';
      for (const p of pids) { if (map[p] !== undefined) out += p + map[p]; }
      return out.length > 2 ? ecu(out) : 'NO DATA';
    }
    if (mode === '02') {
      const ff = { '00': 'BE1F8000', '02': '0171', '03': '0200', '04': '4C', '05': '7B', '06': '9A', '07': '8F', '0B': '24', '0C': '0BB8', '0D': '3C', '0E': '94', '0F': '48', '10': '03E8', '11': '2A' };
      const v = ff[pid]; return v ? ecu('42' + pid + '00' + v) : 'NO DATA';
    }
    if (mode === '03') return ecu('43' + this._hx(this.dtcs.length) + this.dtcs.join(''));
    if (mode === '07') return ecu('47' + this._hx(this.pendingDtcs.length) + this.pendingDtcs.join(''));
    if (mode === '0A') return ecu('4A00');
    if (mode === '04') { this.dtcs = []; this.pendingDtcs = []; this.milOn = false; return ecu('44'); }
    if (mode === '09') {
      const asc = s => [...s].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')).join('');
      if (pid === '00') return ecu('490055400000');
      if (pid === '02') return ecu('490201' + asc('WF0SXXGCDS9A12345'));
      if (pid === '04') return ecu('490401' + asc('8M5A-12A650-AXB'.padEnd(16, '\0')).replace(/00/g, '00'));
      if (pid === '06') return ecu('49060112A4C3F0');
      if (pid === '0A') return ecu('490A01' + asc('ECM-EngineControl\0\0\0'));
      return 'NO DATA';
    }
    if (mode === '06') {
      if (pid === '00') return ecu('4600C0000001');
      if (pid === '01') return ecu('46' + '01010A0B5400001C20' + '01020A019000000258');
      if (pid === '21') return ecu('46' + '218024012300000400');
      if (['A2', 'A3', 'A4', 'A5'].includes(pid)) {
        // cilindrul 3 are rateuri care cresc în timp
        const cur = pid === 'A4' ? Math.floor(t / 4) : (Math.random() < 0.1 ? 1 : 0);
        const ewma = pid === 'A4' ? 18 : 0;
        return ecu('46' + pid + '0B24' + this._hx(ewma, 2) + '0000FFFF' + pid + '0C24' + this._hx(cur, 2) + '0000FFFF');
      }
      return 'NO DATA';
    }
    if (mode === '22') {
      if (cmd === '221E1C') return ecu('621E1C' + this._hx((55 + Math.sin(t / 20) * 10) * 16, 2));
      if (cmd === '22F190') return ecu('62F190' + '5746305358584743445339413132333435');
      return ecu('7F2231');
    }
    return 'NO DATA';
  }

  _module(cmd) {
    const id = (parseInt(this.header, 16) + 8).toString(16).toUpperCase();
    if (!(this.header in this.moduleDtcs)) return 'NO DATA';
    const list = this.moduleDtcs[this.header];
    if (cmd.startsWith('1902')) return this._frame(id, '5902FF' + list.map(d => d.join('')).join(''));
    if (cmd.startsWith('14')) { this.moduleDtcs[this.header] = []; return this._frame(id, '54'); }
    if (cmd === '22F190') return this._frame(id, '62F190' + '5746305358584743445339413132333435');
    if (cmd === '22F188') return this._frame(id, '62F188' + [...'9M5T-14C026-AA'].map(c => c.charCodeAt(0).toString(16)).join('').toUpperCase());
    if (cmd === '3E00') return this._frame(id, '7E00');
    return this._frame(id, '7F' + cmd.slice(0, 2) + '11');
  }

  _at(c) {
    if (c === 'Z' || c === 'WS') { this.headers = false; this.spaces = true; this.echo = true; this.header = '7DF'; return '\rELM327 v1.5'; }
    if (c === 'I') return 'ELM327 v1.5';
    if (c === '@1') return 'OBDII to RS232 Interpreter (DEMO)';
    if (c === 'RV') return (12.4 + Math.random() * 1.6).toFixed(1) + 'V';
    if (c === 'DP') return 'ISO 15765-4 (CAN 11/500)';
    if (c === 'DPN') return '6';
    if (c.startsWith('E')) { this.echo = c === 'E1'; return 'OK'; }
    if (c.startsWith('S') && c.length === 2 && 'S0S1'.includes(c)) { this.spaces = c === 'S1'; return 'OK'; }
    if (c.startsWith('H') && c.length === 2) { this.headers = c === 'H1'; return 'OK'; }
    if (c.startsWith('SH')) { this.header = c.slice(2).slice(-3); return 'OK'; }
    if (c === 'DESC' || c === '@2') return '?';
    return 'OK';
  }
}

window.Transports = { SerialTransport, BleTransport, DemoTransport, ConnError };
