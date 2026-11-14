export const SOL6 = '123456456123231564564231312645645312';
// 对角线 6 格挖空（每行只空一格，唯一解）
export const PUZ6 = '.234564.612323.564564.313126.564531.';
export const HOLES6 = [0, 7, 14, 21, 28, 35];

// 空 9×9 盘上按 [row, col, digit] 放数字，返回 values 数组
export function board9(placed) {
  const v = Array(81).fill(0);
  for (const [r, c, d] of placed) v[r * 9 + c] = d;
  return v;
}
