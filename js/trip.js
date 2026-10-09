/* =====================================================================
 * trip.js — Computer de bord (consum, distanță) și cronometru performanță
 * ===================================================================== */
'use strict';

const AFR = { benzina: 14.7, diesel: 14.5 };
const DENSITY = { benzina: 745, diesel: 835 };   // g/L

class TripComputer {
  constructor(fuel = 'benzina') { this.fuel = fuel; this.reset(); }
  reset() {
    this.t0 = null; this.last = null; this.dist = 0; this.fuelL = 0; this.moving = 0;
    this.maxSpeed = 0; this.idle = 0; this.instL100 = null; this.instLh = null;
  }
  /** s = { t (ms), speed (km/h), maf (g/s)|null, fuelRate (L/h)|null, rpm } */
  update(s) {
    if (this.t0 == null) this.t0 = s.t;
    // consum instantaneu: PID 5E dacă există; altfel MAF (doar benzină, buclă stoichiometrică)
    let lh = null;
    if (s.fuelRate != null) lh = s.fuelRate;
    else if (s.maf != null && this.fuel === 'benzina') lh = s.maf * 3600 / (AFR.benzina * DENSITY.benzina);
    this.instLh = lh;
    this.instL100 = lh != null && s.speed > 3 ? lh / s.speed * 100 : null;
    if (this.last) {
      const dt = (s.t - this.last.t) / 1000;
      if (dt > 0 && dt < 10) {
        const v = (s.speed + this.last.speed) / 2;
        this.dist += v * dt / 3600;
        if (lh != null) this.fuelL += lh * dt / 3600;
        if (v > 1) this.moving += dt; else if (s.rpm > 300) this.idle += dt;
      }
    }
    this.maxSpeed = Math.max(this.maxSpeed, s.speed);
    this.last = s;
  }
  get elapsed() { return this.last && this.t0 != null ? (this.last.t - this.t0) / 1000 : 0; }
  get avgSpeed() { return this.moving > 0 ? this.dist / (this.moving / 3600) : 0; }
  get avgL100() { return this.dist > 0.2 && this.fuelL > 0 ? this.fuelL / this.dist * 100 : null; }
}

/* Cronometru accelerare: așteaptă viteza de start, măsoară până la viteza țintă.
 * Interpolare liniară între eșantioane pentru precizie (rata ELM ~5–20 Hz). */
class PerfTimer {
  constructor(from, to) { this.from = from; this.to = to; this.state = 'armat'; this.prev = null; this.tStart = null; this.result = null; this.trace = []; }
  update(t, v) {
    const p = this.prev; this.prev = { t, v };
    if (this.state === 'armat') {
      if (this.from === 0) { if (v < 1) this.state = 'gata'; }
      else if (v < this.from - 3) this.state = 'gata';
      return this.state;
    }
    if (this.state === 'gata') {
      if (this.from === 0 && v >= 1 && p) { this.tStart = p.t + (t - p.t) * ((0.5 - p.v) / Math.max(0.01, v - p.v)); this.state = 'măsurare'; }
      else if (this.from > 0 && p && p.v < this.from && v >= this.from) { this.tStart = p.t + (t - p.t) * ((this.from - p.v) / Math.max(0.01, v - p.v)); this.state = 'măsurare'; }
      if (this.from === 0 && v < 1) this.trace = [];
      return this.state;
    }
    if (this.state === 'măsurare') {
      this.trace.push({ t: t - this.tStart, v });
      if (v >= this.to && p) {
        const tEnd = p.t + (t - p.t) * ((this.to - p.v) / Math.max(0.01, v - p.v));
        this.result = (tEnd - this.tStart) / 1000; this.state = 'terminat';
      } else if (p && v < p.v - 5) { this.state = 'gata'; this.trace = []; }   // abandon (frânare)
    }
    return this.state;
  }
}

window.TripComputer = TripComputer;
window.PerfTimer = PerfTimer;
