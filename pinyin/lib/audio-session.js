/**
 * 把 iOS 的音频会话设成 playback。
 *
 * 两件事都靠它：
 *
 * 1. **绕开静音键。** 默认的会话类型下，Web Audio 会被侧边静音拨片
 *    静掉，手机调成静音就什么都听不见。
 * 2. **用过麦克风之后抢回扬声器。** `getUserMedia()` 会把会话切成
 *    play-and-record，这时输出从扬声器改走**听筒**，音量极小 ——
 *    听上去就是"没声音"。停掉音轨并不会自动切回来，必须显式设回去。
 *
 * 所以这个函数要在播放前、以及释放麦克风之后都调一次。幂等，调多少次都行。
 * iOS 16.4+ 支持；不支持的浏览器返回 false，调用方不用管。
 */
export function setPlayback() {
  try {
    if (!navigator.audioSession) return false;
    navigator.audioSession.type = 'playback';
    return true;
  } catch (_) {
    return false;
  }
}

/** 当前会话类型，不支持就返回 null。诊断条用它来暴露听筒路由问题。 */
export function sessionType() {
  try {
    return navigator.audioSession ? navigator.audioSession.type : null;
  } catch (_) {
    return null;
  }
}
