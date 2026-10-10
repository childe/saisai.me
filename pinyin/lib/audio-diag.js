/**
 * 音频诊断条的文案。
 *
 * 平时什么都不显示；一旦上下文没跑起来、输出链路降级、或者捕获到错误，
 * 就把实情摆到页面上 —— iPhone 上没法看控制台，之前就是因为错误被
 * 静默吞掉，全哑了还查不出所以然。`?debug=1` 则无论如何都显示。
 *
 * @param {{state: string, degraded: boolean, error: ?string}} d
 * @param {boolean} debug
 * @returns {?string} 要显示的文字；null 表示不显示
 */
export function formatDiag(d, debug) {
  // '未创建' 不算异常：iOS 本来就要等用户手势之后才允许建上下文，
  // 打开页面就报红是误报。
  const bad = d.degraded || !!d.error || (d.state !== 'running' && d.state !== '未创建');
  if (!bad && !debug) return null;
  const parts = ['音频：' + d.state];
  if (d.degraded) parts.push('已降级（直连喇叭，没有增益）');
  if (d.error) parts.push(d.error);
  return parts.join(' · ');
}
