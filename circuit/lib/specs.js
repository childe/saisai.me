// 元件说明：选中元件时面板里的规格（内阻、工作条件、损坏条件、可调参数）和实时电压电流。
import { PHYS } from './parts.js';

const trim = x => String(Number(x.toPrecision(3)));

export function formatOhms(r) {
  if (r >= 1e6) return `${trim(r / 1e6)}MΩ`;
  if (r >= 1000) return `${trim(r / 1000)}kΩ`;
  return `${trim(r)}Ω`;
}

const mA = a => `${trim(a * 1000)}mA`;

// 电流不到 1A 用 mA，和规格里的写法一致。
export function formatCurrent(i) {
  if (!Number.isFinite(i)) return '--';
  const a = Math.abs(i);
  if (a < 1e-4) return '0mA';
  if (a < 1) return `${i < 0 ? '-' : ''}${(a * 1000).toFixed(a < 0.01 ? 1 : 0)}mA`;
  return `${i.toFixed(2)}A`;
}

export function formatVoltage(v) {
  if (!Number.isFinite(v)) return '--';
  const s = v.toFixed(2);
  return `${s === '-0.00' ? '0.00' : s}V`;
}

// 功率一律用 W，和灯的规格写法一致；不到 0.1W 多留一位小数。电池是放电，显示大小不带符号。
export function formatPower(p) {
  if (!Number.isFinite(p)) return '--';
  const a = Math.abs(p);
  if (a < 5e-4) return '0W';
  return `${a.toFixed(a < 0.1 ? 3 : 2)}W`;
}

// LED 两端电压：电流 i 时的正向压降。
const ledV = i => PHYS.LED_VN * Math.log(i / PHYS.LED_IS + 1);
const hold = `持续 ${PHYS.HOLD_S} 秒`;
const closedR = `接通时 ${formatOhms(PHYS.R_CLOSED)}`;

// 每类元件的规格：[[标题, 内容], ...]。没有的项不写。
const SPECS = {
  battery: p => [
    ['电压', `每节 ${PHYS.V_CELL}V，现在 ${p.params.cells} 节共 ${trim(p.params.cells * PHYS.V_CELL)}V`],
    ['内阻', `每节 ${formatOhms(PHYS.R_CELL)}，现在共 ${formatOhms(p.params.cells * PHYS.R_CELL)}`],
    ['报警', `电流超过 ${PHYS.SHORT_A}A ${hold}，说明短路了`],
    ['可调', '节数 1–4 节'],
  ],
  lamp: () => [
    ['电阻', formatOhms(PHYS.LAMP_R)],
    ['工作', `功率到 ${PHYS.LAMP_LIT_P}W 开始亮，${PHYS.LAMP_P_RATED}W 是正常亮度`],
    ['损坏', `功率超过 ${PHYS.LAMP_BURN_P}W ${hold}会烧断`],
  ],
  led: () => [
    ['电阻', `不固定：只能单向导电，导通时两端约 ${ledV(PHYS.LED_LIT_A).toFixed(1)}–${ledV(PHYS.LED_BURN_A).toFixed(1)}V`],
    ['工作', `电流从 a 端流向 k 端，到 ${mA(PHYS.LED_LIT_A)} 开始亮`],
    ['损坏', `电流超过 ${mA(PHYS.LED_BURN_A)} 立刻烧坏`],
    ['可调', '颜色（只改变样子）'],
  ],
  resistor: p => [
    ['电阻', formatOhms(p.params.ohms)],
    ['可调', '阻值 10Ω–1kΩ'],
  ],
  rheostat: () => [
    ['电阻', `a、b 之间 ${formatOhms(PHYS.RHEO_R)}，滑片把它分成两段：a 到滑片是 滑片位置 × ${formatOhms(PHYS.RHEO_R)}`],
    ['可调', '滑片位置'],
  ],
  motor: () => [
    ['电阻', formatOhms(PHYS.MOTOR_R)],
    ['工作', '两端电压到 0.5V 就转，电流反过来就反着转'],
  ],
  buzzer: () => [
    ['电阻', formatOhms(PHYS.BUZZER_R)],
    ['工作', `p 端接正极一侧、电流到 1mA 才响；到 30mA 最响`],
  ],
  switch: () => [['电阻', `${closedR}，断开时不导电`], ['可调', '断开 / 闭合']],
  button: () => [['电阻', `按住时 ${formatOhms(PHYS.R_CLOSED)}，松开不导电`]],
  spdt: () => [['电阻', `c 和拨到的一端之间 ${formatOhms(PHYS.R_CLOSED)}，另一端不通`], ['可调', '拨到 a / b']],
  dpdt: () => [['电阻', `两组各自 c 和拨到的一端之间 ${formatOhms(PHYS.R_CLOSED)}，另一端不通`], ['可调', '拨到 a / b，两组一起动']],
  ammeter: () => [['电阻', formatOhms(PHYS.AMMETER_R)], ['工作', '串联在电路里，读数是流过它的电流']],
  voltmeter: () => [['电阻', formatOhms(PHYS.VOLTMETER_R)], ['工作', '并联在元件两端，读数是两端电压']],
  fuse: p => [
    ['电阻', formatOhms(PHYS.R_CLOSED)],
    ['损坏', `电流超过 ${p.params.rating}A 立刻熔断`],
    ['可调', '额定电流 0.5A / 1A / 2A'],
  ],
  relay: () => [
    ['电阻', `线圈 x、y 之间 ${formatOhms(PHYS.RELAY_R)}；触点${closedR}`],
    ['工作', `线圈电流到 ${mA(PHYS.RELAY_PULL_A)} 吸合（com 接 no），降到 ${mA(PHYS.RELAY_RELEASE_A)} 以下松开（com 接 nc），动作要 ${PHYS.RELAY_DELAY} 秒`],
  ],
  display: () => [
    ['电阻', `每个输入端到 g 之间 ${formatOhms(PHYS.DISPLAY_R)}`],
    ['工作', `输入端比 g 高 ${PHYS.DISPLAY_ON_V}V 以上算接通，显示接通的 1、2、4、8 加起来的数`],
  ],
  capacitor: p => [
    ['电阻', '不让电流一直流过：充满后电流就停了'],
    ['工作', `两端到 ${PHYS.CAP_FULL_V}V 电量条显示满；容量越大，充满越慢`],
    ['可调', `容量 0.1F / 0.5F / 1F，现在 ${p.params.farads}F`],
  ],
};

export function specRows(part) {
  return SPECS[part.type]?.(part) ?? [];
}

// 标题后面的实时读数「电压 电流 功率」；数字显示器、连接点没有。继电器读的是线圈。
export function readingText(part, reading, ok) {
  if (part.type === 'display' || part.type === 'node') return null;
  if (!ok || !reading) return '--';
  return `${formatVoltage(reading.v)} ${formatCurrent(reading.i)} ${formatPower(reading.p)}`;
}
