/* =====================================================================
 * ford.js — Funcții specifice Ford 2007–2010
 *   - scanare module pe HS-CAN (500k) și MS-CAN (125k, adaptor cu comutator)
 *   - citire/ștergere coduri per modul (UDS 0x19 / KWP 0x18, ștergere 0x14)
 *   - identificare module (DID F111/F113/F188/F190)
 *   - PID-uri extinse Mode 22 (PCM/TCM) + PID-uri definite de utilizator
 * ===================================================================== */
'use strict';

/* Adrese tipice Ford (tx -> rx = tx + 8). Bus-ul tipic diferă pe modele. */
const FORD_MODULES = [
  { id: 'PCM',  name: 'Modul control motor (PCM/ECM)',          tx: '7E0', bus: 'HS' },
  { id: 'TCM',  name: 'Modul control transmisie (TCM)',          tx: '7E1', bus: 'HS' },
  { id: 'ABS',  name: 'ABS / ESP (frânare antiblocare)',         tx: '760', bus: 'HS' },
  { id: 'RCM',  name: 'Airbag (Restraint Control Module)',       tx: '737', bus: 'HS' },
  { id: 'PSCM', name: 'Servodirecție electrică (PSCM / EHPAS)',  tx: '730', bus: 'HS' },
  { id: 'IPC',  name: 'Bord (Instrument Panel Cluster)',         tx: '720', bus: 'HS/MS' },
  { id: 'GEM',  name: 'Modul electronic general (GEM/BCM/GEM)',  tx: '726', bus: 'HS/MS' },
  { id: 'SCCM', name: 'Comutatoare coloană volan (SCCM)',        tx: '724', bus: 'MS' },
  { id: 'PAM',  name: 'Asistență parcare (PAM)',                  tx: '736', bus: 'MS' },
  { id: 'HVAC', name: 'Climatizare (HVAC / EATC)',                tx: '733', bus: 'MS' },
  { id: 'ACM',  name: 'Audio (ACM / radio)',                      tx: '727', bus: 'MS' },
  { id: 'FCIM', name: 'Panou comenzi față (FCIM)',                tx: '7A7', bus: 'MS' },
  { id: 'FDIM', name: 'Afișaj central (FDIM)',                    tx: '7A6', bus: 'MS' },
  { id: 'APIM', name: 'SYNC / Bluetooth (APIM)',                  tx: '7D0', bus: 'MS' },
  { id: 'DDM',  name: 'Modul ușă șofer (DDM)',                    tx: '740', bus: 'MS' },
  { id: 'PDM',  name: 'Modul ușă pasager (PDM)',                  tx: '741', bus: 'MS' },
  { id: 'DSM',  name: 'Memorie scaun șofer (DSM)',                tx: '744', bus: 'MS' },
  { id: 'OCS',  name: 'Senzor ocupant (OCS)',                     tx: '765', bus: 'HS' },
  { id: '4X4',  name: 'Tracțiune integrală (4X4M / AWD)',         tx: '761', bus: 'HS' },
  { id: 'AWD',  name: 'Cuplaj AWD (Haldex – Kuga/Mondeo)',        tx: '703', bus: 'HS' },
  { id: 'HCM',  name: 'Faruri adaptive (HCM / AFS)',              tx: '734', bus: 'HS' },
  { id: 'CCM',  name: 'Cruise control adaptiv (ACC/CCM)',         tx: '764', bus: 'HS' },
  { id: 'TPMS', name: 'Monitorizare presiune anvelope',           tx: '751', bus: 'MS' },
  { id: 'GPSM', name: 'Navigație GPS (GPSM)',                     tx: '701', bus: 'MS' },
  { id: 'RFA',  name: 'Acces fără cheie (RFA / KVM)',             tx: '731', bus: 'MS' },
  { id: 'BCMii',name: 'Modul caroserie secundar (BCMii)',         tx: '7A5', bus: 'MS' },
  { id: 'GWM',  name: 'Gateway (GWM)',                            tx: '716', bus: 'HS' },
];

