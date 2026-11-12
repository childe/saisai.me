// 稠密高斯消元（部分主元）。不修改入参。

export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (!(Math.abs(M[piv][col]) >= 1e-18)) return null;
    if (piv !== col) [M[piv], M[col]] = [M[col], M[piv]];
    const pr = M[col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / pr[col];
      if (f === 0) continue;
      const row = M[r];
      for (let k = col; k <= n; k++) row[k] -= f * pr[k];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
    if (!Number.isFinite(x[i])) return null;
  }
  return x;
}
