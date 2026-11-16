import test from 'node:test';
import assert from 'node:assert/strict';
import { specRows, readingText, formatOhms, formatCurrent, formatVoltage } from '../lib/specs.js';
import { PART_TYPES, defaultParams } from '../lib/parts.js';

const part = (type, params = {}) => ({ id: 'X', type, params: { ...defaultParams(type), ...params } });
const row = (type, label, params) => specRows(part(type, params)).find(([l]) => l === label)?.[1];

test('formatters', () => {
  assert.equal(formatOhms(0.001), '0.001Ω');
  assert.equal(formatOhms(220), '220Ω');
  assert.equal(formatOhms(1000), '1kΩ');
  assert.equal(formatOhms(1e7), '10MΩ');
  assert.equal(formatCurrent(0.0213), '21mA');
  assert.equal(formatCurrent(0.0012), '1.2mA');
  assert.equal(formatCurrent(-0.29), '-290mA');
  assert.equal(formatCurrent(1.5), '1.50A');
  assert.equal(formatCurrent(1e-9), '0mA');
  assert.equal(formatVoltage(-0.001), '0.00V');
  assert.equal(formatVoltage(1.4706), '1.47V');
  assert.equal(formatCurrent(NaN), '--');
});

test('every part type has a resistance row', () => {
  for (const t of PART_TYPES) assert.ok(row(t, '电阻') ?? row(t, '内阻'), t);
});

test('specs follow params and constants', () => {
  assert.equal(row('resistor', '电阻', { ohms: 470 }), '470Ω');
  assert.match(row('battery', '内阻', { cells: 3 }), /共 0\.3Ω/);
  assert.match(row('battery', '电压', { cells: 2 }), /共 3V/);
  assert.match(row('led', '损坏'), /30mA/);
  assert.match(row('led', '电阻'), /1\.8–2\.1V/);
  assert.match(row('lamp', '损坏'), /1\.8W 持续 0\.6 秒/);
  assert.match(row('fuse', '损坏', { rating: 2 }), /超过 2A/);
  assert.match(row('rheostat', '电阻'), /50Ω/);
  assert.match(row('relay', '工作'), /20mA 吸合.*10mA 以下松开/);
  assert.equal(row('motor', '损坏'), undefined);
  assert.equal(row('lamp', '可调'), undefined);
});

test('readingText', () => {
  assert.equal(readingText(part('lamp'), { v: 2.91, i: 0.291 }, true), '2.91V 291mA');
  assert.equal(readingText(part('relay'), { v: 1.5, i: 0.05 }, true), '1.50V 50mA');
  assert.equal(readingText(part('lamp'), undefined, false), '--');
  assert.equal(readingText(part('display'), { v: 0, i: 0 }, true), null);
});