const UDS_NRC = {
  0x10: 'respins general', 0x11: 'serviciu nesuportat', 0x12: 'subfuncție nesuportată', 0x13: 'lungime/format incorect',
  0x14: 'răspuns prea lung', 0x21: 'ocupat, repetați', 0x22: 'condiții neîndeplinite', 0x24: 'secvență greșită',
  0x31: 'în afara domeniului', 0x33: 'acces securizat necesar', 0x35: 'cheie invalidă', 0x36: 'prea multe încercări',
  0x72: 'eroare programare', 0x78: 'răspuns în așteptare', 0x7E: 'subfuncție nesuportată în sesiunea curentă', 0x7F: 'serviciu nesuportat în sesiunea curentă',
};

const DTC_STATUS_BITS = ['Test eșuat acum', 'Eșuat în ciclul curent', 'În așteptare (pending)', 'Confirmat', 'Netestat de la ștergere', 'Eșuat de la ștergere', 'Netestat în ciclul curent', 'Cere lampă avertizare'];

const FORD_FTB = {
  0x00: '', 0x01: 'defect electric general', 0x02: 'defect semnal general', 0x04: 'defect intern', 0x07: 'defect mecanic', 0x08: 'semnal invalid / mesaj bus',
  0x11: 'scurtcircuit la masă', 0x12: 'scurtcircuit la baterie', 0x13: 'circuit întrerupt', 0x14: 'scurt la masă sau întrerupt', 0x15: 'scurt la baterie sau întrerupt',
  0x16: 'tensiune sub prag', 0x17: 'tensiune peste prag', 0x19: 'curent peste prag', 0x1A: 'rezistență sub prag', 0x1B: 'rezistență peste prag', 0x1C: 'tensiune în afara domeniului',
  0x1D: 'curent în afara domeniului', 0x1E: 'rezistență în afara domeniului', 0x1F: 'circuit intermitent', 0x21: 'amplitudine semnal < min', 0x22: 'amplitudine semnal > max',
  0x23: 'semnal blocat jos', 0x24: 'semnal blocat sus', 0x26: 'rată de variație prea mică', 0x27: 'rată de variație prea mare', 0x28: 'decalaj / zero semnal',
  0x29: 'semnal invalid', 0x2A: 'semnal blocat', 0x2F: 'semnal neregulat', 0x31: 'lipsă semnal', 0x36: 'frecvență prea mică', 0x37: 'frecvență prea mare',
  0x38: 'frecvență incorectă', 0x41: 'checksum general', 0x42: 'eroare memorie', 0x44: 'eroare memorie date', 0x45: 'eroare memorie program', 0x46: 'eroare calibrare/parametri',
  0x47: 'watchdog / siguranță', 0x48: 'eroare supervizare', 0x49: 'defect electronic intern', 0x4A: 'componentă incorectă montată', 0x4B: 'supratemperatură',
  0x51: 'neprogramat', 0x52: 'neactivat', 0x53: 'dezactivat', 0x54: 'lipsă calibrare', 0x55: 'neconfigurat', 0x56: 'configurație invalidă', 0x57: 'configurație invalidă (variantă)',
  0x62: 'comparație semnal eșuată', 0x63: 'timeout circuit/componentă', 0x64: 'semnal neplauzibil', 0x67: 'semnal incorect după eveniment', 0x68: 'eveniment informativ',
  0x71: 'actuator blocat', 0x72: 'actuator blocat deschis', 0x73: 'actuator blocat închis', 0x77: 'poziție comandată neatinsă', 0x78: 'aliniere/reglaj incorect',
  0x81: 'mesaj serial invalid primit', 0x82: 'contor mesaj incorect', 0x83: 'eroare protecție mesaj', 0x84: 'semnal sub domeniu', 0x85: 'semnal peste domeniu', 0x86: 'semnal invalid',
  0x87: 'mesaj lipsă', 0x88: 'bus off', 0x8F: 'semnal neregulat', 0x92: 'performanță incorectă', 0x94: 'operare neașteptată', 0x96: 'defect intern componentă', 0x98: 'temperatură prea mare',
};

class FordDiag {
  constructor(elm, obd) { this.elm = elm; this.obd = obd; this.bus = 'HS'; }

  rxOf(tx) { return (parseInt(tx, 16) + 8).toString(16).toUpperCase(); }

  async switchBus(bus, cmdsMS, cmdsHS) {
    if (bus === this.bus) return;
    const cmds = bus === 'MS' ? cmdsMS : cmdsHS;
    for (const c of cmds) if (c.trim()) await this.elm.send(c.trim());
    await this.elm.detectProtocol();
    this.elm.isCAN = true;
    this.elm.currentHeader = null; this.elm.currentFilter = null;
    this.bus = bus;
  }

