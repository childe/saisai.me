/** 选择题难度：选项数在 4 / 6 / 10 之间按连对数升降。纯函数。 */

export const LEVELS = [4, 6, 10];
export const STREAK_TO_LEVEL_UP = 5;

export function initialState() {
  return { levelIndex: 0, streak: 0 };
}

export function optionCount(state) {
  return LEVELS[state.levelIndex];
}

export function nextState(state, correct) {
  if (!correct) {
    return { levelIndex: Math.max(0, state.levelIndex - 1), streak: 0 };
  }
  const streak = state.streak + 1;
  if (streak >= STREAK_TO_LEVEL_UP) {
    if (state.levelIndex < LEVELS.length - 1) {
      return { levelIndex: state.levelIndex + 1, streak: 0 };
    }
    // 已经顶格，没得升了。连对计数就停在门槛上，别涨成「连对 7/5」。
    return { levelIndex: state.levelIndex, streak: STREAK_TO_LEVEL_UP };
  }
  return { levelIndex: state.levelIndex, streak };
}
