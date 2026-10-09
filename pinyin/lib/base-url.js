/**
 * 决定音频从哪里取。纯函数。
 *
 * 默认用 manifest 里的 OSS 地址。但 OSS 的跨域规则只放行 saisai.me，
 * 而本页所有音频都走 fetch（跟读要拿 PCM，绕不过 CORS），所以在
 * localhost 或局域网 HTTPS 上自测时取不到音频 —— 连拼音表都不出声。
 *
 * `?audio=local` 改从同源的 audio/ 目录取；`?audio=<地址>` 用指定地址。
 */
export function resolveBaseUrl(manifestBaseUrl, search) {
  const raw = new URLSearchParams(search).get('audio');
  if (!raw) return manifestBaseUrl;
  const base = raw === 'local' ? 'audio' : raw;
  return base.endsWith('/') ? base : base + '/';
}
