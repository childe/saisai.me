// 小任务总表：各章关卡按游玩顺序拼接（章文件里的数组顺序），另有判定入口和元件栏余量。id 只是稳定标识。
import { CH1 } from './tasks/ch1-parts.js';
import { CH2 } from './tasks/ch2-series.js';
import { CH3 } from './tasks/ch3-meters.js';
import { CH3_FAULTS } from './tasks/ch3-faults.js';
import { CH4 } from './tasks/ch4-mixed.js';
import { CH5 } from './tasks/ch5-spdt.js';
import { CH6 } from './tasks/ch6-logic.js';
import { CH7 } from './tasks/ch7-capacitor.js';

export { lampLit, ledLit, withParams } from './task-kit.js';

export const CHAPTERS = [
  { n: 1, name: '认识元件' }, { n: 2, name: '串联与并联' }, { n: 3, name: '电表' }, { n: 4, name: '混联' },
  { n: 5, name: '单刀双掷开关' }, { n: 6, name: '逻辑与加法器' }, { n: 7, name: '电容与定时' },
];

export const TASKS = [...CH1, ...CH2, ...CH3, ...CH3_FAULTS, ...CH4, ...CH5, ...CH6, ...CH7];

// goal 可以是字符串，也可以是随变体变化的函数。
export const goalText = (task, variant) => (typeof task.goal === 'function' ? task.goal(variant) : task.goal);

// 本章第几关，从 1 起。
export const chapterIndex = task => TASKS.filter(t => t.chapter === task.chapter).indexOf(task) + 1;

export function evaluateTask(task, progress, ws) {
  if (!ws.result.ok) return { progress, passed: false, hint: null };
  return task.check(progress, ws);
}

export function remainingPalette(task, circuit) {
  const out = {};
  for (const [type, n] of Object.entries(task.palette)) {
    const used = circuit.parts.filter(p => p.type === type && !p.preset).length;
    out[type] = Math.max(0, n - used);
  }
  return out;
}
