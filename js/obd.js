/* =====================================================================
 * obd.js — Servicii OBD-II standard (SAE J1979 / ISO 15031-5)
 *   Mode 01 date live, 02 freeze frame, 03/07/0A coduri, 04 ștergere,
 *   06 rezultate teste monitorizare, 09 informații vehicul
 * ===================================================================== */
'use strict';

const u16 = (a, b) => a * 256 + b;
const s16 = (a, b) => { const v = a * 256 + b; return v > 32767 ? v - 65536 : v; };

const FUEL_SYS = { 1: 'Buclă deschisă (rece)', 2: 'Buclă închisă', 4: 'Buclă deschisă (sarcină/decel.)', 8: 'Buclă deschisă (defect)', 16: 'Buclă închisă (defect senzor)' };
const OBD_STD = { 1: 'OBD-II (CARB)', 2: 'OBD (EPA)', 3: 'OBD + OBD-II', 4: 'OBD-I', 5: 'Fără OBD', 6: 'EOBD (Europa)', 7: 'EOBD + OBD-II', 8: 'EOBD + OBD', 9: 'EOBD + OBD + OBD-II', 10: 'JOBD', 11: 'JOBD + OBD-II', 12: 'JOBD + EOBD', 13: 'JOBD + EOBD + OBD-II', 17: 'EMD', 18: 'EMD+', 19: 'HD OBD-C', 20: 'HD OBD', 21: 'WWH OBD', 23: 'HD EOBD-I', 24: 'HD EOBD-I N', 25: 'HD EOBD-II', 26: 'HD EOBD-II N', 28: 'OBDBr-1', 29: 'OBDBr-2', 30: 'KOBD', 31: 'IOBD I', 32: 'IOBD II', 33: 'HD EOBD-VI' };
const FUEL_TYPE = { 1: 'Benzină', 2: 'Metanol', 3: 'Etanol', 4: 'Diesel', 5: 'GPL', 6: 'GNC', 7: 'Propan', 8: 'Electric', 9: 'Bi-fuel benzină', 10: 'Bi-fuel metanol', 11: 'Bi-fuel etanol', 12: 'Bi-fuel GPL', 13: 'Bi-fuel GNC', 15: 'Bi-fuel electric', 17: 'Hibrid benzină', 18: 'Hibrid etanol', 19: 'Hibrid diesel', 20: 'Hibrid electric' };

