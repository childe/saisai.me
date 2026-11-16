// 键盘快捷键过滤：在文字输入框里打字时，退格、Cmd+Z 交给输入框；滑块不算输入框。
export function isTextEntry(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && el.type !== 'range';
}
