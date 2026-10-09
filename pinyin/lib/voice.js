/**
 * 音色选择。纯函数。
 *
 * 音频按 <baseUrl><voice>/<key> 存放，所以换音色只是换 URL 前缀，
 * 数据本身（key、声调、干扰项）和音色无关。
 *
 * 换音色不影响跟读打分：所有音色都经过同一套换调，调型是一样的。
 */

/**
 * 决定用哪个音色。优先级：?voice= > 存下来的 > 数据里的默认 > 表里第一个。
 * 任何一级给出表里没有的值，都退回默认 —— 以后删音色时，老浏览器里
 * 存的旧值不能让页面放不出声。
 */
export function pickVoice(data, saved, search) {
  const list = data.voices;
  if (!Array.isArray(list) || list.length === 0) return '';
  const ids = list.map((v) => v.id);
  const fallback = ids.includes(data.defaultVoice) ? data.defaultVoice : ids[0];

  const asked = new URLSearchParams(search).get('voice');
  if (asked) return ids.includes(asked) ? asked : fallback;
  return ids.includes(saved) ? saved : fallback;
}

/** 把音色拼进音频地址前缀。 */
export function voiceBaseUrl(baseUrl, voice) {
  const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  return voice ? base + voice + '/' : base;
}