/* Definiții PID Mode 01: { name, unit, bytes, min, max, f(A,B,C,D) | text(...) } */
const PIDS = {
  0x03: { name: 'Stare sistem combustibil', unit: '', text: (A) => FUEL_SYS[A] || ('0x' + A.toString(16)) },
  0x04: { name: 'Sarcină motor calculată', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x05: { name: 'Temperatură lichid răcire', unit: '°C', min: -40, max: 130, f: A => A - 40 },
  0x06: { name: 'Corecție combustibil scurtă B1 (STFT)', unit: '%', min: -25, max: 25, f: A => A / 1.28 - 100 },
  0x07: { name: 'Corecție combustibil lungă B1 (LTFT)', unit: '%', min: -25, max: 25, f: A => A / 1.28 - 100 },
  0x08: { name: 'Corecție combustibil scurtă B2', unit: '%', min: -25, max: 25, f: A => A / 1.28 - 100 },
  0x09: { name: 'Corecție combustibil lungă B2', unit: '%', min: -25, max: 25, f: A => A / 1.28 - 100 },
  0x0A: { name: 'Presiune combustibil', unit: 'kPa', min: 0, max: 765, f: A => A * 3 },
  0x0B: { name: 'Presiune absolută galerie (MAP)', unit: 'kPa', min: 0, max: 255, f: A => A },
  0x0C: { name: 'Turație motor', unit: 'rpm', min: 0, max: 7000, f: (A, B) => u16(A, B) / 4 },
  0x0D: { name: 'Viteză vehicul', unit: 'km/h', min: 0, max: 240, f: A => A },
  0x0E: { name: 'Avans aprindere', unit: '° înainte PMS', min: -20, max: 60, f: A => A / 2 - 64 },
  0x0F: { name: 'Temperatură aer admisie', unit: '°C', min: -40, max: 100, f: A => A - 40 },
  0x10: { name: 'Debit aer masic (MAF)', unit: 'g/s', min: 0, max: 300, f: (A, B) => u16(A, B) / 100 },
  0x11: { name: 'Poziție clapetă accelerație', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x12: { name: 'Stare aer secundar', unit: '', text: A => ({ 1: 'Amonte', 2: 'Aval catalizator', 4: 'Atmosferă/oprit', 8: 'Pompă comandată (diag.)' }[A] || A) },
  0x13: { name: 'Senzori O2 prezenți', unit: '', text: A => 'B1:' + [0, 1, 2, 3].filter(i => A & (1 << i)).map(i => 'S' + (i + 1)).join(',') + ' B2:' + [4, 5, 6, 7].filter(i => A & (1 << i)).map(i => 'S' + (i - 3)).join(',') },
  0x14: { name: 'Sondă O2 B1S1 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x15: { name: 'Sondă O2 B1S2 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x16: { name: 'Sondă O2 B1S3 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x17: { name: 'Sondă O2 B1S4 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x18: { name: 'Sondă O2 B2S1 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x19: { name: 'Sondă O2 B2S2 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x1A: { name: 'Sondă O2 B2S3 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x1B: { name: 'Sondă O2 B2S4 tensiune', unit: 'V', min: 0, max: 1.275, f: A => A / 200 },
  0x1C: { name: 'Standard OBD', unit: '', text: A => OBD_STD[A] || A },
  0x1F: { name: 'Timp de la pornire', unit: 's', min: 0, max: 65535, f: (A, B) => u16(A, B) },
  0x21: { name: 'Distanță parcursă cu MIL aprins', unit: 'km', min: 0, max: 65535, f: (A, B) => u16(A, B) },
  0x22: { name: 'Presiune rampă (relativă la vacuum)', unit: 'kPa', min: 0, max: 5177, f: (A, B) => u16(A, B) * 0.079 },
  0x23: { name: 'Presiune rampă combustibil (diesel/GDI)', unit: 'bar', min: 0, max: 2000, f: (A, B) => u16(A, B) * 10 / 100 },
  0x24: { name: 'Lambda B1S1 (bandă largă)', unit: 'λ', min: 0, max: 2, f: (A, B) => u16(A, B) * 2 / 65536 },
  0x25: { name: 'Lambda B1S2', unit: 'λ', min: 0, max: 2, f: (A, B) => u16(A, B) * 2 / 65536 },
  0x2C: { name: 'EGR comandat', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x2D: { name: 'Eroare EGR', unit: '%', min: -100, max: 100, f: A => A / 1.28 - 100 },
  0x2E: { name: 'Purjare evaporativă comandată', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x2F: { name: 'Nivel combustibil', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x30: { name: 'Încălziri de la ștergerea codurilor', unit: '', min: 0, max: 255, f: A => A },
  0x31: { name: 'Distanță de la ștergerea codurilor', unit: 'km', min: 0, max: 65535, f: (A, B) => u16(A, B) },
  0x32: { name: 'Presiune vapori sistem EVAP', unit: 'Pa', min: -8192, max: 8192, f: (A, B) => s16(A, B) / 4 },
  0x33: { name: 'Presiune barometrică', unit: 'kPa', min: 0, max: 255, f: A => A },
  0x34: { name: 'Lambda B1S1 (curent)', unit: 'λ', min: 0, max: 2, f: (A, B) => u16(A, B) * 2 / 65536 },
  0x3C: { name: 'Temperatură catalizator B1S1', unit: '°C', min: -40, max: 1000, f: (A, B) => u16(A, B) / 10 - 40 },
  0x3D: { name: 'Temperatură catalizator B2S1', unit: '°C', min: -40, max: 1000, f: (A, B) => u16(A, B) / 10 - 40 },
  0x3E: { name: 'Temperatură catalizator B1S2', unit: '°C', min: -40, max: 1000, f: (A, B) => u16(A, B) / 10 - 40 },
  0x3F: { name: 'Temperatură catalizator B2S2', unit: '°C', min: -40, max: 1000, f: (A, B) => u16(A, B) / 10 - 40 },
  0x42: { name: 'Tensiune modul control', unit: 'V', min: 8, max: 16, f: (A, B) => u16(A, B) / 1000 },
  0x43: { name: 'Sarcină absolută', unit: '%', min: 0, max: 100, f: (A, B) => u16(A, B) / 2.55 },
  0x44: { name: 'Lambda comandat', unit: 'λ', min: 0, max: 2, f: (A, B) => u16(A, B) * 2 / 65536 },
  0x45: { name: 'Poziție relativă clapetă', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x46: { name: 'Temperatură ambientală', unit: '°C', min: -40, max: 60, f: A => A - 40 },
  0x47: { name: 'Poziție absolută clapetă B', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x48: { name: 'Poziție absolută clapetă C', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x49: { name: 'Poziție pedală accelerație D', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x4A: { name: 'Poziție pedală accelerație E', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x4B: { name: 'Poziție pedală accelerație F', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x4C: { name: 'Clapetă comandată (actuator)', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x4D: { name: 'Timp funcționare cu MIL aprins', unit: 'min', min: 0, max: 65535, f: (A, B) => u16(A, B) },
  0x4E: { name: 'Timp de la ștergerea codurilor', unit: 'min', min: 0, max: 65535, f: (A, B) => u16(A, B) },
  0x51: { name: 'Tip combustibil', unit: '', text: A => FUEL_TYPE[A] || A },
  0x52: { name: 'Procent etanol', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x59: { name: 'Presiune absolută rampă', unit: 'kPa', min: 0, max: 655350, f: (A, B) => u16(A, B) * 10 },
  0x5A: { name: 'Poziție relativă pedală', unit: '%', min: 0, max: 100, f: A => A / 2.55 },
  0x5C: { name: 'Temperatură ulei motor', unit: '°C', min: -40, max: 160, f: A => A - 40 },
  0x5D: { name: 'Avans injecție', unit: '°', min: -210, max: 302, f: (A, B) => u16(A, B) / 128 - 210 },
  0x5E: { name: 'Consum instantaneu', unit: 'L/h', min: 0, max: 50, f: (A, B) => u16(A, B) / 20 },
  0x61: { name: 'Cuplu cerut de șofer', unit: '%', min: -125, max: 130, f: A => A - 125 },
  0x62: { name: 'Cuplu motor actual', unit: '%', min: -125, max: 130, f: A => A - 125 },
  0x63: { name: 'Cuplu de referință', unit: 'Nm', min: 0, max: 65535, f: (A, B) => u16(A, B) },
};
// lambda bandă largă pentru toate sondele
for (let i = 0; i < 8; i++) {
  const bank = i < 4 ? 1 : 2, s = (i % 4) + 1;
  if (!PIDS[0x24 + i]) PIDS[0x24 + i] = { name: `Lambda B${bank}S${s} (tensiune)`, unit: 'λ', min: 0, max: 2, f: (A, B) => u16(A, B) * 2 / 65536 };
  if (!PIDS[0x34 + i]) PIDS[0x34 + i] = { name: `Lambda B${bank}S${s} (curent)`, unit: 'λ', min: 0, max: 2, f: (A, B) => u16(A, B) * 2 / 65536 };
}

/* Monitoare readiness — PID 01 */
const MON_CONT = [['Rateuri (misfire)', 0], ['Sistem combustibil', 1], ['Componente', 2]];
const MON_SPARK = ['Catalizator', 'Catalizator încălzit', 'Sistem EVAP', 'Aer secundar', 'A/C (refrigerant)', 'Senzori O2', 'Încălzire senzori O2', 'Sistem EGR/VVT'];
const MON_DIESEL = ['Catalizator NMHC', 'Catalizator NOx/SCR', '—', 'Presiune supraalimentare', '—', 'Senzor gaze evacuare', 'Filtru particule (DPF)', 'Sistem EGR/VVT'];

function decodeDTC(b1, b2) {
  const letter = 'PCBU'[b1 >> 6];
  const d1 = (b1 >> 4) & 3;
  const rest = ((b1 & 0x0f).toString(16) + b2.toString(16).padStart(2, '0')).toUpperCase();
  return letter + d1 + rest;
}

class OBD {
  constructor(elm) { this.elm = elm; this.supported = new Set(); this.supported09 = new Set(); }

  /** returnează primul mesaj al cărui prim octet = svc+0x40 */
  _pick(res, svcResp, ecuPref) {
    if (res.error) return null;
    let msgs = res.messages.filter(m => m.bytes[0] === svcResp);
    if (ecuPref) { const p = msgs.find(m => m.ecu === ecuPref); if (p) return p; }
    // preferă PCM (7E8)
    return msgs.find(m => m.ecu === '7E8' || m.ecu === '10') || msgs[0] || null;
  }

  async loadSupported() {
    this.supported.clear();
    for (const base of [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0]) {
      const res = await this.elm.request('01' + hx(base));
      const m = this._pick(res, 0x41);
      if (!m || m.bytes[1] !== base) break;
      const mask = m.bytes.slice(2, 6);
      for (let i = 0; i < 32; i++) if (mask[i >> 3] & (0x80 >> (i & 7))) this.supported.add(base + i + 1);
      if (!this.supported.has(base + 0x20)) break;
    }
    return [...this.supported].sort((a, b) => a - b);
  }

  decodePid(pid, data) {
    const def = PIDS[pid];
    if (!def) return { pid, name: 'PID 0x' + hx(pid), value: toHex(data), unit: '', raw: data, text: true };
    const [A = 0, B = 0, C = 0, D = 0] = data;
    if (def.text) return { pid, name: def.name, value: def.text(A, B, C, D), unit: def.unit, text: true };
    const v = def.f(A, B, C, D);
    return { pid, name: def.name, value: v, unit: def.unit, min: def.min, max: def.max };
  }

  async readPid(pid) {
    const res = await this.elm.request('01' + hx(pid));
    const m = this._pick(res, 0x41);
    if (!m || m.bytes[1] !== pid) return null;
    return this.decodePid(pid, m.bytes.slice(2));
  }

  /** Citire mai multor PID-uri într-o cerere (până la 6 pe CAN) */
  async readPids(pids) {
    const out = {};
    if (!this.elm.isCAN || pids.length === 1 || this.noMulti) {
      for (const p of pids) out[p] = await this.readPid(p);
      return out;
    }
    for (let i = 0; i < pids.length; i += 6) {
      const group = pids.slice(i, i + 6);
      const res = await this.elm.request('01' + group.map(hx).join(''));
      const m = this._pick(res, 0x41);
      if (!m) { this.noMulti = true; for (const p of group) out[p] = await this.readPid(p); continue; }
      let idx = 1;
      const b = m.bytes;
      let ok = 0;
      while (idx < b.length) {
        const pid = b[idx];
        if (!group.includes(pid)) break;
        const len = pidLen(pid);
        out[pid] = this.decodePid(pid, b.slice(idx + 1, idx + 1 + len));
        idx += 1 + len; ok++;
      }
      if (ok < group.length) for (const p of group) if (!(p in out)) out[p] = await this.readPid(p);
    }
    return out;
  }

  async readStatus() {
    const res = await this.elm.request('0101');
    const m = this._pick(res, 0x41);
    if (!m) return null;
    const [A, B, C, D] = m.bytes.slice(2);
    const diesel = !!(B & 0x08);
    const monitors = [];
    for (const [name, bit] of MON_CONT) {
      if (B & (1 << bit)) monitors.push({ name, complete: !(B & (1 << (bit + 4))) });
    }
    const names = diesel ? MON_DIESEL : MON_SPARK;
    for (let i = 0; i < 8; i++) {
      if (names[i] === '—') continue;
      if (C & (1 << i)) monitors.push({ name: names[i], complete: !(D & (1 << i)) });
    }
    return { mil: !!(A & 0x80), dtcCount: A & 0x7f, diesel, monitors };
  }

  _dtcsFrom(res, svcResp) {
    const all = [];
    for (const m of res.messages.filter(x => x.bytes[0] === svcResp)) {
      let b = m.bytes.slice(1);
      if (this.elm.isCAN) b = b.slice(1);   // octet număr coduri
      for (let i = 0; i + 1 < b.length; i += 2) {
        if (b[i] === 0 && b[i + 1] === 0) continue;
        all.push({ code: decodeDTC(b[i], b[i + 1]), ecu: m.ecu });
      }
    }
    // unicitate
    const seen = new Set();
    return all.filter(d => { const k = d.code + d.ecu; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  async readDTCs() {
    const stored = this._dtcsFrom(await this.elm.request('03', 6000), 0x43);
    const pending = this._dtcsFrom(await this.elm.request('07', 6000), 0x47);
    const permanent = this._dtcsFrom(await this.elm.request('0A', 6000), 0x4A);
    return { stored, pending, permanent };
  }

  async clearDTCs() {
    await this.elm.send('ATSTFF');
    try {
      const res = await this.elm.request('04', 10000);
      return !!this._pick(res, 0x44);
    } finally {
      await this.elm.send('ATST64');
    }
  }

  async readFreezeFrame(frame = 0) {
    const out = [];
    const sup = new Set();
    const r0 = await this.elm.request('0200' + hx(frame));
    const m0 = this._pick(r0, 0x42);
    if (!m0) return null;
    const mask = m0.bytes.slice(3, 7);
    for (let i = 0; i < 32; i++) if (mask[i >> 3] & (0x80 >> (i & 7))) sup.add(i + 1);
    // codul care a provocat freeze frame
    let dtc = null;
    const r2 = await this.elm.request('0202' + hx(frame));
    const m2 = this._pick(r2, 0x42);
    if (m2 && (m2.bytes[3] || m2.bytes[4])) dtc = decodeDTC(m2.bytes[3], m2.bytes[4]);
    for (const pid of [...sup].sort((a, b) => a - b)) {
      if (pid === 0x01 || pid === 0x02 || pid === 0x20 || !PIDS[pid]) continue;
      const r = await this.elm.request('02' + hx(pid) + hx(frame));
      const m = this._pick(r, 0x42);
      if (m && m.bytes[1] === pid) out.push(this.decodePid(pid, m.bytes.slice(3)));
    }
    return { dtc, values: out };
  }

  async vehicleInfo() {
    const info = {};
    const ascii = b => b.filter(c => c >= 0x20 && c < 0x7f).map(c => String.fromCharCode(c)).join('').trim();
    const get = async (pid) => {
      const res = await this.elm.request('09' + hx(pid), 6000);
      return res.messages.filter(m => m.bytes[0] === 0x49 && m.bytes[1] === pid);
    };
    let ms = await get(0x02);
    if (ms.length) info.vin = ascii(ms[0].bytes.slice(this.elm.isCAN ? 3 : 3));
    ms = await get(0x04);
    if (ms.length) {
      const b = ms[0].bytes.slice(3), ids = [];
      for (let i = 0; i < b.length; i += 16) { const s = ascii(b.slice(i, i + 16)); if (s) ids.push(s); }
      info.calId = ids.join(', ');
    }
    ms = await get(0x06);
    if (ms.length) {
      const b = ms[0].bytes.slice(3), c = [];
      for (let i = 0; i + 3 < b.length; i += 4) c.push(toHex(b.slice(i, i + 4), ''));
      info.cvn = c.join(', ');
    }
    ms = await get(0x0A);
    if (ms.length) info.ecuName = ms.map(m => m.ecu + ': ' + ascii(m.bytes.slice(3))).join('; ');
    if (info.vin) Object.assign(info, decodeVIN(info.vin));
    return info;
  }

  async readMode06() {
    const mids = [0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x21, 0x22, 0x31, 0x32, 0x35, 0x36, 0x39, 0x3A, 0x3B, 0x3C, 0x3D, 0x41, 0x42, 0x45, 0x46, 0x61, 0x62, 0x71, 0x72, 0x81, 0x82, 0x85, 0x86, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9];
    const out = [];
    if (!this.elm.isCAN) return { unsupported: true, rows: [] };
    for (const mid of mids) {
      const res = await this.elm.request('06' + hx(mid));
      const m = this._pick(res, 0x46);
      if (!m) continue;
      const b = m.bytes.slice(1);
      for (let i = 0; i + 8 < b.length; i += 9) {
        if (b[i] !== mid) break;
        const tid = b[i + 1], uas = b[i + 2];
        const val = u16(b[i + 3], b[i + 4]), min = u16(b[i + 5], b[i + 6]), max = u16(b[i + 7], b[i + 8]);
        const sc = UAS[uas] || { f: x => x, u: '(UAS ' + hx(uas) + ')' };
        const v = sc.f(val), lo = sc.f(min), hi = sc.f(max);
        out.push({ mid, midName: MIDS[mid] || ('OBDMID ' + hx(mid)), tid, value: v, min: lo, max: hi, unit: sc.u, pass: v >= lo && v <= hi });
      }
    }
    return { rows: out };
  }

  /** Contoare rateuri pe cilindru (Mode 06, OBDMID A2–AD; TID 0B = medie EWMA
   *  ultimele 10 cicluri, TID 0C = ciclul curent/ultimul). Doar CAN. */
  async readMisfire(cylinders = 8) {
    const out = [];
    if (!this.elm.isCAN) return null;
    for (let c = 1; c <= Math.min(12, cylinders); c++) {
      const mid = 0xA1 + c;
      const res = await this.elm.request('06' + hx(mid));
      const m = this._pick(res, 0x46);
      if (!m) { if (c === 1) return null; break; }
      const b = m.bytes.slice(1), row = { cyl: c, ewma: null, current: null };
      for (let i = 0; i + 8 < b.length; i += 9) {
        if (b[i] !== mid) break;
        const val = u16(b[i + 3], b[i + 4]);
        if (b[i + 1] === 0x0B) row.ewma = val;
        if (b[i + 1] === 0x0C) row.current = val;
      }
      out.push(row);
    }
    return out;
  }
}

/* Unități/scalare Mode 06 (SAE J1979 anexa E) — cele mai uzuale */
const sgn = x => x > 32767 ? x - 65536 : x;
const UAS = {
  0x01: { f: x => x, u: '' }, 0x02: { f: x => x / 10, u: '' }, 0x03: { f: x => x / 100, u: '' },
  0x04: { f: x => x / 1000, u: '' }, 0x05: { f: x => x * 0.0000305, u: '' }, 0x06: { f: x => x * 0.000305, u: '' },
  0x07: { f: x => x / 4, u: 'rpm' }, 0x08: { f: x => x / 100, u: 'km/h' }, 0x09: { f: x => x, u: 'km/h' },
  0x0A: { f: x => x * 0.122, u: 'mV' }, 0x0B: { f: x => x / 1000, u: 'V' }, 0x0C: { f: x => x / 100, u: 'V' },
  0x0D: { f: x => x * 0.00390625, u: 'mA' }, 0x0E: { f: x => x / 1000, u: 'A' }, 0x0F: { f: x => x / 100, u: 'A' },
  0x10: { f: x => x, u: 'ms' }, 0x11: { f: x => x * 100, u: 'ms' }, 0x12: { f: x => x, u: 's' },
  0x13: { f: x => x, u: 'mΩ' }, 0x14: { f: x => x, u: 'Ω' }, 0x15: { f: x => x, u: 'kΩ' },
  0x16: { f: x => x / 10 - 40, u: '°C' }, 0x17: { f: x => x / 100, u: 'kPa' }, 0x18: { f: x => x * 0.0117, u: 'kPa' },
  0x19: { f: x => x * 0.079, u: 'kPa' }, 0x1A: { f: x => x, u: 'kPa' }, 0x1B: { f: x => x * 10, u: 'kPa' },
  0x1C: { f: x => x / 100, u: '°' }, 0x1D: { f: x => x / 2, u: '°' }, 0x1E: { f: x => x * 0.0000305, u: 'λ' },
  0x1F: { f: x => x * 0.05, u: 'A/F' }, 0x20: { f: x => x * 0.0039062, u: '' }, 0x21: { f: x => x / 1000, u: 'mHz' },
  0x22: { f: x => x / 100, u: 'Hz' }, 0x23: { f: x => x, u: 'kHz' }, 0x24: { f: x => x, u: 'contor' },
  0x25: { f: x => x, u: 'km' }, 0x26: { f: x => x / 10, u: 'mV/ms' }, 0x27: { f: x => x / 100, u: 'g/s' },
  0x28: { f: x => x, u: 'g/s' }, 0x29: { f: x => x / 4, u: 'Pa/s' }, 0x2A: { f: x => x / 1000, u: 'kg/h' },
  0x2B: { f: x => x, u: 'comutări' }, 0x2C: { f: x => x / 100, u: 'g/cil' }, 0x2D: { f: x => x / 100, u: 'mg/cursă' },
  0x2E: { f: x => x, u: '' }, 0x2F: { f: x => x / 100, u: '%' }, 0x30: { f: x => x * 0.001526, u: '%' },
  0x31: { f: x => x / 1000, u: 'L' }, 0x32: { f: x => x * 0.0007747, u: 'inch' }, 0x33: { f: x => x * 0.00024414, u: 'λ' },
  0x34: { f: x => x, u: 'min' }, 0x35: { f: x => x / 100, u: 's' }, 0x36: { f: x => x / 100, u: 'g' },
  0x37: { f: x => x / 10, u: 'g' }, 0x38: { f: x => x, u: 'g' }, 0x39: { f: x => x / 100 - 327.68, u: '%' },
  0x81: { f: x => sgn(x), u: '' }, 0x82: { f: x => sgn(x) / 10, u: '' }, 0x83: { f: x => sgn(x) / 100, u: '' },
  0x84: { f: x => sgn(x) / 1000, u: '' }, 0x85: { f: x => sgn(x) * 0.0000305, u: '' }, 0x86: { f: x => sgn(x) * 0.000305, u: '' },
  0x8A: { f: x => sgn(x) * 0.122, u: 'mV' }, 0x8B: { f: x => sgn(x) / 1000, u: 'V' }, 0x8C: { f: x => sgn(x) / 100, u: 'V' },
  0x8D: { f: x => sgn(x) * 0.00390625, u: 'mA' }, 0x8E: { f: x => sgn(x) / 1000, u: 'A' }, 0x90: { f: x => sgn(x), u: 'ms' },
  0x96: { f: x => sgn(x) / 10, u: '°C' }, 0x99: { f: x => sgn(x) / 10, u: 'kPa' }, 0x9C: { f: x => sgn(x) / 100, u: '°' },
  0x9D: { f: x => sgn(x) / 2, u: '°' }, 0xA8: { f: x => sgn(x), u: 'g/s' }, 0xA9: { f: x => sgn(x) / 4, u: 'Pa/s' },
  0xAF: { f: x => sgn(x) / 100, u: '%' }, 0xB0: { f: x => sgn(x) * 0.003052, u: '%' }, 0xB1: { f: x => sgn(x) * 2, u: 'mV/s' },
  0xFD: { f: x => sgn(x) * 0.001, u: 'kPa' }, 0xFE: { f: x => sgn(x) * 0.25, u: 'Pa' },
};
const MIDS = {
  0x01: 'Senzor O2 B1S1', 0x02: 'Senzor O2 B1S2', 0x03: 'Senzor O2 B1S3', 0x04: 'Senzor O2 B1S4',
  0x05: 'Senzor O2 B2S1', 0x06: 'Senzor O2 B2S2', 0x07: 'Senzor O2 B2S3', 0x08: 'Senzor O2 B2S4',
  0x21: 'Catalizator B1', 0x22: 'Catalizator B2', 0x31: 'EGR / VVT B1', 0x32: 'EGR / VVT B2',
  0x35: 'VVT B1', 0x36: 'VVT B2', 0x39: 'EVAP (0.150")', 0x3A: 'EVAP (0.090")', 0x3B: 'EVAP (0.040")',
  0x3C: 'EVAP (0.020")', 0x3D: 'Flux purjare EVAP', 0x41: 'Încălzire O2 B1S1', 0x42: 'Încălzire O2 B1S2',
  0x45: 'Încălzire O2 B2S1', 0x46: 'Încălzire O2 B2S2', 0x61: 'Catalizator încălzit B1', 0x62: 'Catalizator încălzit B2',
  0x71: 'Aer secundar 1', 0x72: 'Aer secundar 2', 0x81: 'Sistem combustibil B1', 0x82: 'Sistem combustibil B2',
  0x85: 'Presiune supraalimentare B1', 0x86: 'Presiune supraalimentare B2', 0xA1: 'Rateuri — general',
  0xA2: 'Rateuri cilindru 1', 0xA3: 'Rateuri cilindru 2', 0xA4: 'Rateuri cilindru 3', 0xA5: 'Rateuri cilindru 4',
  0xA6: 'Rateuri cilindru 5', 0xA7: 'Rateuri cilindru 6', 0xA8: 'Rateuri cilindru 7', 0xA9: 'Rateuri cilindru 8',
};

/* Lungimea datelor per PID (pentru cereri multi-PID) */
function pidLen(pid) {
  const two = [0x02, 0x03, 0x0C, 0x10, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1F, 0x21, 0x22, 0x23, 0x31, 0x32, 0x3C, 0x3D, 0x3E, 0x3F, 0x42, 0x43, 0x44, 0x4D, 0x4E, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5D, 0x5E, 0x63];
  const four = [0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0x01, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x3B, 0x41, 0x4F, 0x50];
  if (two.includes(pid)) return 2;
  if (four.includes(pid)) return 4;
  return 1;
}

/* Decodare VIN (orientată pe Ford) */
function decodeVIN(vin) {
  const out = {};
  if (!vin || vin.length !== 17) return out;
  const wmi = vin.slice(0, 3);
  const WMI = {
    WF0: 'Ford Germania (Ford-Werke)', Z6F: 'Ford Sollers Rusia', WF1: 'Ford Germania', VS6: 'Ford Spania (Valencia)', SFA: 'Ford Marea Britanie',
    NM0: 'Ford Otosan Turcia', '1FA': 'Ford SUA (autoturism)', '1FB': 'Ford SUA (autobuz)', '1FC': 'Ford SUA (șasiu)',
    '1FD': 'Ford SUA (comercial)', '1FM': 'Ford SUA (MPV/SUV)', '1FT': 'Ford SUA (camionetă)', '1FU': 'Freightliner',
    '2FA': 'Ford Canada', '2FM': 'Ford Canada (MPV)', '2FT': 'Ford Canada (camion)', '3FA': 'Ford Mexic', '3FE': 'Ford Mexic',
    '3FT': 'Ford Mexic (camion)', '1LN': 'Lincoln SUA', '5LM': 'Lincoln SUV', '1ME': 'Mercury SUA', '4M2': 'Mercury',
    MAJ: 'Ford India', MNB: 'Ford Thailanda', LVS: 'Changan Ford China', '6FP': 'Ford Australia', '9BF': 'Ford Brazilia',
    VS6A: 'Ford Spania', X9F: 'Ford Rusia (Vsevolojsk)', Z6F: 'Ford Rusia', ZFA: 'Fiat (Ford Ka 2008+)',
  };
  out.manufacturer = WMI[wmi] || 'WMI ' + wmi;
  out.positions = [{ pos: '1–3', code: wmi, meaning: 'Producător (WMI): ' + out.manufacturer }];
  if (/^[1-5]/.test(wmi)) {
    // America de Nord: poziția 10 = an model (A=2010, 1=2001 … 9=2009)
    const idx = 'ABCDEFGHJKLMNPRSTVWXY123456789'.indexOf(vin[9]);
    if (idx >= 0) out.modelYear = idx < 21 ? 2010 + idx : 1980 + idx;
    out.serial = vin.slice(11);
    out.region = 'NA';
    out.positions.push({ pos: '4–8', code: vin.slice(3, 8), meaning: 'Descriere vehicul (motor, caroserie, sisteme siguranță)' }, { pos: '9', code: vin[8], meaning: 'Cifră de control' }, { pos: '10', code: vin[9], meaning: 'An model: ' + (out.modelYear || '?') }, { pos: '11', code: vin[10], meaning: 'Uzină asamblare' }, { pos: '12–17', code: out.serial, meaning: 'Număr de serie' });
  } else if (FORD_EU_WMI.includes(wmi)) {
    Object.assign(out, decodeFordEU(vin));
  } else {
    out.serial = vin.slice(11);
  }
  return out;
}

/* ---------------- Ford Europa — structura VIN (după tabelele de coduri Ford of Europe) ----------------
 * 1–3 WMI · 4 caroserie · 5–6 „XX” · 7 sursă produs · 8 uzină · 9 model · 10 caroserie · 11 an · 12 lună · 13–17 serie */
const FORD_EU_WMI = ['WF0', 'WF1', 'VS6', 'SFA', 'NM0', 'X9F', 'Z6F'];
const EU_BODY = {
  '3': 'furgon, plafon înalt', '5': 'combi, plafon înalt', A: '3 uși', B: '5 uși', C: 'coupé 2 uși / hatchback 3 uși', D: 'hatchback 5 uși',
  E: 'hatchback 3 uși', F: 'sedan 4 uși', G: 'monovolum (MPV) 5 uși', J: 'SUV 5 uși', K: 'monovolum mare 5 uși', L: 'cabriolet 2 uși',
  N: 'break 5 uși', P: 'hatchback 5 uși', S: 'break 5 uși', T: 'sedan 2 uși', U: 'furgon 5 uși', V: 'furgon 2 uși', W: 'furgon 3 uși',
};
const EU_SOURCE = { B: 'Ford Marea Britanie', C: 'afiliat Ford Marea Britanie / Irlanda / Olanda / Portugalia', E: 'afiliat Ford Germania / Ford România', G: 'Ford Germania', L: 'Ford Brazilia / Fiat / Pininfarina', M: 'India / Africa de Sud', P: 'AutoEuropa (Portugalia)', S: 'Mazda (Japonia)', T: 'Ford Otosan (Turcia)', W: 'Ford Spania', Z: 'SUA' };
const EU_PLANT = {
  GA: 'Köln, Germania', BA: 'Dagenham, Marea Britanie', TA: 'Ford Otosan Yeniköy, Turcia', BB: 'Halewood, Marea Britanie', GB: 'Genk, Belgia',
  GC: 'Saarlouis, Germania', BD: 'Southampton, Marea Britanie', GK: 'Karmann Rheine, Germania', WP: 'Valencia, Spania', TP: 'Ford Otosan İnönü, Turcia',
  ER: 'Craiova, România', SP: 'AutoEuropa Palmela, Portugalia', LT: 'Fiat Tychy, Polonia', TT: 'Ford Otosan Gölcük (Kocaeli), Turcia', LU: 'Pininfarina, Italia',
  MJ: 'Silverton, Africa de Sud', MR: 'Chennai, India', WG: 'Nissan Barcelona, Spania',
};
const EU_YEAR = c => { if (/[1-9]/.test(c)) return 2000 + +c; const i = 'ABCDEFGHJKLMNPRSTVWXY'.indexOf(c); return i >= 0 ? 2010 + i : null; };
function euModel(code, plant, year) {
  const y = year || 0;
  const gen = (name, gens) => { for (const [from, to, g] of gens) if (y >= from && y <= to) return name + ' ' + g; return name; };
  const focus = () => gen('Focus', [[1998, 2003, 'Mk1'], [2004, 2004, 'Mk1/Mk2'], [2005, 2010, 'Mk2'], [2011, 2011, 'Mk2/Mk3'], [2012, 2018, 'Mk3']]);
  const fiesta = () => gen('Fiesta', [[2002, 2007, 'Mk6'], [2008, 2008, 'Mk6/Mk7'], [2009, 2017, 'Mk7']]);
  switch (code) {
    case 'A': return 'Escort / Orion';
    case 'B': return plant === 'GB' ? gen('Mondeo', [[2000, 2006, 'Mk3'], [2007, 2007, 'Mk3/Mk4'], [2008, 2014, 'Mk4']]) : gen('C-Max', [[2003, 2009, 'Mk1'], [2010, 2010, 'Mk1/Mk2'], [2011, 2019, 'Mk2']]) + ' / Mondeo';
    case 'C': return plant === 'GB' ? 'S-Max' : focus() + (y >= 2014 ? ' / Transit Courier' : '');
    case 'D': return focus();
    case 'E': return y >= 2003 ? 'C-Max' : 'Puma (coupé) / Capri';
    case 'F': return fiesta() + ' / Transit';
    case 'G': return 'Transit / Transit Connect / Transit Custom';
    case 'H': return fiesta();
    case 'J': return fiesta() + ' / Fusion' + (y >= 2012 ? ' / B-Max' : '');
    case 'K': return fiesta() + (y >= 2013 ? ' / EcoSport' : '');
    case 'M': return gen('Kuga', [[2008, 2012, 'Mk1'], [2013, 2019, 'Mk2']]);
    case 'P': return 'Transit Connect';
    case 'R': return plant === 'LT' ? gen('Ka', [[2008, 2016, 'Mk2']]) : 'Ka / Transit';
    case 'S': return plant === 'SP' ? 'Galaxy (Mk1/Mk2, Palmela)' : plant === 'GB' ? 'Galaxy / S-Max' : 'Galaxy / S-Max';
    case 'U': return 'Maverick';
    case 'W': return plant === 'GB' ? 'S-Max / Galaxy (probabil)' : null;
    default: return null;
  }
}
function decodeFordEU(vin) {
  const o = { region: 'EU' };
  const plantKey = vin[6] + vin[7];
  const year = EU_YEAR(vin[10]);
  o.body = EU_BODY[vin[3]] || null;
  o.plant = EU_PLANT[plantKey] || null;
  o.modelYear = year ? year + ' (an model / fabricație)' : null;
  const model = euModel(vin[8], plantKey, year);
  o.model = model ? 'Ford ' + model : null;
  o.serial = vin.slice(12);
  o.monthCode = vin[11];
  o.positions = [
    { pos: '4', code: vin[3], meaning: 'Tip caroserie: ' + (EU_BODY[vin[3]] || 'cod necunoscut') },
    { pos: '5–6', code: vin.slice(4, 6), meaning: vin.slice(4, 6) === 'XX' ? 'Caractere de umplere (standard Ford Europa)' : 'Nestandard pentru Ford Europa' },
    { pos: '7', code: vin[6], meaning: 'Sursă produs: ' + (EU_SOURCE[vin[6]] || 'cod necunoscut') },
    { pos: '8', code: vin[7], meaning: 'Uzină asamblare: ' + (EU_PLANT[plantKey] || 'cod necunoscut pentru sursa ' + vin[6]) },
    { pos: '9', code: vin[8], meaning: 'Model: ' + (model || 'cod necunoscut') },
    { pos: '10', code: vin[9], meaning: 'Caroserie (detaliu): ' + (EU_BODY[vin[9]] || 'cod intern') },
    { pos: '11', code: vin[10], meaning: 'An: ' + (year || 'cod necunoscut') },
    { pos: '12', code: vin[11], meaning: 'Lună fabricație (cod Ford, se rotește la 4 ani) — luna exactă este pe eticheta de pe stâlpul ușii' },
    { pos: '13–17', code: vin.slice(12), meaning: 'Număr de serie de producție' },
  ];
  return o;
}

function hx(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }

window.OBD = OBD;
window.OBD_PIDS = PIDS;
window.decodeDTC = decodeDTC;
window.decodeVIN = decodeVIN;
window.hx = hx;
