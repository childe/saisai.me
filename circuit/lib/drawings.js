// 每种元件两种画法（实物卡通 / 标准符号）的 SVG 片段。本地坐标：SVG 单位，端点在 termPos × GRID。
import { PARTS } from './parts.js';
import { GRID, LEVER_RECT, rotatePoint } from './geometry.js';
import { resistorBands } from './viewmodel.js';

const INK = '#3a2e25';
const n = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const line = (x1, y1, x2, y2, extra = '') =>
  `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${INK}" stroke-width="4" stroke-linecap="round"${extra}/>`;

function terms(part) {
  const def = PARTS[part.type];
  return def.terms.map(t => {
    const [x, y] = def.termPos[t];
    return `<circle class="term" data-term="${t}" cx="${x * GRID}" cy="${y * GRID}" r="7"/>`;
  }).join('');
}

// 从端点画到元件本体的引线。
function leads(part, inset = 52) {
  const def = PARTS[part.type];
  return def.terms.map(t => {
    const [x, y] = def.termPos[t];
    const X = x * GRID, Y = y * GRID;
    if (y === 0) return line(X, 0, Math.sign(X) * inset, 0);
    return '';
  }).join('');
}

// 拨片按钮：画在 rect × GRID 内（默认 LEVER_RECT，元件可用 leverRect 换位置）。
function lever(on, symbol, R = LEVER_RECT) {
  const cx = ((R.x0 + R.x1) / 2) * GRID, cy = ((R.y0 + R.y1) / 2) * GRID;
  const r = Math.min((R.x1 - R.x0), (R.y1 - R.y0)) * GRID / 2 - 4;
  const fill = on ? '#4caf50' : '#e5533d';
  const knob = symbol
    ? `<circle cx="${cx}" cy="${n(cy)}" r="${n(r * 0.75)}" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="${cx}" cy="${n(cy)}" r="${n(r * 0.35)}" fill="${fill}"/>`
    : `<circle cx="${cx}" cy="${n(cy)}" r="${n(r)}" fill="${fill}" stroke="${INK}" stroke-width="3"/><circle cx="${n(cx - r * 0.3)}" cy="${n(cy - r * 0.3)}" r="${n(r * 0.25)}" fill="#fff" opacity="0.6"/>`;
  return `<g class="lever"><rect x="${n(R.x0 * GRID)}" y="${n(R.y0 * GRID)}" width="${n((R.x1 - R.x0) * GRID)}" height="${n((R.y1 - R.y0) * GRID)}" fill="transparent"/>${knob}</g>`;
}

const glowCircle = (cx, cy, base, glow, color = '#ffd84d') =>
  `<circle class="glow" cx="${n(cx)}" cy="${n(cy)}" r="${n(base + glow * 28)}" fill="${color}" opacity="${n(Math.min(0.9, 0.25 + glow * 0.3) * 100) / 100}"/>`;

const LED_COLORS = { red: '#ff4b3e', green: '#3ccf5a', blue: '#3c8bff', yellow: '#ffd23c' };

