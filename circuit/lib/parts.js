// 元件目录：端点、端点本地网格坐标、参数定义、物理常数。

export const PHYS = Object.freeze({
  V_CELL: 1.5,
  R_CELL: 0.1,
  R_WIRE: 1e-3,
  R_CLOSED: 1e-3,
  GMIN: 1e-9,
  LAMP_R: 10,
  LAMP_P_RATED: 0.9,
  LAMP_BURN_P: 1.8,
  LAMP_LIT_P: 0.045,
  HOLD_S: 0.6,
  SHORT_A: 3,
  LED_IS: 1e-12,
  LED_VN: 0.0869,
  LED_BURN_A: 0.030,
  LED_LIT_A: 0.001,
  MOTOR_R: 5,
  BUZZER_R: 50,
  RHEO_R: 50,
  AMMETER_R: 0.01,
  VOLTMETER_R: 1e7,
});

export const PART_TYPES = Object.freeze([
  'battery', 'lamp', 'switch', 'led', 'resistor', 'motor',
  'buzzer', 'rheostat', 'spdt', 'ammeter', 'voltmeter', 'fuse',
]);

const two = (t0, t1) => ({ terms: [t0, t1], termPos: { [t0]: [-2, 0], [t1]: [2, 0] } });

export const PARTS = Object.freeze({
  battery: { label: '电池', ...two('p', 'n'), params: { cells: { default: 1, options: [1, 2, 3, 4] } }, lever: false },
  lamp: { label: '小灯泡', ...two('a', 'b'), params: {}, lever: false },
  switch: { label: '开关', ...two('a', 'b'), params: { closed: { default: false, options: [false, true] } }, lever: true },
  led: { label: 'LED', ...two('a', 'k'), params: { color: { default: 'red', options: ['red', 'green', 'blue', 'yellow'] } }, lever: false },
  resistor: { label: '电阻', ...two('a', 'b'), params: { ohms: { default: 220, options: [10, 47, 100, 220, 470, 1000] } }, lever: false },
  motor: { label: '小风扇', ...two('a', 'b'), params: {}, lever: false },
  buzzer: { label: '蜂鸣器', ...two('p', 'n'), params: {}, lever: false },
  rheostat: {
    label: '滑动变阻器', terms: ['a', 'b', 'w'], termPos: { a: [-2, 0], b: [2, 0], w: [0, -2] },
    params: { pos: { default: 0.5, min: 0, max: 1 } }, lever: false,
  },
  spdt: {
    label: '单刀双掷开关', terms: ['c', 'a', 'b'], termPos: { c: [-2, 0], a: [2, -1], b: [2, 1] },
    params: { to: { default: 'a', options: ['a', 'b'] } }, lever: true,
  },
  ammeter: { label: '电流表', ...two('p', 'n'), params: {}, lever: false },
  voltmeter: { label: '电压表', ...two('p', 'n'), params: {}, lever: false },
  fuse: { label: '保险丝', ...two('a', 'b'), params: { rating: { default: 1, options: [0.5, 1, 2] } }, lever: false },
});

export function defaultParams(type) {
  const def = PARTS[type];
  if (!def) return {};
  const out = {};
  for (const [k, d] of Object.entries(def.params)) out[k] = d.default;
  return out;
}

export function isValidParam(type, key, value) {
  const def = PARTS[type]?.params?.[key];
  if (!def) return false;
  if (def.options) return def.options.includes(value);
  return typeof value === 'number' && Number.isFinite(value) && value >= def.min && value <= def.max;
}
