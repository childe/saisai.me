/** 拼音表：声母每个一格；韵母每行一个基础韵母，右侧四格是四声。 */

function cell(item, bank) {
  const b = document.createElement('button');
  b.className = 'cell';

  const glyph = document.createElement('span');
  glyph.textContent = item.display;
  b.appendChild(glyph);

  if (item.readAs) {
    const s = document.createElement('small');
    s.textContent = item.readAs;
    b.appendChild(s);
  }

  b.addEventListener('click', async () => {
    b.classList.add('playing');
    try {
      await bank.play(item);
    } catch (_) {
      glyph.textContent = '✕';
      setTimeout(() => { glyph.textContent = item.display; }, 800);
    }
    b.classList.remove('playing');
  });
  return b;
}

function placeholder() {
  const b = document.createElement('button');
  b.className = 'cell';
  b.disabled = true;
  b.textContent = '·';
  return b;
}

function yunmuRow(base, tones, bank) {
  const row = document.createElement('div');
  row.className = 'ym-row';

  const label = document.createElement('div');
  label.className = 'ym-label';
  // 用数据里的无调字形。NFD 剥组合符会把 ǖ 剥成 u（连分音符一起去掉）。
  label.textContent = tones[0].baseDisplay || base;
  row.appendChild(label);

  for (let tone = 1; tone <= 4; tone++) {
    const it = tones.find((t) => t.tone === tone);
    row.appendChild(it ? cell(it, bank) : placeholder());
  }

  const all = document.createElement('button');
  all.className = 'cell play-all';
  all.textContent = '▶';
  all.setAttribute('aria-label', '连播四声');
  all.addEventListener('click', async () => {
    all.classList.add('playing');
    for (const it of tones) {
      try {
        await bank.play(it);
      } catch (_) {
        break;
      }
      await new Promise((r) => setTimeout(r, 180));
    }
    all.classList.remove('playing');
  });
  row.appendChild(all);
  return row;
}

export function mount(root, { data, bank }) {
  for (const group of data.groups) {
    const sec = document.createElement('section');
    sec.className = 'group';
    const h = document.createElement('h2');
    h.textContent = group.title;
    sec.appendChild(h);

    if (group.id === 'shengmu') {
      const grid = document.createElement('div');
      grid.className = 'sm-grid';
      for (const it of group.items) grid.appendChild(cell(it, bank));
      sec.appendChild(grid);
    } else {
      const byBase = new Map();
      for (const it of group.items) {
        if (!byBase.has(it.base)) byBase.set(it.base, []);
        byBase.get(it.base).push(it);
      }
      for (const [base, tones] of byBase) {
        sec.appendChild(yunmuRow(base, tones, bank));
      }
    }
    root.appendChild(sec);
  }
}
