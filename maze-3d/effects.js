// 3D 迷宫的画面效果：开局朝向、遮挡判断、终点方向提示、阴影 / 暗边 / 光柱 / 彩带的数据步进。
// 纯逻辑，不依赖 three.js 和 DOM，可以直接用 node --test 测试。角度与坐标约定见 movement.js。

// ---------- 开局朝向 ----------
// 从起点格中心 (0.5, 0.5) 指向迷宫中心 (size/2, size/2) 的 yaw
export function startYaw(size) {
  const dx = size / 2 - 0.5;
  const dz = size / 2 - 0.5;
  return Math.atan2(dx, -dz);
}