  async _req(mod, hex, timeout) {
    await this.elm.setHeader(mod.tx, this.rxOf(mod.tx));
    const res = await this.elm.request(hex, timeout);
    const rx = this.rxOf(mod.tx);
    return { error: res.error, msgs: res.messages.filter(m => m.ecu === rx || m.ecu === 'ECU') };
  }

  /** Prezență modul: TesterPresent (3E00) sau citire DID VIN */
  async ping(mod) {
    let r = await this._req(mod, '3E00', 1500);
    if (r.msgs.length) return true;
    r = await this._req(mod, '22F190', 1500);
    return r.msgs.length > 0;
  }

  async readModuleDTCs(mod) {
    // 1) UDS ReadDTCInformation, raport după mască status
    let r = await this._req(mod, '1902FF', 3000);
    let m = r.msgs.find(x => x.bytes[0] === 0x59);
    if (m) {
      const b = m.bytes.slice(3), list = [];
      for (let i = 0; i + 3 < b.length; i += 4) {
        if (!b[i] && !b[i + 1] && !b[i + 2]) continue;
        list.push(this._dtc(b[i], b[i + 1], b[i + 2], b[i + 3]));
      }
      return { ok: true, proto: 'UDS', dtcs: list };
    }
    // 2) KWP2000 ReadDTCByStatus (module Ford mai vechi)
    r = await this._req(mod, '1800FF00', 3000);
    m = r.msgs.find(x => x.bytes[0] === 0x58);
    if (m) {
      const b = m.bytes.slice(2), list = [];
      for (let i = 0; i + 2 < b.length; i += 3) list.push(this._dtc(b[i], b[i + 1], null, b[i + 2]));
      return { ok: true, proto: 'KWP', dtcs: list };
    }
    // 3) PCM: OBD standard Mode 03
    if (mod.id === 'PCM' || mod.id === 'TCM') {
      r = await this._req(mod, '03', 4000);
      m = r.msgs.find(x => x.bytes[0] === 0x43);
      if (m) {
        const b = m.bytes.slice(2), list = [];
        for (let i = 0; i + 1 < b.length; i += 2) if (b[i] || b[i + 1]) list.push(this._dtc(b[i], b[i + 1], null, 0x08));
        return { ok: true, proto: 'OBD', dtcs: list };
      }
    }
    const nrc = r.msgs.find(x => x.bytes[0] === 0x7f);
    return { ok: false, error: nrc ? ('NRC ' + hx(nrc.bytes[2]) + ' – ' + (UDS_NRC[nrc.bytes[2]] || '')) : (r.error || 'fără răspuns'), dtcs: [] };
  }

  _dtc(b1, b2, ftb, status) {
    const code = decodeDTC(b1, b2);
    const st = [];
    if (status != null) DTC_STATUS_BITS.forEach((n, i) => { if (status & (1 << i)) st.push(n); });
    return {
      code, ftb, ftbText: ftb != null ? (FORD_FTB[ftb] != null ? FORD_FTB[ftb] : 'tip defect ' + hx(ftb)) : '',
      full: code + (ftb != null ? ':' + hx(ftb) : ''), status, statusText: st.join(', '),
      active: status != null ? !!(status & 0x01) : true, confirmed: status != null ? !!(status & 0x08) : true,
    };
  }

  async clearModuleDTCs(mod) {
    // ștergerea poate dura (răspuns 7F 14 78 „pending”) — mărim temporar timeout-ul ELM la ~1 s
    await this.elm.send('ATSTFF');
    try {
      let r = await this._req(mod, '14FFFFFF', 8000);
      if (r.msgs.some(x => x.bytes[0] === 0x54)) return { ok: true };
      r = await this._req(mod, '14FF00', 8000);
      if (r.msgs.some(x => x.bytes[0] === 0x54)) return { ok: true };
      if (mod.id === 'PCM') { r = await this._req(mod, '04', 8000); if (r.msgs.some(x => x.bytes[0] === 0x44)) return { ok: true }; }
      const nrc = r.msgs.find(x => x.bytes[0] === 0x7f);
      return { ok: false, error: nrc ? (UDS_NRC[nrc.bytes[2]] || 'NRC ' + hx(nrc.bytes[2])) : (r.error || 'fără răspuns') };
    } finally {
      await this.elm.send('ATST64');
    }
  }