const DRAW = {
  // 连接点：一个实心圆点，本身就是端点（不再叠白色端点圆）。
  node(part, style) {
    return style === 'cartoon'
      ? `<circle class="node-dot" data-term="o" cx="0" cy="0" r="7" fill="#b87333" stroke="${INK}" stroke-width="2"/>`
      : `<circle class="node-dot" data-term="o" cx="0" cy="0" r="5" fill="${INK}"/>`;
  },
  battery(part, style, vis) {
    const cells = part.params.cells;
    let body = '';
    if (style === 'cartoon') {
      const w = 112 / cells;
      for (let k = 0; k < cells; k++) {
        const x = -56 + k * w;
        body += `<rect x="${n(x + 2)}" y="-18" width="${n(w - 4)}" height="36" rx="5" fill="${vis.alarm ? '#ff6b5b' : '#f2b134'}" stroke="${INK}" stroke-width="3"/>`;
        body += `<rect x="${n(x - 2)}" y="-7" width="5" height="14" fill="${INK}"/>`;
        body += `<rect x="${n(x + w * 0.55)}" y="-18" width="${n(w * 0.4)}" height="36" fill="${INK}" opacity="0.18"/>`;
      }
      body = line(-80, 0, -58, 0) + line(80, 0, 56, 0) + body;
      body += `<text x="-66" y="-24" class="pol">+</text><text x="62" y="-24" class="pol">−</text>`;
    } else {
      const gap = 16, total = (cells - 1) * gap;
      body += line(-80, 0, -total / 2 - 4, 0) + line(80, 0, total / 2 + 10, 0);
      for (let k = 0; k < cells; k++) {
        const x = -total / 2 + k * gap;
        body += `<line x1="${n(x - 4)}" y1="-20" x2="${n(x - 4)}" y2="20" stroke="${vis.alarm ? '#d62d20' : INK}" stroke-width="3"/>`;
        body += `<line x1="${n(x + 6)}" y1="-10" x2="${n(x + 6)}" y2="10" stroke="${vis.alarm ? '#d62d20' : INK}" stroke-width="7"/>`;
      }
      body += `<text x="0" y="-28" text-anchor="middle" class="label">${cells}×1.5V</text>`;
      body += `<text x="-66" y="-12" class="pol">+</text>`;
    }
    if (vis.alarm) {
      body = `<g class="alarm">${body}<g class="bubble"><rect x="-50" y="-78" width="100" height="30" rx="14" fill="#fff" stroke="#d62d20" stroke-width="3"/><text x="0" y="-57" text-anchor="middle" fill="#d62d20" font-weight="bold">短路啦！</text></g></g>`;
    }
    return body;
  },

  lamp(part, style, vis) {
    const burnt = vis.burnt;
    const glow = !burnt && vis.glow > 0 ? glowCircle(0, style === 'cartoon' ? -6 : 0, 20, vis.glow) : '';
    let body;
    if (style === 'cartoon') {
      body = line(-80, 0, -14, 0) + line(80, 0, 14, 0) + glow +
        `<rect x="-14" y="6" width="28" height="18" rx="3" fill="#b9b2a6" stroke="${INK}" stroke-width="3"/>` +
        `<circle cx="0" cy="-12" r="22" fill="${burnt ? '#a8a29a' : vis.glow > 0 ? '#fff4b0' : '#f4f1ea'}" stroke="${INK}" stroke-width="3" opacity="0.95"/>` +
        (burnt
          ? `<path d="M-8 6 L-6 -12 L-1 -16 M3 -14 L6 -12 L8 6" fill="none" stroke="${INK}" stroke-width="2"/>`
          : `<path d="M-8 6 L-6 -12 Q0 -22 6 -12 L8 6" fill="none" stroke="${INK}" stroke-width="2"/>`);
    } else {
      body = line(-80, 0, -20, 0) + line(80, 0, 20, 0) + glow +
        `<circle cx="0" cy="0" r="20" fill="${burnt ? '#c9c4bc' : '#fff'}" stroke="${INK}" stroke-width="3"/>` +
        (burnt ? line(-14, -14, -3, -3) + line(14, 14, 3, 3) : line(-14, -14, 14, 14) + line(-14, 14, 14, -14));
    }
    return burnt ? `<g class="burnt">${body}</g>` : body;
  },

  switch(part, style) {
    const on = part.params.closed;
    const end = on ? [40, 0] : [30, -26];
    if (style === 'cartoon') {
      return `<rect x="-60" y="-14" width="120" height="28" rx="8" fill="#d9c7a7" stroke="${INK}" stroke-width="3"/>` +
        line(-80, 0, -40, 0) + line(80, 0, 40, 0) +
        `<circle cx="-40" cy="0" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/><circle cx="40" cy="0" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>` +
        `<line x1="-40" y1="0" x2="${end[0]}" y2="${end[1]}" stroke="#8a8f99" stroke-width="7" stroke-linecap="round"/>` +
        lever(on, false);
    }
    return line(-80, 0, -36, 0) + line(80, 0, 36, 0) +
      `<circle cx="-36" cy="0" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="36" cy="0" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      line(-32, 0, end[0] - 4, end[1]) + lever(on, true);
  },

  spdt(part, style) {
    const toA = part.params.to === 'a';
    const end = toA ? [36, -38] : [36, 38];
    const contacts = line(80, -40, 40, -40) + line(80, 40, 40, 40);
    if (style === 'cartoon') {
      return `<rect x="-60" y="-50" width="112" height="100" rx="10" fill="#d9c7a7" stroke="${INK}" stroke-width="3" opacity="0.85"/>` +
        line(-80, 0, -40, 0) + contacts +
        `<circle cx="-40" cy="0" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>` +
        `<circle cx="40" cy="-40" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/><circle cx="40" cy="40" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>` +
        `<line x1="-40" y1="0" x2="${end[0]}" y2="${end[1]}" stroke="#8a8f99" stroke-width="7" stroke-linecap="round"/>` +
        `<text x="54" y="-46" class="label">a</text><text x="54" y="60" class="label">b</text>` +
        lever(toA, false);
    }
    return line(-80, 0, -36, 0) + contacts +
      `<circle cx="-36" cy="0" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<circle cx="40" cy="-40" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="40" cy="40" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      line(-32, 0, end[0], end[1]) + lever(toA, true);
  },

  led(part, style, vis) {
    const color = LED_COLORS[part.params.color] ?? LED_COLORS.red;
    const burnt = vis.burnt;
    const fill = burnt ? '#2a2420' : color;
    const glow = !burnt && vis.glow > 0 ? glowCircle(0, style === 'cartoon' ? -8 : 0, 14, vis.glow, color) : '';
    const smoke = burnt ? `<path class="smoke" d="M0 -30 q-10 -10 0 -20 q10 -10 0 -20" fill="none" stroke="#9a948c" stroke-width="4" stroke-linecap="round" opacity="0.7"/>` : '';
    let body;
    if (style === 'cartoon') {
      body = line(-80, 0, -10, 0) + line(80, 0, 10, 0) + line(-10, 0, -10, 10) + line(10, 0, 10, 14) + glow +
        `<path d="M-16 10 L-16 -10 A16 16 0 0 1 16 -10 L16 10 Z" fill="${fill}" stroke="${INK}" stroke-width="3" opacity="0.92"/>` +
        `<rect x="-20" y="8" width="40" height="6" rx="2" fill="${fill}" stroke="${INK}" stroke-width="2"/>` +
        `<text x="-34" y="-6" class="pol">+</text>` + smoke;
    } else {
      body = line(-80, 0, -14, 0) + line(80, 0, 14, 0) + glow +
        `<path d="M-14 -16 L-14 16 L14 0 Z" fill="${fill}" stroke="${INK}" stroke-width="3"/>` + line(14, -16, 14, 16) +
        `<path d="M4 -20 L14 -32 M10 -32 L14 -32 L14 -28 M14 -16 L24 -28 M20 -28 L24 -28 L24 -24" fill="none" stroke="${INK}" stroke-width="2"/>` + smoke;
    }
    return burnt ? `<g class="burnt">${body}</g>` : body;
  },

  resistor(part, style) {
    if (style === 'cartoon') {
      const bands = resistorBands(part.params.ohms);
      return line(-80, 0, -40, 0) + line(80, 0, 40, 0) +
        `<rect x="-42" y="-14" width="84" height="28" rx="12" fill="#e8d3a8" stroke="${INK}" stroke-width="3"/>` +
        bands.map((c, k) => `<rect x="${-26 + k * 14}" y="-14" width="8" height="28" fill="${c}"/>`).join('') +
        `<rect x="22" y="-14" width="6" height="28" fill="#c9a24a"/>` +
        `<text x="0" y="34" text-anchor="middle" class="label">${part.params.ohms >= 1000 ? `${part.params.ohms / 1000}kΩ` : `${part.params.ohms}Ω`}</text>`;
    }
    return line(-80, 0, -36, 0) + line(80, 0, 36, 0) +
      `<rect x="-36" y="-12" width="72" height="24" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<text x="0" y="34" text-anchor="middle" class="label">${part.params.ohms >= 1000 ? `${part.params.ohms / 1000}kΩ` : `${part.params.ohms}Ω`}</text>`;
  },

  motor(part, style) {
    if (style === 'cartoon') {
      const blade = a => `<ellipse cx="0" cy="-12" rx="7" ry="13" fill="#7cc4f0" stroke="${INK}" stroke-width="2" transform="rotate(${a})"/>`;
      return line(-80, 0, -26, 0) + line(80, 0, 26, 0) +
        `<circle cx="0" cy="0" r="26" fill="#f4f1ea" stroke="${INK}" stroke-width="3"/>` +
        `<g class="fan">${blade(0)}${blade(120)}${blade(240)}<circle cx="0" cy="0" r="5" fill="${INK}"/></g>`;
    }
    return line(-80, 0, -22, 0) + line(80, 0, 22, 0) +
      `<circle cx="0" cy="0" r="22" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<g class="fan"><path d="M0 -15 A15 15 0 0 1 13 7" fill="none" stroke="${INK}" stroke-width="1.5" opacity="0.4"/></g>` +
      `<text x="0" y="7" text-anchor="middle" class="sym">M</text>`;
  },

  buzzer(part, style, vis) {
    const waves = vis.volume > 0
      ? `<path class="waves" d="M24 -26 q8 8 0 16 M32 -32 q12 14 0 28" fill="none" stroke="${INK}" stroke-width="2" opacity="${n(0.3 + vis.volume * 0.7)}"/>`
      : '';
    if (style === 'cartoon') {
      return line(-80, 0, -22, 0) + line(80, 0, 22, 0) +
        `<circle cx="0" cy="0" r="22" fill="#33302c" stroke="${INK}" stroke-width="3"/><circle cx="0" cy="0" r="5" fill="#777"/>` +
        `<text x="-36" y="-8" class="pol">+</text>` + waves;
    }
    return line(-80, 0, -14, 0) + line(80, 0, 14, 0) + line(-14, 0, -14, 10) + line(14, 0, 14, 10) +
      `<path d="M-22 10 A22 22 0 0 1 22 10 Z" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<text x="-36" y="-8" class="pol">+</text>` + waves;
  },

  rheostat(part, style) {
    const sx = -50 + 100 * part.params.pos;
    const wiper = line(0, -80, 0, -42) + line(0, -42, sx, -42) +
      `<path d="M${n(sx)} -40 L${n(sx)} -18" stroke="${INK}" stroke-width="3"/>` +
      `<path d="M${n(sx - 7)} -26 L${n(sx)} -16 L${n(sx + 7)} -26 Z" fill="${INK}"/>`;
    if (style === 'cartoon') {
      return line(-80, 0, -56, 0) + line(80, 0, 56, 0) +
        `<rect x="-56" y="-14" width="112" height="28" rx="6" fill="#d9c7a7" stroke="${INK}" stroke-width="3"/>` +
        `<path d="M-48 -8 ${Array.from({ length: 12 }, (_, k) => `L${-44 + k * 8} ${k % 2 ? -8 : 8}`).join(' ')}" fill="none" stroke="#b07a32" stroke-width="2"/>` +
        wiper + `<rect x="${n(sx - 10)}" y="-50" width="20" height="14" rx="4" fill="#4c9be8" stroke="${INK}" stroke-width="2"/>`;
    }
    return line(-80, 0, -50, 0) + line(80, 0, 50, 0) +
      `<rect x="-50" y="-12" width="100" height="24" fill="#fff" stroke="${INK}" stroke-width="3"/>` + wiper;
  },

  ammeter(part, style, vis) { return meter('A', style, vis); },
  voltmeter(part, style, vis) { return meter('V', style, vis); },

  fuse(part, style, vis) {
    const burnt = vis.burnt;
    const wire = burnt
      ? `<path d="M-30 0 L-8 -4 M8 4 L30 0" stroke="#7a3b1c" stroke-width="2"/>`
      : `<path d="M-30 0 Q-15 -6 0 0 T30 0" fill="none" stroke="#7a3b1c" stroke-width="2"/>`;
    let body;
    if (style === 'cartoon') {
      body = line(-80, 0, -46, 0) + line(80, 0, 46, 0) +
        `<rect x="-36" y="-12" width="72" height="24" rx="10" fill="#e9f6fb" stroke="${INK}" stroke-width="3" opacity="0.9"/>` +
        `<rect x="-46" y="-14" width="14" height="28" rx="3" fill="#c0c4cb" stroke="${INK}" stroke-width="2"/>` +
        `<rect x="32" y="-14" width="14" height="28" rx="3" fill="#c0c4cb" stroke="${INK}" stroke-width="2"/>` + wire +
        `<text x="0" y="34" text-anchor="middle" class="label">${part.params.rating}A</text>`;
    } else {
      body = line(-80, 0, -32, 0) + line(80, 0, 32, 0) +
        `<rect x="-32" y="-10" width="64" height="20" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
        (burnt ? line(-32, 0, -8, 0) + line(8, 0, 32, 0) : line(-32, 0, 32, 0)) +
        `<text x="0" y="34" text-anchor="middle" class="label">${part.params.rating}A</text>`;
    }
    return burnt ? `<g class="burnt">${body}</g>` : body;
  },

  // 继电器：左边线圈，右边一组单刀双掷触点（动片绕右侧支点转），虚线表示铁片带动动片。
  // 吸合（vis.on）时铁片贴向线圈，动片接常开（no）；释放时动片接常闭（nc）。
  relay(part, style, vis) {
    const on = !!vis.on;
    const arm = on ? [-26, -24] : [-8, -28];
    const blade = on ? [26, -36] : [26, 36];
    const link = `<line x1="${n((arm[0] - 20) / 2)}" y1="${n((arm[1] + 30) / 2)}" x2="${n((blade[0] + 60) / 2)}" y2="${n(blade[1] / 2)}" stroke="${INK}" stroke-width="2" stroke-dasharray="6 5"/>`;
    const coilLeads = line(-80, -40, -40, -40) + line(-40, -40, -40, -24) + line(-80, 40, -40, 40) + line(-40, 40, -40, 24);
    const contactLeads = line(80, 0, 60, 0) + line(80, -40, 24, -40) + line(80, 40, 24, 40);
    // 常开、常闭标签放在端点外侧（引线伸出的方向），中心对准端点轴线；
    // 竖放时在端点正下方（相邻继电器之间错开一格），横放时在端点右侧。字始终正向（见 upright）。
    const lx = part.rot % 2 ? 98 : 104;
    const labels = `<text x="${lx}" y="-35" text-anchor="middle" class="label">常开</text><text x="${lx}" y="45" text-anchor="middle" class="label">常闭</text>`;
    if (style === 'cartoon') {
      return `<rect x="-64" y="-54" width="128" height="108" rx="10" fill="#d9c7a7" stroke="${INK}" stroke-width="3" opacity="0.85"/>` +
        coilLeads + contactLeads +
        `<rect x="-45" y="-30" width="10" height="60" fill="#9aa0a8" stroke="${INK}" stroke-width="2"/>` +
        `<rect x="-54" y="-22" width="28" height="44" rx="4" fill="#d0843c" stroke="${INK}" stroke-width="3"/>` +
        [-12, -4, 4, 12].map(y => `<line x1="-54" y1="${y}" x2="-26" y2="${y}" stroke="#a35f22" stroke-width="2"/>`).join('') +
        `<line x1="-20" y1="30" x2="${arm[0]}" y2="${arm[1]}" stroke="#8a8f99" stroke-width="7" stroke-linecap="round"/>` +
        `<circle cx="-20" cy="30" r="5" fill="${INK}"/>` + link +
        `<circle cx="24" cy="-40" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/><circle cx="24" cy="40" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>` +
        `<line x1="60" y1="0" x2="${blade[0]}" y2="${blade[1]}" stroke="#8a8f99" stroke-width="7" stroke-linecap="round"/>` +
        `<circle cx="60" cy="0" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>` + labels;
    }
    return coilLeads + contactLeads +
      `<rect x="-50" y="-24" width="20" height="48" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      line(-20, 30, arm[0], arm[1]) + link +
      `<circle cx="24" cy="-40" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="24" cy="40" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<circle cx="60" cy="0" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      line(56, 0, blade[0] + 2, blade[1]) + labels;
  },

  // 按钮：按钮帽画在拨片区（class="lever"），按下时帽和连接片一起往下，连接片碰到两个触点。
  button(part, style) {
    const on = !!part.params.pressed;
    const bar = on ? -6 : -18;
    const capY = on ? -46 : -60;
    const area = `<rect x="${LEVER_RECT.x0 * GRID}" y="${LEVER_RECT.y0 * GRID}" width="${(LEVER_RECT.x1 - LEVER_RECT.x0) * GRID}" height="${(LEVER_RECT.y1 - LEVER_RECT.y0) * GRID}" fill="transparent"/>`;
    const fill = on ? '#4caf50' : '#e5533d';
    if (style === 'cartoon') {
      return `<rect x="-60" y="-4" width="120" height="22" rx="8" fill="#d9c7a7" stroke="${INK}" stroke-width="3"/>` +
        line(-80, 0, -40, 0) + line(80, 0, 40, 0) +
        `<circle cx="-40" cy="0" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/><circle cx="40" cy="0" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>` +
        `<line x1="0" y1="${bar}" x2="0" y2="${capY + 14}" stroke="#8a8f99" stroke-width="6"/>` +
        `<line x1="-46" y1="${bar}" x2="46" y2="${bar}" stroke="#8a8f99" stroke-width="7" stroke-linecap="round"/>` +
        `<g class="lever">${area}<rect x="-20" y="${capY}" width="40" height="16" rx="6" fill="${fill}" stroke="${INK}" stroke-width="3"/>` +
        `<rect x="-14" y="${capY + 3}" width="12" height="4" rx="2" fill="#fff" opacity="0.6"/></g>`;
    }
    return line(-80, 0, -36, 0) + line(80, 0, 36, 0) +
      `<circle cx="-36" cy="0" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/><circle cx="36" cy="0" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      line(-40, bar, 40, bar) + `<line x1="0" y1="${bar}" x2="0" y2="${capY + 8}" stroke="${INK}" stroke-width="2" stroke-dasharray="5 4"/>` +
      `<g class="lever">${area}<rect x="-16" y="${capY}" width="32" height="10" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      `<circle cx="0" cy="${capY + 5}" r="3" fill="${fill}"/></g>`;
  },

  // 双刀双掷：两组单刀双掷触点上下排列，中间虚线连杆，两片动片同时转到 a 或 b。
  // 拨片画在两组触点中间（leverRect），压在连杆上，不挡动片。
  dpdt(part, style) {
    const toA = part.params.to === 'a';
    const ends = toA ? [[36, -78], [36, 40]] : [[36, -40], [36, 78]];
    const link = `<line x1="0" y1="${n((-40 + ends[0][1]) / 2)}" x2="0" y2="${n((40 + ends[1][1]) / 2)}" stroke="${INK}" stroke-width="2" stroke-dasharray="6 5"/>`;
    const contacts = [-80, -40, 40, 80].map(y => line(80, y, 40, y)).join('');
    const poles = line(-80, -40, -40, -40) + line(-80, 40, -40, 40);
    if (style === 'cartoon') {
      const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="6" fill="#c9a24a" stroke="${INK}" stroke-width="2"/>`;
      const blade = ([x, y], cy) => `<line x1="-40" y1="${cy}" x2="${x}" y2="${y}" stroke="#8a8f99" stroke-width="7" stroke-linecap="round"/>`;
      return `<rect x="-60" y="-92" width="112" height="184" rx="10" fill="#d9c7a7" stroke="${INK}" stroke-width="3" opacity="0.85"/>` +
        poles + contacts + dot(-40, -40) + dot(-40, 40) + [-80, -40, 40, 80].map(y => dot(40, y)).join('') +
        blade(ends[0], -40) + blade(ends[1], 40) + link +
        `<text x="54" y="-86" class="label">a</text><text x="54" y="-24" class="label">b</text>` +
        `<text x="54" y="34" class="label">a</text><text x="54" y="96" class="label">b</text>` +
        lever(toA, false, PARTS.dpdt.leverRect);
    }
    const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${INK}" stroke-width="3"/>`;
    return poles + contacts + dot(-36, -40) + dot(-36, 40) + [-80, -40, 40, 80].map(y => dot(40, y)).join('') +
      line(-32, -40, ends[0][0], ends[0][1]) + line(-32, 40, ends[1][0], ends[1][1]) + link + lever(toA, true, PARTS.dpdt.leverRect);
  },

  // 数字显示器：屏上两个暗的「8」打底，上面叠当前数字（右对齐，0–15）；输入端旁标权重 1、2、4、8。
  display(part, style, vis) {
    const s = String(vis.text ?? '-').slice(-2); // 屏上两位（元件栏小图传的是 '--'）
    const cells = [[-14, s.length > 1 ? s[0] : ''], [14, s[s.length - 1]]];
    const ins = [[-80, 1], [-40, 2], [0, 4], [40, 8]];
    const leads = ins.map(([y]) => line(-80, y, -44, y)).join('') + line(0, 80, 0, 58);
    const marks = ins.map(([y, w]) => `<text x="-70" y="${y - 8}" class="label">${w}</text>`).join('');
    const digit = (fg, ghost) => cells.map(([x, ch]) =>
      `<text class="ghost" x="${x}" y="-8" text-anchor="middle" style="fill:${ghost}">8</text>` +
      `<text class="digit" x="${x}" y="-8" text-anchor="middle" style="fill:${fg}">${esc(ch)}</text>`).join('');
    if (style === 'cartoon') {
      return leads + `<rect x="-44" y="-92" width="88" height="150" rx="10" fill="#33302c" stroke="${INK}" stroke-width="3"/>` +
        `<rect x="-32" y="-78" width="64" height="108" rx="5" fill="#1d1a17" stroke="#5a524a" stroke-width="2"/>` +
        digit('#ff4b3e', 'rgba(255,75,62,0.14)') + `<circle cx="0" cy="44" r="4" fill="#777"/>` + marks;
    }
    return leads + `<rect x="-44" y="-92" width="88" height="150" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
      digit(INK, 'rgba(58,46,37,0.1)') + marks;
  },
};

function meter(letter, style, vis) {
  const text = esc(vis.text ?? '--');
  if (style === 'cartoon') {
    return line(-80, 0, -56, 0) + line(80, 0, 56, 0) +
      `<rect x="-56" y="-24" width="112" height="48" rx="10" fill="#fff8ec" stroke="${INK}" stroke-width="3"/>` +
      `<rect x="-46" y="-16" width="92" height="32" rx="5" fill="#d8f0d0" stroke="${INK}" stroke-width="1.5"/>` +
      `<text x="-62" y="-30" class="label">${letter}</text>` +
      `<text class="reading" x="0" y="7" text-anchor="middle">${text}</text>` +
      `<text x="-70" y="-8" class="pol">+</text>`;
  }
  return line(-80, 0, -22, 0) + line(80, 0, 22, 0) +
    `<circle cx="0" cy="0" r="22" fill="#fff" stroke="${INK}" stroke-width="3"/>` +
    `<text x="0" y="8" text-anchor="middle" class="sym">${letter}</text>` +
    `<text class="reading" x="0" y="42" text-anchor="middle">${text}</text>` +
    `<text x="-36" y="-8" class="pol">+</text>`;
}

export function drawPart(part, style, visual) {
  const draw = DRAW[part.type];
  if (!draw) return '';
  const ends = part.type === 'node' ? '' : terms(part);
  return `<g class="part-art ${style}">${upright(draw(part, style, visual) + tagLabel(part), part.rot)}${ends}</g>`;
}

// 开关、继电器带 tag 时画出名字（预置电路里的 A、B、C、A1…），让孩子分得清谁是谁。
// 字画在本地坐标里，由 upright 转回正向。开关放在本体旁（本地 (0,32)，不压导线）；
// 继电器放在板面上本体正上方、两个线圈端点之间（本地坐标按 rot 反转），避开下方的常开常闭标签。
export function tagLabelAt(part) {
  return part.type === 'relay' ? rotatePoint([0, -76], -part.rot) : [0, 32];
}
function tagLabel(part) {
  if (!part.tag || (part.type !== 'switch' && part.type !== 'relay')) return '';
  const [x, y] = tagLabelAt(part);
  return `<text x="${n(x)}" y="${n(y + 6)}" text-anchor="middle" class="label tag">${esc(part.tag)}</text>`;
}

// 文字基线到字形中心的大致偏移（约 0.35em），按 styles.css 里的字号。
const TEXT_MID = { label: 5, pol: 6, sym: 8, reading: 6, digit: 21, ghost: 21 };
const BUBBLE_RE = /<g class="bubble">[\s\S]*?<\/g>/;

// 元件整体随 rot 旋转；文字绕自己的字形中心转回来保持正向；
// 报警气泡整体绕元件中心转回来，始终在元件上方。
function upright(svg, rot) {
  const deg = -((rot % 4) * 90);
  if (!deg) return svg;
  const bubble = svg.match(BUBBLE_RE)?.[0];
  const odd = rot % 2 === 1;
  const body = svg.replace(BUBBLE_RE, '\u0000').replace(/<text\b[^>]*>([^<]*)/g, (el, content) => {
    const tag = el.slice(0, el.length - content.length);
    const x = Number(tag.match(/\bx="([-\d.]+)"/)?.[1] ?? 0), y = Number(tag.match(/\by="([-\d.]+)"/)?.[1] ?? 0);
    const mid = TEXT_MID[tag.match(/\bclass="(\w+)"/)?.[1]] ?? 6;
    const middle = /text-anchor="middle"/.test(tag);
    const cx = middle ? x : x + mid;
    let cy = y - mid;
    // 竖放时，元件上下方的长文字会横着压到元件本体上：沿离开中心的方向再推开半个字宽。
    const push = middle && odd && Math.abs(cy) > Math.abs(cx) ? Math.max(0, content.length * mid * 0.85 - mid) : 0;
    const dy = Math.sign(cy) * push;
    cy += dy;
    const move = dy ? `translate(0 ${n(dy)}) ` : '';
    return tag.replace(/>$/, ` transform="${move}rotate(${deg} ${n(cx)} ${n(cy - dy)})">`) + content;
  });
  // 竖放时元件上下各伸出约 2 格，气泡再往上挪一格多。
  const lift = odd ? ' translate(0 -50)' : '';
  return bubble ? body.replace('\u0000', `<g transform="rotate(${deg})${lift}">${bubble}</g>`) : body;
}
