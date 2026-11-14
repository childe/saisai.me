// token 列表 → HTML。mark（new / cancel）变成 mk-new / mk-cancel，给动画用。

const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

function one(t) {
  const mk = t.mark ? ' ' + t.mark.split(' ').map(m => `mk-${m}`).join(' ') : '';
  switch (t.t) {
    case 'n': return `<span class="n${mk}">${esc(t.v)}</span>`;
    case 'x': return `<i class="x${mk}">x</i>`;
    case 'sign': return `<span class="sign${mk}">−</span>`;
    case 'op': return `<span class="op${mk}">${esc(t.v)}</span>`;
    case '(': return `<span class="p${mk}">(</span>`;
    case ')': return `<span class="p${mk}">)</span>`;
    case 'frac': return `<span class="frac${mk}"><span class="fn">${tokensHtml(t.num)}</span><span class="fd">${tokensHtml(t.den)}</span></span>`;
    default: return '';
  }
}

export const tokensHtml = toks => toks.map(one).join('');
