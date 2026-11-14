// 难度自动调整：自己做模式下，连续 UP_AFTER 道题一次做对就升一级；
// 连续 DOWN_AFTER 道题错得多（错 ≥ 2 次）就建议降一级，由孩子决定。

export const UP_AFTER = 3;
export const DOWN_AFTER = 2;
export const MAX_LEVEL = 5;

export const initialProgress = (level = 2) => ({ level, streak: 0, struggles: 0 });

// mistakes：这道题选错步骤、答错、用提示的总次数
export function record(p, mistakes) {
  if (mistakes === 0) {
    const streak = p.streak + 1;
    if (streak >= UP_AFTER && p.level < MAX_LEVEL) {
      return { progress: { level: p.level + 1, streak: 0, struggles: 0 }, event: 'up' };
    }
    return { progress: { ...p, streak, struggles: 0 }, event: null };
  }
  const struggles = mistakes >= 2 ? p.struggles + 1 : 0;
  if (struggles >= DOWN_AFTER && p.level > 1) {
    return { progress: { ...p, streak: 0, struggles: 0 }, event: 'suggestDown' };
  }
  return { progress: { ...p, streak: 0, struggles }, event: null };
}
