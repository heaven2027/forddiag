/* =====================================================================
 * history.js — Istoric scanări și jurnal service (IndexedDB, local pe dispozitiv)
 * ===================================================================== */
'use strict';

function makeStore(dbp, name) {
  async function tx(mode, fn) {
    const db = await dbp();
    return new Promise((res, rej) => {
      const t = db.transaction(name, mode);
      const r = fn(t.objectStore(name));
      t.oncomplete = () => res(r && 'result' in r ? r.result : undefined);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    add: rec => tx('readwrite', st => st.add(rec)),
    put: rec => tx('readwrite', st => st.put(rec)),
    del: id => tx('readwrite', st => st.delete(id)),
    get: id => tx('readonly', st => st.get(id)),
    all: () => tx('readonly', st => st.getAll()),
    clear: () => tx('readwrite', st => st.clear()),
  };
}

let _dbp = null;
function openDB() {
  if (_dbp) return _dbp;
  _dbp = new Promise((res, rej) => {
    let req;
    try { req = indexedDB.open('forddiag', 2); } catch (e) { rej(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('scans')) {
        const st = db.createObjectStore('scans', { keyPath: 'id', autoIncrement: true });
        st.createIndex('vin', 'vin'); st.createIndex('ts', 'ts');
      }
      if (!db.objectStoreNames.contains('service')) {
        const st = db.createObjectStore('service', { keyPath: 'id', autoIncrement: true });
        st.createIndex('vin', 'vin');
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { _dbp = null; rej(req.error); };
  });
  return _dbp;
}

const HistoryDB = makeStore(openDB, 'scans');
const ServiceDB = makeStore(openDB, 'service');

/** Rezumat coduri dintr-o scanare (pentru comparație) */
function scanCodes(scan) {
  const set = new Map();
  if (scan.dtcs) for (const k of ['stored', 'pending', 'permanent']) for (const d of scan.dtcs[k] || []) set.set('PCM:' + d.code, { src: 'Motor', code: d.code });
  for (const m of Object.values(scan.modules || {})) for (const d of m.dtcs || []) set.set((m.mod.id || m.mod) + ':' + d.code, { src: m.mod.id || m.mod, code: d.code });
  return set;
}
function compareScans(older, newer) {
  const a = scanCodes(older), b = scanCodes(newer);
  return {
    resolved: [...a.keys()].filter(k => !b.has(k)).map(k => a.get(k)),
    added: [...b.keys()].filter(k => !a.has(k)).map(k => b.get(k)),
    persistent: [...b.keys()].filter(k => a.has(k)).map(k => b.get(k)),
  };
}

window.HistoryDB = HistoryDB;
window.ServiceDB = ServiceDB;
window.compareScans = compareScans;
window.scanCodes = scanCodes;
