// 求解结果 → 视觉参数（光晕、转速、音量、电流点速度、读数文字、色环）。
import { PHYS } from './parts.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fin = v => (Number.isFinite(v) ? v : 0);

export function formatReading(x, unit) {
  if (!Number.isFinite(x)) return '--';
  let s = x.toFixed(2);
  if (s === '-0.00') s = '0.00';
  return `${s} ${unit}`;
}

export function partVisual(part, reading, damage, ok) {
  const burnt = !!damage?.broken?.[part.id];
  const alarm = !!damage?.alarm?.[part.id];
  const vis = { glow: 0, burnt, alarm, spin: 0, volume: 0, text: null, stale: !ok };
  const isMeter = part.type === 'ammeter' || part.type === 'voltmeter';
  if (!ok || !reading) {
    if (isMeter) vis.text = '--';
    return vis;
  }
  const v = fin(reading.v), i = fin(reading.i), p = fin(reading.p);
  switch (part.type) {
    case 'lamp':
      vis.glow = burnt || p < PHYS.LAMP_LIT_P ? 0 : clamp(p / PHYS.LAMP_P_RATED, 0, 2);
      break;
    case 'led':
      vis.glow = burnt || i < PHYS.LED_LIT_A ? 0 : clamp(i / 0.02, 0, 1.5);
      break;
    case 'motor':
      vis.spin = v;
      break;
    case 'buzzer':
      vis.volume = v > 0 && i >= 0.001 ? clamp(i / 0.03, 0, 1) : 0;
      break;
    case 'ammeter':
      vis.text = formatReading(reading.i, 'A');
      break;
    case 'voltmeter':
      vis.text = formatReading(reading.v, 'V');
      break;
    default:
  }
  return vis;
}

export function wireFlow(reading, ok) {
  if (!ok || !reading || !Number.isFinite(reading.i) || Math.abs(reading.i) < 0.001) return null;
  return { speed: clamp(Math.abs(reading.i) * 200, 20, 400), dir: reading.i > 0 ? 1 : -1 };
}

const BAND_COLORS = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];

export function resistorBands(ohms) {
  let mult = 0;
  let n = Math.round(ohms);
  while (n >= 100) { n = Math.round(n / 10); mult++; }
  if (n < 10) return [BAND_COLORS[0], BAND_COLORS[n], BAND_COLORS[0]];
  return [BAND_COLORS[Math.floor(n / 10)], BAND_COLORS[n % 10], BAND_COLORS[mult]];
}