  async identify(mod) {
    const dids = [['F190', 'VIN'], ['F188', 'Strategie / software'], ['F111', 'Nr. componentă (core)'], ['F113', 'Nr. ansamblu'], ['F18C', 'Nr. serie ECU'], ['DE00', 'Configurație (As-Built) bloc 1']];
    const out = [];
    for (const [did, label] of dids) {
      const r = await this._req(mod, '22' + did, 2000);
      const m = r.msgs.find(x => x.bytes[0] === 0x62);
      if (!m) continue;
      const data = m.bytes.slice(3);
      const asc = data.filter(c => c >= 0x20 && c < 0x7f).map(c => String.fromCharCode(c)).join('').trim();
      out.push({ did, label, value: did.startsWith('DE') || asc.length < data.length * 0.6 ? toHex(data) : asc });
    }
    return out;
  }

  /** PID Mode 22 / personalizat: { tx, cmd, formula, unit } */
  async readCustom(p) {
    await this.elm.setHeader(p.tx, this.rxOf(p.tx));
    const res = await this.elm.request(p.cmd, 2000);
    const rx = this.rxOf(p.tx);
    const m = res.messages.find(x => (x.ecu === rx || x.ecu === 'ECU') && x.bytes[0] === (parseInt(p.cmd.slice(0, 2), 16) + 0x40));
    if (!m) return null;
    const hdr = p.cmd.length / 2;               // ecou serviciu + identificator
    const d = m.bytes.slice(hdr);
    return evalFormula(p.formula, d);
  }
}

/* Evaluare formulă sigură: variabile A..H, funcții matematice, signed(x) */
function evalFormula(formula, d) {
  const stripped = String(formula).replace(/\b(signed|abs|min|max|round|floor)\b/g, '');
  if (!/^[\sA-H0-9.+\-*/()%,<>=?:&|^~]*$/.test(stripped)) throw new Error('Formulă invalidă (permise: A–H, cifre, + - * / ( ) și signed/abs/min/max/round/floor)');
  const [A = 0, B = 0, C = 0, D = 0, E = 0, F = 0, G = 0, H = 0] = d;
  const signed = x => (x > 127 && x < 256 ? x - 256 : (x > 32767 ? x - 65536 : x));
  const fn = new Function('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'signed', 'abs', 'min', 'max', 'round', 'floor', '"use strict"; return (' + formula + ');');
  return fn(A, B, C, D, E, F, G, H, signed, Math.abs, Math.min, Math.max, Math.round, Math.floor);
}

/* PID-uri extinse Ford predefinite (experimentale — variază pe motor/strategie) */
const FORD_ENHANCED_PRESETS = [
  // 1E1C: raw/16 °C (echivalent formulei Torque „((A*256+B)*9/8+320)/10” °F)
  { name: 'Temperatură ulei transmisie (TFT, PCM)', tx: '7E0', cmd: '221E1C', formula: '(signed(A)*256+B)/16', unit: '°C', note: 'automate controlate de PCM (4F27E, 5R/6R, 6F)' },
  { name: 'Temperatură ulei transmisie (TFT, TCM)', tx: '7E1', cmd: '221E1C', formula: '(signed(A)*256+B)/16', unit: '°C', note: 'automate cu TCM separat (Aisin AW, Powershift) – variază' },
  { name: 'Viteză vehicul (DID UDS F40D)', tx: '7E0', cmd: '22F40D', formula: 'A', unit: 'km/h', note: 'DID UDS echivalent PID 0D' },
  { name: 'Turație motor (DID UDS F40C)', tx: '7E0', cmd: '22F40C', formula: '(A*256+B)/4', unit: 'rpm', note: 'DID UDS echivalent PID 0C' },
  { name: 'Temperatură lichid răcire (DID F405)', tx: '7E0', cmd: '22F405', formula: 'A-40', unit: '°C', note: 'DID UDS echivalent PID 05' },
  { name: 'Tensiune baterie (adaptor ATRV)', tx: 'ATRV', cmd: 'ATRV', formula: '', unit: 'V', note: 'măsurată de adaptor la pinul 16' },
];

window.FordDiag = FordDiag;
window.FORD_MODULES = FORD_MODULES;
window.FORD_ENHANCED_PRESETS = FORD_ENHANCED_PRESETS;
window.evalFormula = evalFormula;
window.UDS_NRC = UDS_NRC;
