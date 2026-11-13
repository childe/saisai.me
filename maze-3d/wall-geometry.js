// 墙几何的面分组重排与 UV 缩放。只处理数组，不依赖 three.js。
// BoxGeometry 的面顺序为 px、nx、py、ny、pz、nz；第 f 个面占顶点 4f..4f+3、索引 6f..6f+5。

const TOP_FACE = 2; // py

// 新索引：px、nx、ny、pz、nz 的 6 个索引在前（墙面材质），py 在最后（墙顶材质）
export function wallGroupLayout(index) {
  const out = [];
  for (const f of [0, 1, 3, 4, 5, TOP_FACE]) {
    for (let i = 0; i < 6; i++) out.push(index[f * 6 + i]);
  }
  return {
    index: out,
    groups: [
      { start: 0, count: 30, materialIndex: 0 },
      { start: 30, count: 6, materialIndex: 1 },
    ],
  };
}

// 让纹理在各个面上按世界尺寸铺开，不被拉伸
export function wallUvScale(face, dims = { w: 1.1, h: 0.8, d: 0.1 }) {
  if (face === 0 || face === 1) return [dims.d / dims.w, 1];
  if (face === 2 || face === 3) return [1, dims.d / dims.h];
  return [1, 1];
}

export function applyWallUvs(uv, dims) {
  for (let f = 0; f < 6; f++) {
    const [su, sv] = wallUvScale(f, dims);
    for (let v = 0; v < 4; v++) {
      const i = (f * 4 + v) * 2;
      uv[i] *= su;
      uv[i + 1] *= sv;
    }
  }
}
