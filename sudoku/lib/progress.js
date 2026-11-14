// localStorage wrapper for sudoku progress: stars and instant check setting
// All reads/writes must be wrapped in try/catch since storage may be undefined or throw

const STARS_KEY = 'sudoku.stars.v1';
const INSTANT_CHECK_KEY = 'sudoku.instantCheck';

// Resolve storage inside try to catch SecurityError when reading globalThis.localStorage
const getStorage = s => s ?? globalThis.localStorage;

/**
 * Load stars from storage.
 * Keys are formatted as `${chapterId}-${slotIndex}`, values are 1, 2, or 3.
 * Falls back to empty object on error or invalid JSON.
 * @param {Storage} storage - defaults to globalThis.localStorage
 * @returns {Record<string, 1|2|3>}
 */
export function loadStars(storage) {
  try {
    const s = getStorage(storage);
    const json = s.getItem(STARS_KEY);
    if (!json) return {};
    const parsed = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Save a star rating only if it's higher than the existing one.
 * @param {string} chapterId
 * @param {number} slotIndex
 * @param {1|2|3} stars
 * @param {Storage} storage - defaults to globalThis.localStorage
 */
export function saveStars(chapterId, slotIndex, stars, storage) {
  try {
    const s = getStorage(storage);
    const key = `${chapterId}-${slotIndex}`;
    const current = loadStars(storage);
    const existing = current[key] ?? 0;
    if (stars > existing) {
      current[key] = stars;
      s.setItem(STARS_KEY, JSON.stringify(current));
    }
  } catch {
    // Silently ignore errors
  }
}

/**
 * Load the "instant check" setting.
 * Defaults to true if not found or on error.
 * @param {Storage} storage - defaults to globalThis.localStorage
 * @returns {boolean}
 */
export function loadInstantCheck(storage) {
  try {
    const s = getStorage(storage);
    const value = s.getItem(INSTANT_CHECK_KEY);
    if (value === null) return true;
    return value !== '0';
  } catch {
    return true;
  }
}

/**
 * Save the "instant check" setting.
 * Stored as '1' (on) or '0' (off).
 * @param {boolean} on
 * @param {Storage} storage - defaults to globalThis.localStorage
 */
export function saveInstantCheck(on, storage) {
  try {
    const s = getStorage(storage);
    s.setItem(INSTANT_CHECK_KEY, on ? '1' : '0');
  } catch {
    // Silently ignore errors
  }
}
