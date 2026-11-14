"""3D 迷宫浏览器验收脚本。

用法：
    ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py [--only 1,10,12] [--write]

脚本在仓库根目录起 python3 -m http.server（只绑 127.0.0.1），用 Playwright 驱动
Chromium 逐项检查，打印 PASS / FAIL；任一项失败时退出码为 1。
--write 把本次全部结果覆盖写入 tests/browser/test-results.txt。
"""

import argparse
import base64
import datetime
import io
import json
import math
import os
import re
import socket
import subprocess
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
RESULTS = Path(__file__).resolve().parent / "test-results.txt"
SCRATCH = Path(
    os.environ.get(
        "MAZE3D_SCRATCH",
        "/private/tmp/claude-501/-Users-jialiu-Projects-saisai-me/"
        "c68dac78-6140-48cf-ba1a-0608ab19b363/scratchpad",
    )
)
S = 12345
SWIFTSHADER_ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
NO_WEBGL_ARGS = ["--disable-webgl", "--disable-3d-apis"]
PAGE = "/maze-3d/index.html"
KEYS = {
    "up": "ArrowUp",
    "down": "ArrowDown",
    "left": "ArrowLeft",
    "right": "ArrowRight",
}
WASD = {"up": "w", "down": "s", "left": "a", "right": "d"}
PW = None  # main() 中赋值，供需要设备描述的检查使用
BASELINE_ROOT = None  # --baseline-root：改动前代码的副本，供对比检查使用
SHOTS = Path(
    "/Users/jialiu/Projects/saisai.me/.xdev/20261114-103742-maze-3d-gameplay/screenshots"
)  # --shots 覆盖
DIRS = {"up": (-1, 0), "down": (1, 0), "left": (0, -1), "right": (0, 1)}


# ---------------------------------------------------------------- helpers


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server(root=ROOT):
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=str(root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return proc, base
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("http.server did not start")


def open_page(browser, url, **ctx_kwargs):
    """新建上下文打开页面，返回 (page, errors)；errors 收集 console error 与 pageerror。"""
    init_script = ctx_kwargs.pop("init_script", None)
    context = browser.new_context(**ctx_kwargs)
    if init_script:
        context.add_init_script(init_script)
    page = context.new_page()
    errors = []
    page.on(
        "console",
        lambda msg: (
            errors.append(f"console: {msg.text}") if msg.type == "error" else None
        ),
    )
    page.on("pageerror", lambda exc: errors.append(f"pageerror: {exc}"))
    page.goto(url)
    return page, errors


def wait_ready(page, timeout=10000):
    page.wait_for_function("() => window.__maze3d !== undefined", timeout=timeout)


def wait_idle(page, timeout=5000):
    wait_ready(page)
    page.wait_for_function("() => window.__maze3d.state === 'idle'", timeout=timeout)


def wait_settled(page, timeout=5000):
    page.wait_for_function(
        "() => ['idle', 'won'].includes(window.__maze3d.state)", timeout=timeout
    )


def m3(page, expr):
    return page.evaluate(f"() => window.__maze3d.{expr}")


def logic(page, expr, arg=None):
    """在页面里 import game-logic.js 后求值 expr（可用 L、M=__maze3d、arg）。"""
    return page.evaluate(
        "async ([expr, arg]) => {"
        " const L = await import('/maze-3d/game-logic.js');"
        " const M = window.__maze3d;"
        " return (new Function('L', 'M', 'arg', 'return (' + expr + ');'))(L, M, arg);"
        "}",
        [expr, arg],
    )


def logic_themes(page, expr, arg=None):
    """在页面里 import game-logic.js 与 themes.js 后求值 expr（可用 L、T、M=__maze3d、arg）。"""
    return page.evaluate(
        "async ([expr, arg]) => {"
        " const L = await import('/maze-3d/game-logic.js');"
        " const T = await import('/maze-3d/themes.js');"
        " const M = window.__maze3d;"
        " return (new Function('L', 'T', 'M', 'arg', 'return (' + expr + ');'))(L, T, M, arg);"
        "}",
        [expr, arg],
    )


def pos(page):
    p = m3(page, "player")
    return {"row": p["row"], "col": p["col"]}


def path_dir(page, end=None):
    """沿最短路下一步的方向；已在终点返回 None。"""
    path = logic(
        page,
        "L.findPath(M.connections, M.player, arg || {row: M.size - 1, col: M.size - 1})",
        end,
    )
    if len(path) < 2:
        return None
    dr = path[1][0] - path[0][0]
    dc = path[1][1] - path[0][1]
    for name, (r, c) in DIRS.items():
        if (r, c) == (dr, dc):
            return name
    return None


DIR_YAW = {"up": 0.0, "right": math.pi / 2, "down": math.pi, "left": 3 * math.pi / 2}

WALK_JS = """async ([row, col, center, timeoutMs]) => {
  const L = await import('/maze-3d/game-logic.js');
  const M = window.__maze3d;
  return await new Promise((resolve) => {
    const t0 = performance.now();
    const done = (ok) => { M.setInputForTest(null); resolve(ok); };
    const tick = () => {
      if (M.state === 'won') return done(true);
      const cell = M.playerCell;
      const p = M.playerPos;
      const at = cell.row === row && cell.col === col;
      if (at && (!center || Math.hypot(p.x - col - 0.5, p.z - row - 0.5) < 0.1)) return done(true);
      if (performance.now() - t0 > timeoutMs) return done(false);
      let tr = row;
      let tc = col;
      if (!at) {
        const path = L.findPath(M.connections, cell, { row, col });
        if (path.length < 2) return done(false);
        [tr, tc] = path[1];
      }
      const tx = tc + 0.5;
      const tz = tr + 0.5;
      const dist = Math.hypot(tx - p.x, tz - p.z);
      const yaw = Math.atan2(tx - p.x, -(tz - p.z));
      // 最后一格要停在格心时减速，避免低帧率下绕着格心打转
      const forward = at && center ? Math.min(1, dist * 2.5) : 1;
      M.setInputForTest({ forward, strafe: 0, turn: 0, yaw });
      requestAnimationFrame(tick);
    };
    tick();
  });
}"""


def walk_to(page, row, col, center=True, timeout_ms=60000):
    """用 setInputForTest 沿 findPath 的格子路线走到 (row, col)；页面须带 &debug=1。

    center=True 时还要停到距格心 < 0.1。走向终点时一律传 center=False：
    一进终点格就判胜、速度清零，小人停在终点格边缘。返回「到达目标格或已胜利」。
    """
    ok = page.evaluate(WALK_JS, [row, col, center, timeout_ms])
    page.wait_for_timeout(200)
    return bool(ok)


def walk_to_exit(page):
    n = m3(page, "size")
    ok = walk_to(page, n - 1, n - 1, center=False)
    return ok and m3(page, "state") == "won"


def set_test_input(page, **kw):
    page.evaluate("(v) => window.__maze3d.setInputForTest(v)", kw or None)


def face_yaw(page, yaw):
    """把视角水平朝向设为 yaw，然后恢复真实输入。"""
    set_test_input(page, yaw=yaw)
    set_test_input(page)


def open_dir(page):
    """当前格第一个能走的方向名。"""
    return logic(
        page,
        "['down', 'right', 'up', 'left'].find((d) => {"
        " const [dr, dc] = L.DIRS[d]; const p = M.playerCell;"
        " return L.canMove(M.connections, p, { row: p.row + dr, col: p.col + dc }); })",
    )


def face_open(page):
    d = open_dir(page)
    face_yaw(page, DIR_YAW[d])
    return d


WALL_DIR_JS = """(() => {
  const p = arg || M.playerCell;
  return ['up', 'right', 'down', 'left'].find((d) => {
    const [dr, dc] = L.DIRS[d];
    const q = { row: p.row + dr, col: p.col + dc };
    const inside = q.row >= 0 && q.row < M.size && q.col >= 0 && q.col < M.size;
    return inside && !L.canMove(M.connections, p, q);
  }) || null;
})()"""


def wall_dir(page, cell=None):
    """当前格（或 cell）四个方向中第一个有内部墙段的方向名，没有返回 None。"""
    return logic(page, WALL_DIR_JS, cell)


def find_wall_cell(page):
    """从 (0,0) 按 BFS 找最近的有内部墙的格子，走到格心，返回墙的方向名。"""
    cell = logic(
        page,
        """(() => {
          const seen = new Set(['0,0']);
          const q = [{ row: 0, col: 0 }];
          for (let i = 0; i < q.length; i++) {
            const p = q[i];
            for (const [dr, dc] of Object.values(L.DIRS)) {
              const n = { row: p.row + dr, col: p.col + dc };
              const inside = n.row >= 0 && n.row < M.size && n.col >= 0 && n.col < M.size;
              if (inside && !L.canMove(M.connections, p, n)) return p;
              if (!L.canMove(M.connections, p, n) || seen.has(n.row + ',' + n.col)) continue;
              seen.add(n.row + ',' + n.col);
              q.push(n);
            }
          }
          return null;
        })()""",
    )
    if cell is None or not walk_to(page, cell["row"], cell["col"]):
        return None
    return wall_dir(page)


RECORD_JS = """([expr, ms]) => {
  window.__rec = { values: [], done: false };
  const t0 = performance.now();
  const tick = () => {
    window.__rec.values.push(window.__maze3d[expr]);
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else window.__rec.done = true;
  };
  requestAnimationFrame(tick);
}"""


def record_frames(page, expr, ms, during=None):
    """每帧记录 __maze3d[expr]，ms 毫秒后返回数组；during 在记录期间执行。"""
    page.evaluate(RECORD_JS, [expr, ms])
    if during:
        during()
    page.wait_for_function("() => window.__rec.done", timeout=ms + 10000)
    return page.evaluate("() => window.__rec.values")


def play_continuous(page, seconds=8):
    """按住 w，交替按住 / 松开 ArrowRight 各 1 秒；胜利就点「再来一局」并重新按下 w。
    返回点击「再来一局」的次数。"""
    page.keyboard.down("w")
    t0 = time.time()
    turning = False
    wins = 0
    try:
        while time.time() - t0 < seconds:
            if m3(page, "state") == "won":
                wins += 1
                page.click("#again-btn")
                wait_idle(page)
                page.keyboard.up("w")
                page.keyboard.down("w")
            if turning:
                page.keyboard.up("ArrowRight")
            else:
                page.keyboard.down("ArrowRight")
            turning = not turning
            page.wait_for_timeout(1000)
    finally:
        page.keyboard.up("ArrowRight")
        page.keyboard.up("w")
    return wins


def pos_of(page):
    return m3(page, "playerPos")


def moved(a, b, eps=1e-6):
    return math.hypot(a["x"] - b["x"], a["z"] - b["z"]) > eps


def cdp_touch(cdp, kind, points):
    cdp.send(
        "Input.dispatchTouchEvent",
        {
            "type": kind,
            "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in points.items()],
        },
    )


def stage_box(page):
    return box_of(page, "#stage")


def url_seed(page):
    return parse_qs(urlparse(page.url).query).get("seed", [None])[0]


def close(page):
    page.context.close()


def no_errors(errors):
    return (True, "") if not errors else (False, "errors: " + " | ".join(errors[:5]))


# ---------------------------------------------------------------- checks


def check_1(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}")
    try:
        wait_idle(page)
        page.wait_for_timeout(300)
        colors = m3(page, "sampleDistinctColors()")
        rev = m3(page, "threeRevision")
        ok_err, msg = no_errors(errors)
        ok = ok_err and colors >= 3 and rev == "187"
        return ok, f"colors={colors} revision={rev} {msg}".strip()
    finally:
        close(page)


def check_10(browser, base):
    nb = browser.browser_type.launch(args=NO_WEBGL_ARGS)
    try:
        page, errors = open_page(nb, f"{base}{PAGE}?seed={S}")
        page.wait_for_timeout(1000)
        visible = page.is_visible("#no-webgl")
        href = page.get_attribute("#no-webgl a", "href")
        pageerrors = [e for e in errors if e.startswith("pageerror")]
        ok = visible and href == "../maze-gen/maze.html" and not pageerrors
        return ok, f"no-webgl visible={visible} href={href} pageerrors={pageerrors}"
    finally:
        nb.close()


def check_12(browser, base):
    context = browser.new_context()
    page = context.new_page()
    blocked = []
    statuses = {}
    errors = []
    page.on("pageerror", lambda exc: errors.append(str(exc)))

    def route(r):
        host = urlparse(r.request.url).hostname
        if host != "127.0.0.1":
            blocked.append(r.request.url)
            r.abort()
        else:
            r.continue_()

    page.route("**/*", route)
    page.on("response", lambda resp: statuses.__setitem__(resp.url, resp.status))
    try:
        page.goto(f"{base}{PAGE}?seed={S}")
        wait_idle(page)
        page.wait_for_timeout(300)
        need = [
            "maze-3d/main.js",
            "maze-3d/maze-core.js",
            "maze-3d/game-logic.js",
            "maze-3d/vendor/three.module.js",
            "maze-3d/vendor/three.core.js",
        ]
        got = {n: statuses.get(f"{base}/{n}") for n in need}
        colors = m3(page, "sampleDistinctColors()")
        ok = all(v == 200 for v in got.values()) and not blocked and colors >= 3
        ok = ok and not errors
        return ok, f"responses={got} blocked={blocked} colors={colors} errors={errors}"
    finally:
        context.close()


def check_6(browser, base):
    """沿最短路走到终点出现恭喜提示；「再来一局」后回到起点格中心、朝迷宫中心、换新 seed。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        if not walk_to_exit(page):
            return (
                False,
                f"did not win, cell={m3(page, 'playerCell')} state={m3(page, 'state')}",
            )
        page.wait_for_timeout(100)
        win_visible = page.is_visible("#win")
        text = page.inner_text("#win")
        state = m3(page, "state")
        if not win_visible or "恭喜！你成功走出了迷宫！" not in text or state != "won":
            return False, f"win visible={win_visible} text={text!r} state={state}"
        seed_before = url_seed(page)
        gen = m3(page, "generation")
        page.click("#again-btn")
        wait_idle(page)
        page.wait_for_timeout(100)
        hidden = not page.is_visible("#win")
        gen2 = m3(page, "generation")
        cell = m3(page, "playerCell")
        p = pos_of(page)
        off = math.hypot(p["x"] - 0.5, p["z"] - 0.5)
        yaw = m3(page, "yaw")
        seed_after = url_seed(page)
        seed_m = str(m3(page, "seed"))
        ok = (
            hidden
            and gen2 == gen + 1
            and cell == {"row": 0, "col": 0}
            and off < 1e-6
            and abs(yaw - 3 * math.pi / 4) < 1e-9
            and seed_after != seed_before
            and seed_after == seed_m
        )
        ok_err, msg = no_errors(errors)
        return (
            ok and ok_err,
            (
                f"won; again: hidden={hidden} gen {gen}->{gen2} cell={cell} pos={p} yaw={yaw:.4f}"
                f" seed {seed_before}->{seed_after} (__maze3d.seed={seed_m}) {msg}"
            ).strip(),
        )
    finally:
        close(page)


def check_6b(browser, base):
    """胜利后按住 w：小人不动，状态仍为 won。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        if not walk_to_exit(page):
            return False, "did not win"
        before = pos_of(page)
        page.keyboard.down("w")
        page.wait_for_timeout(1000)
        after = pos_of(page)
        state = m3(page, "state")
        page.keyboard.up("w")
        ok = not moved(before, after) and state == "won"
        ok_err, msg = no_errors(errors)
        return (
            ok and ok_err,
            f"before={before} after={after} state={state} {msg}".strip(),
        )
    finally:
        close(page)


def check_7(browser, base):
    details = []
    for seed, size in [(S, 10), (S, 20), ("abc", 10)]:
        p2, _ = open_page(browser, f"{base}/maze-gen/maze.html?seed={seed}")
        try:
            p2.wait_for_timeout(300)
            two = p2.evaluate(
                "s => { setMazeSize(s); return JSON.stringify(currentConnections); }",
                size,
            )
        finally:
            close(p2)
        p3, _ = open_page(browser, f"{base}{PAGE}?seed={seed}&size={size}")
        try:
            wait_idle(p3)
            three = p3.evaluate("() => JSON.stringify(window.__maze3d.connections)")
        finally:
            close(p3)
        same = json.loads(two) == json.loads(three)
        details.append(f"seed={seed} size={size} equal={same}")
        if not same:
            return False, " ".join(details)
    return True, " ".join(details)


def check_13(browser, base):
    """生成器不能复现的 seed：页面不报错，换成新 seed 写回 URL，刷新后迷宫不变。"""
    details = []
    for bad in ["-1000", "0", "9" * 400, "1" + "0" * 308]:
        page, errors = open_page(browser, f"{base}{PAGE}?seed={bad}&size=10")
        try:
            wait_idle(page)
            seed_url = url_seed(page)
            seed_m = str(m3(page, "seed"))
            first = page.evaluate("() => JSON.stringify(window.__maze3d.connections)")
            page.reload()
            wait_idle(page)
            seed_reload = url_seed(page)
            again = page.evaluate("() => JSON.stringify(window.__maze3d.connections)")
            ok_err, msg = no_errors(errors)
            ok = (
                ok_err
                and seed_url != bad
                and seed_url == seed_m
                and int(seed_url) > 0
                and seed_reload == seed_url
                and first == again
            )
            details.append(
                f"seed={bad[:8]}->{seed_url} reload={seed_reload} same={first == again} {msg}".strip()
            )
            if not ok:
                return False, " ".join(details)
        finally:
            close(page)
    return True, " ".join(details)


REPEAT_KEYDOWN_JS = (
    "() => window.dispatchEvent(new KeyboardEvent('keydown',"
    " { code: 'KeyW', key: 'w', repeat: true }))"
)


def hold_still_with_repeats(page, ms=300):
    """按住 w 期间模拟实体键盘自动重复：每 50ms 再发一次 keydown（repeat=true）；返回期间的位置。"""
    seen = []
    t0 = time.time()
    while time.time() - t0 < ms / 1000:
        page.keyboard.down("w")  # 已按下的键再 down = repeat 事件
        page.evaluate(REPEAT_KEYDOWN_JS)
        seen.append(pos_of(page))
        page.wait_for_timeout(50)
    seen.append(pos_of(page))
    return seen


def check_11(browser, base):
    """按住方向键时重建迷宫、窗口失焦、切后台：按键集合清空，小人停下且不会自己继续走。"""
    details = []
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        # (a) 按住 w 时切换尺寸 / 重新生成
        for target, want_size in [("#size-15", 15), ("#regen-btn", 15)]:
            face_open(page)
            gen = m3(page, "generation")
            start = pos_of(page)
            page.keyboard.down("w")
            page.wait_for_timeout(300)
            walking = moved(start, pos_of(page))
            page.evaluate("(sel) => document.querySelector(sel).click()", target)
            seen = hold_still_with_repeats(page)
            still = all(
                abs(p["x"] - 0.5) < 1e-9 and abs(p["z"] - 0.5) < 1e-9 for p in seen
            )
            page.keyboard.up("w")
            face_open(page)
            page.keyboard.down("w")
            page.wait_for_timeout(300)
            page.keyboard.up("w")
            resumed = moved(seen[-1], pos_of(page))
            page.wait_for_timeout(200)
            ok = (
                walking
                and still
                and resumed
                and m3(page, "size") == want_size
                and m3(page, "generation") == gen + 1
                and m3(page, "state") == "idle"
            )
            details.append(
                f"a:{target} walking={walking} stillAfterRebuild={still} resumed={resumed} ok={ok}"
            )
            if not ok:
                return False, " ".join(details) + f" seen={seen[:3]}"
            page.click("#regen-btn")
            wait_idle(page)

        # (b) 按住 w 时窗口失焦
        face_open(page)
        start = pos_of(page)
        page.keyboard.down("w")
        page.wait_for_timeout(300)
        walking = moved(start, pos_of(page))
        page.evaluate("() => window.dispatchEvent(new Event('blur'))")
        page.wait_for_timeout(200)
        p1 = pos_of(page)
        page.wait_for_timeout(300)
        p2 = pos_of(page)
        page.keyboard.up("w")
        ok = walking and not moved(p1, p2)
        details.append(f"b:blur walking={walking} stopped={not moved(p1, p2)}")
        if not ok:
            return False, " ".join(details)

        # (c) 按住 w 时切后台再回来
        page.click("#regen-btn")
        wait_idle(page)
        face_open(page)
        start = pos_of(page)
        page.keyboard.down("w")
        page.wait_for_timeout(300)
        walking = moved(start, pos_of(page))
        page.evaluate(
            "() => { Object.defineProperty(document, 'visibilityState',"
            " { value: 'hidden', configurable: true });"
            " document.dispatchEvent(new Event('visibilitychange')); }"
        )
        page.wait_for_timeout(100)
        page.evaluate(
            "() => { Object.defineProperty(document, 'visibilityState',"
            " { value: 'visible', configurable: true });"
            " document.dispatchEvent(new Event('visibilitychange')); }"
        )
        page.wait_for_timeout(200)
        p1 = pos_of(page)
        page.wait_for_timeout(300)
        p2 = pos_of(page)
        page.keyboard.up("w")
        ok = walking and not moved(p1, p2)
        details.append(f"c:visibility walking={walking} stopped={not moved(p1, p2)}")
        if not ok:
            return False, " ".join(details)
        ok, msg = no_errors(errors)
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


# 按格算期望地板色（arg = 视野半径）：path > fogEdge / fog > start / end / floor；
# 求值时需要 L、T、M（用 logic_themes）
FLOOR_WANT_JS = """
  const t = T.THEMES[M.theme];
  const hex = (c) => '#' + c.toString(16).padStart(6, '0');
  const want = { floor: hex(t.floorBase), fog: hex(t.fogFloor),
    fogEdge: hex(T.mixHex(t.floorBase, t.fogFloor, 0.5)),
    start: '#4caf50', end: '#e53935', path: '#ffd740' };
  const wantKind = (cell, onPath) => L.floorKind(cell, M.size, {
    inView: !M.fog.on || L.isInFogView(M.display, cell, arg),
    onPath,
    edge: M.fog.on && L.fogRing(M.display, cell, arg),
  });
"""

FOG_STATE_JS = (
    """(() => {"""
    + FLOOR_WANT_JS
    + """
  const vis = M.wallsVisible();
  const wantWall = M.segments.map((s) => L.wallInView(s, M.display, arg));
  let wallMismatch = 0;
  for (let i = 0; i < wantWall.length; i++) if (vis[i] !== wantWall[i]) wallMismatch++;
  let floorMismatch = 0;
  let edgeCells = 0;
  for (let row = 0; row < M.size; row++)
    for (let col = 0; col < M.size; col++) {
      const kind = wantKind({ row, col }, false);
      if (kind === 'fogEdge') edgeCells++;
      if (M.floorColorHex(row, col) !== want[kind]) floorMismatch++;
    }
  return { wallMismatch, floorMismatch, edgeCells, walls: wantWall.length };
})()"""
)


def click_until_disabled(page, sel, limit=40):
    for _ in range(limit):
        if page.is_disabled(sel):
            return True
        page.click(sel)
    return page.is_disabled(sel)


def check_4(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=20&debug=1")
    details = []
    try:
        wait_idle(page)
        # (a) 默认迷雾
        fog = m3(page, "fog")
        r = logic_themes(page, FOG_STATE_JS, 5)
        ok = fog == {"on": True, "radius": 5} and r["wallMismatch"] == 0
        ok = ok and r["floorMismatch"] == 0 and r["edgeCells"] > 0
        details.append(f"a:fog={fog} {r}")
        if not ok:
            return False, " ".join(details)
        # (b) 视野调到 1 与 25
        click_until_disabled(page, "#fog-minus")
        text1 = page.inner_text("#fog-radius")
        r1 = m3(page, "fog")["radius"]
        click_until_disabled(page, "#fog-plus")
        r25 = m3(page, "fog")["radius"]
        ok = (
            text1 == "视野 1"
            and r1 == 1
            and r25 == 25
            and page.is_disabled("#fog-plus")
            and not page.is_disabled("#fog-minus")
        )
        details.append(f"b:min={r1}({text1}) max={r25}")
        if not ok:
            return False, " ".join(details)
        # (c) 关闭迷雾
        page.click("#fog-btn")
        btn = page.inner_text("#fog-btn")
        all_walls = page.evaluate("() => window.__maze3d.wallsVisible().every(Boolean)")
        dark = logic_themes(
            page,
            "(() => {" + FLOOR_WANT_JS + " let n = 0;"
            " for (let r = 0; r < M.size; r++) for (let c = 0; c < M.size; c++) {"
            " const h = M.floorColorHex(r, c); if (h === want.fog || h === want.fogEdge) n++; }"
            " return n; })()",
            m3(page, "fog")["radius"],
        )
        ok = btn == "迷雾：关" and all_walls and dark == 0
        details.append(f"c:btn={btn} allWalls={all_walls} dark={dark}")
        if not ok:
            return False, " ".join(details)
        # (d) 刷新后保持
        page.reload()
        wait_idle(page)
        fog = m3(page, "fog")
        ok = fog == {"on": False, "radius": 25}
        details.append(f"d:reload fog={fog}")
        if not ok:
            return False, " ".join(details)
        # (e) 静止时不重算；跨进相邻格恰好重算一次
        n0 = m3(page, "fogRecomputeCount")
        page.wait_for_timeout(1000)
        n1 = m3(page, "fogRecomputeCount")
        d = open_dir(page)
        dr, dc = DIRS[d]
        arrived = walk_to(page, dr, dc)
        n2 = m3(page, "fogRecomputeCount")
        r = logic_themes(page, FOG_STATE_JS, 25)
        ok = n0 == n1 and arrived and n2 == n1 + 1 and r["wallMismatch"] == 0
        # 此时迷雾已关（见 (d)），不应有过渡圈
        ok = ok and r["floorMismatch"] == 0 and r["edgeCells"] == 0
        details.append(f"e:count {n0}->{n1} idle, ->{n2} after walk {d} {r}")
        if not ok:
            return False, " ".join(details)
        ok, msg = no_errors(errors)
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


PATH_STATE_JS = """(() => {
  const path = L.findPath(M.connections, M.player, { row: M.size - 1, col: M.size - 1 });
  const on = new Set(path.map(([r, c]) => r * M.size + c));
  let bad = 0;
  for (let row = 0; row < M.size; row++)
    for (let col = 0; col < M.size; col++) {
      const red = M.floorColorHex(row, col) === '#ffd740';
      if (red !== on.has(row * M.size + col)) bad++;
    }
  return { len: path.length, bad };
})()"""


PATH_STATE_JS = """(() => {
  const path = L.findPath(M.connections, M.player, { row: M.size - 1, col: M.size - 1 });
  const on = new Set(path.map(([r, c]) => r * M.size + c));
  let bad = 0;
  for (let row = 0; row < M.size; row++)
    for (let col = 0; col < M.size; col++) {
      const red = M.floorColorHex(row, col) === '#ffd740';
      if (red !== on.has(row * M.size + col)) bad++;
    }
  return { len: path.length, bad };
})()"""


def check_5(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        page.click("#show-path-btn")
        r = logic(page, PATH_STATE_JS)
        details.append(f"show:{r} showPath={m3(page, 'showPath')}")
        if r["bad"] != 0 or r["len"] < 2:
            return False, " ".join(details)
        # 走到路径上第二格，道路按新位置重算
        path = logic(
            page,
            "L.findPath(M.connections, M.playerCell, {row: M.size - 1, col: M.size - 1})",
        )
        arrived = walk_to(page, path[1][0], path[1][1])
        r2 = logic(page, PATH_STATE_JS)
        details.append(f"after-walk({arrived}) at {pos(page)}:{r2}")
        if not arrived or r2["bad"] != 0 or r2["len"] != r["len"] - 1:
            return False, " ".join(details)
        page.click("#hide-path-btn")
        res = logic_themes(
            page,
            """(() => {"""
            + FLOOR_WANT_JS
            + """
              let red = 0;
              for (let row = 0; row < M.size; row++)
                for (let col = 0; col < M.size; col++)
                  if (M.floorColorHex(row, col) === '#ffd740') red++;
              const endCell = { row: M.size - 1, col: M.size - 1 };
              return {
                red,
                start: M.floorColorHex(0, 0),
                startWant: want[wantKind({ row: 0, col: 0 }, false)],
                end: M.floorColorHex(M.size - 1, M.size - 1),
                endWant: want[wantKind(endCell, false)],
              };
            })()""",
            m3(page, "fog")["radius"],
        )
        details.append(f"hide:{res}")
        ok = (
            res["red"] == 0
            and res["start"] == res["startWant"]
            and res["end"] == res["endWant"]
        )
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


BLOCK_STORAGE = """
Storage.prototype.getItem = function () { throw new Error('storage blocked'); };
Storage.prototype.setItem = function () { throw new Error('storage blocked'); };
"""


def preset_storage(on, radius):
    return (
        "try { localStorage.setItem('maze3d.fogOn', %s);"
        " localStorage.setItem('maze3d.fogRadius', %s); } catch (e) {}"
        % (json.dumps(on), json.dumps(radius))
    )


def check_4b(browser, base):
    details = []
    page, errors = open_page(
        browser, f"{base}{PAGE}?seed={S}&size=10", init_script=BLOCK_STORAGE
    )
    try:
        wait_idle(page)
        fog = m3(page, "fog")
        page.click("#fog-plus")
        r6 = m3(page, "fog")["radius"]
        pageerrors = [e for e in errors if e.startswith("pageerror")]
        details.append(f"blocked: fog={fog} after+={r6} pageerrors={pageerrors}")
        if fog != {"on": True, "radius": 5} or r6 != 6 or pageerrors:
            return False, " ".join(details)
    finally:
        close(page)
    for raw, want in [("abc", 5), ("99", 25)]:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10",
            init_script=preset_storage("1", raw),
        )
        try:
            wait_idle(page)
            fog = m3(page, "fog")
            details.append(f"preset {raw!r}: fog={fog}")
            if fog != {"on": True, "radius": want}:
                return False, " ".join(details)
        finally:
            close(page)
    return True, " ".join(details)


def minimap_data(page):
    return page.evaluate("() => document.getElementById('minimap').toDataURL()")


def check_3(browser, base):
    """切换视角：保留 yaw，pitch 改为该视角默认值；两种视角都显示小地图；第一人称隐藏小人。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        face_yaw(page, 2.0)
        yaw0 = m3(page, "yaw")
        page.click("#view-btn")
        page.wait_for_timeout(100)
        view = m3(page, "view")
        text = page.inner_text("#view-btn")
        mini = page.is_visible("#minimap")
        pv = m3(page, "playerVisible")
        yaw1 = m3(page, "yaw")
        pitch1 = m3(page, "pitch")
        details.append(
            f"first: view={view} btn={text} minimap={mini} playerVisible={pv}"
            f" yaw {yaw0:.4f}->{yaw1:.4f} pitch={pitch1}"
        )
        if not (
            view == "first"
            and text == "切换到跟随视角"
            and mini
            and pv is False
            and abs(yaw1 - yaw0) < 1e-9
            and pitch1 == 0
        ):
            return False, " ".join(details)
        img0 = minimap_data(page)
        page.keyboard.down("ArrowRight")
        page.wait_for_timeout(300)
        page.keyboard.up("ArrowRight")
        page.wait_for_timeout(100)
        img1 = minimap_data(page)
        details.append(f"turn: minimapChanged={img0 != img1}")
        if img0 == img1:
            return False, " ".join(details)
        yaw2 = m3(page, "yaw")
        page.click("#view-btn")
        page.wait_for_timeout(100)
        view = m3(page, "view")
        mini = page.is_visible("#minimap")
        pv = m3(page, "playerVisible")
        yaw3 = m3(page, "yaw")
        pitch_deg = math.degrees(m3(page, "pitch"))
        details.append(
            f"follow: view={view} minimap={mini} playerVisible={pv}"
            f" yawKept={abs(yaw3 - yaw2) < 1e-9} pitch={pitch_deg:.2f}deg"
        )
        ok = (
            view == "follow"
            and mini
            and pv is True
            and abs(yaw3 - yaw2) < 1e-9
            and abs(pitch_deg - 40) <= 0.5
        )
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def box_of(page, sel):
    return page.locator(sel).bounding_box()


def intersects(a, b):
    return not (
        a["x"] + a["width"] <= b["x"]
        or b["x"] + b["width"] <= a["x"]
        or a["y"] + a["height"] <= b["y"]
        or b["y"] + b["height"] <= a["y"]
    )


def inside(inner, outer, eps=0.5):
    return (
        inner["x"] >= outer["x"] - eps
        and inner["y"] >= outer["y"] - eps
        and inner["x"] + inner["width"] <= outer["x"] + outer["width"] + eps
        and inner["y"] + inner["height"] <= outer["y"] + outer["height"] + eps
    )


def check_8(browser, base):
    """375px 宽：无横向滚动；舞台、摇杆与按钮互不重叠；小地图在舞台内。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10",
        viewport={"width": 375, "height": 667},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
    )
    details = []
    try:
        wait_idle(page)
        page.wait_for_timeout(300)
        sw = page.evaluate("() => document.documentElement.scrollWidth")
        stage = stage_box(page)
        buttons = [
            b
            for b in (
                page.locator("button").nth(i).bounding_box()
                for i in range(page.locator("button").count())
            )
            if b
        ]
        bad = [b for b in buttons if intersects(b, stage)]
        cdp = page.context.new_cdp_session(page)
        tx = stage["x"] + stage["width"] * 0.25
        ty = stage["y"] + stage["height"] * 0.5
        cdp_touch(cdp, "touchStart", {1: (tx, ty)})
        page.wait_for_timeout(200)
        stick = box_of(page, "#stick")
        stick_ok = (
            stick is not None
            and inside(stick, stage)
            and not any(intersects(stick, b) for b in buttons)
        )
        cdp_touch(cdp, "touchEnd", {})
        # 跟随视角（开局）：信息栏与小地图都在舞台内，声音按钮不压舞台，窄屏小地图 110px
        follow_mini = box_of(page, "#minimap")
        follow_mini_ok = (
            follow_mini is not None
            and inside(follow_mini, stage)
            and abs(follow_mini["width"] - 110) <= 0.5
        )
        hud = box_of(page, "#hud") if page.locator("#hud").count() else None
        hud_ok = hud is not None and inside(hud, stage)
        hud_note = f"inside={hud_ok}"
        sb = box_of(page, "#sound-btn") if page.locator("#sound-btn").count() else None
        sound_ok = sb is not None and not intersects(sb, stage)
        sound_note = f"offStage={sound_ok}"
        details.append(
            f"follow: minimap={follow_mini} minimapOk={follow_mini_ok}"
            f" hud={hud_note} soundBtn={sound_note}"
        )
        if not (follow_mini_ok and hud_ok and sound_ok):
            return False, " ".join(details)
        page.click("#view-btn")
        page.wait_for_timeout(200)
        mini = box_of(page, "#minimap")
        mini_ok = inside(mini, stage)
        page.screenshot(path=str(SCRATCH / "maze3d-375x667.png"), full_page=True)
        details.append(
            f"portrait: scrollWidth={sw} buttonsOverStage={bad} stick={stick}"
            f" stickOk={stick_ok} minimapInside={mini_ok}"
        )
        if sw != 375 or bad or not stick_ok or not mini_ok:
            return False, " ".join(details)
        page.set_viewport_size({"width": 667, "height": 375})
        page.wait_for_timeout(300)
        wait_frames(page, 3)
        sw2 = page.evaluate("() => document.documentElement.scrollWidth")
        cw = box_of(page, "#stage > canvas:not(#minimap)")["width"]
        stw = box_of(page, "#stage")["width"]
        page.screenshot(path=str(SCRATCH / "maze3d-667x375.png"), full_page=True)
        mm = page.evaluate(
            "() => ({ lay: window.__maze3d.minimapLayout,"
            " w: document.getElementById('minimap').width,"
            " dpr: window.devicePixelRatio })"
        )
        lay = mm["lay"] or {}
        want_px = round(140 * mm["dpr"])
        px_ok = lay.get("px") == want_px and mm["w"] == want_px
        details.append(
            f"landscape: scrollWidth={sw2} canvas={cw} stage={stw}"
            f" minimapPx={lay.get('px')} canvasWidth={mm['w']} want={want_px}"
        )
        ok = sw2 <= 667 and abs(cw - stw) < 1 and px_ok
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def perf_round(
    browser,
    base,
    mobile,
    init_script=None,
    driver=play_continuous,
    prepare=None,
    debug=False,
):
    """base 可以指向基线服务器；init_script 用来预设主题。debug=True 时 URL 带 &debug=1；
    prepare(page) 在 wait_idle 之后、开始计时之前调用（之后再等 800ms 让相机跟随稳定）。
    返回值里 endPos 是驱动结束时的小人位置，wins 是驱动中点「再来一局」的次数。"""
    url = f"{base}{PAGE}?seed={S}&size=20" + ("&debug=1" if debug else "")
    if mobile:
        dev = dict(PW.devices["iPhone SE"])
        dev.pop("default_browser_type", None)
        page, errors = open_page(browser, url, init_script=init_script, **dev)
        cdp = page.context.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    else:
        page, errors = open_page(
            browser,
            url,
            viewport={"width": 1280, "height": 800},
            init_script=init_script,
        )
    try:
        wait_idle(page, timeout=15000)
        if prepare:
            prepare(page)
            page.wait_for_timeout(800)
        else:
            page.wait_for_timeout(500)
        page.evaluate("() => window.__maze3d.resetFrameStats()")
        wins = driver(page)
        stats = m3(page, "frameStats()")
        return {
            "endPos": m3(page, "playerPos"),
            "wins": wins,
            "count": stats["count"],
            "avg": round(stats["avg"], 1),
            "p95": round(stats["p95"], 1),
            "quality": m3(page, "quality"),
            "renderer": m3(page, "rendererName"),
            "downgradeCount": m3(page, "downgradeCount"),
            "textureMs": page.evaluate(
                "() => window.__maze3d.textureStats"
                " ? window.__maze3d.textureStats.lastMs : null"
            ),
            # 玩法字段（基线页面没有，返回 null）
            "extras": page.evaluate(
                "() => { const M = window.__maze3d; return { minimapVisible: M.minimapVisible ?? null,"
                " starTotal: M.starTotal ?? null, soundOn: M.soundOn ?? null,"
                " audioState: M.audioState ?? null }; }"
            ),
            "errors": errors,
        }
    finally:
        close(page)


def fmt_round(name, r):
    return (
        f"{name}: count={r['count']} avg={r['avg']} p95={r['p95']}"
        f" quality={r['quality']} renderer={r['renderer']!r}"
    )


def check_9(browser, base):
    bt = browser.browser_type
    attempts = []
    for headless in [True, False]:
        gb = bt.launch(
            channel="chromium",
            headless=headless,
            args=["--use-angle=metal", "--enable-gpu"],
        )
        try:
            desk = perf_round(gb, base, mobile=False)
            if "swiftshader" in desk["renderer"].lower():
                attempts.append(f"headless={headless} renderer={desk['renderer']!r}")
                continue
            mob = perf_round(gb, base, mobile=True)
        finally:
            gb.close()
        detail = (
            f"headless={headless} "
            + fmt_round("desktop", desk)
            + " | "
            + fmt_round("iPhone SE x4 CPU", mob)
        )
        if "swiftshader" in mob["renderer"].lower():
            return None, detail
        errs = desk["errors"] + mob["errors"]
        ok = mob["avg"] <= 33 and mob["p95"] <= 50 and not errs
        if errs:
            detail += " errors=" + " | ".join(errs[:3])
        return ok, detail
    return None, "still SwiftShader: " + "; ".join(attempts)


def check_9b(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        page.wait_for_timeout(500)
        page.evaluate(
            "() => { Object.defineProperty(document, 'visibilityState',"
            " { value: 'hidden', configurable: true });"
            " document.dispatchEvent(new Event('visibilitychange')); }"
        )
        page.wait_for_timeout(100)
        c0 = m3(page, "frameStats()")["count"]
        page.wait_for_timeout(500)
        c1 = m3(page, "frameStats()")["count"]
        page.evaluate(
            "() => { Object.defineProperty(document, 'visibilityState',"
            " { value: 'visible', configurable: true });"
            " document.dispatchEvent(new Event('visibilitychange')); }"
        )
        page.wait_for_timeout(500)
        c2 = m3(page, "frameStats()")["count"]
        quality = m3(page, "quality")
        stats = m3(page, "frameStats()")
        ok = c1 == c0 and c2 > c1 and quality == "high"
        ok_err, msg = no_errors(errors)
        return (
            ok and ok_err,
            (
                f"hidden count {c0}->{c1}, visible ->{c2}, quality={quality}"
                f" p95={stats['p95']:.1f} {msg}"
            ).strip(),
        )
    finally:
        close(page)


def check_9c(browser, base):
    details = []
    page, errors = open_page(
        browser, f"{base}{PAGE}?seed={S}&size=10&debug=1&slow=40", has_touch=True
    )
    try:
        wait_ready(page)
        page.wait_for_function("() => window.__maze3d.quality === 'low'", timeout=10000)
        page.wait_for_timeout(200)
        n = m3(page, "downgradeCount")
        canv = page.evaluate(
            "() => { const st = document.getElementById('stage');"
            " const cs = [...st.querySelectorAll('canvas')].filter((c) => c.id !== 'minimap');"
            " return { n: cs.length, w: cs[0].width, h: cs[0].height,"
            " cw: st.clientWidth, ch: st.clientHeight }; }"
        )
        colors = m3(page, "sampleDistinctColors()")
        details.append(f"downgradeCount={n} canvas={canv} colors={colors}")
        if not (
            n == 1
            and canv["n"] == 1
            and canv["w"] == canv["cw"]
            and canv["h"] == canv["ch"]
            and colors >= 3
        ):
            return False, " ".join(details)
        wait_idle(page, timeout=10000)
        # 降画质后：键盘、鼠标拖动、触摸摇杆仍然生效
        face_open(page)
        p0 = pos_of(page)
        page.keyboard.down("w")
        page.wait_for_timeout(500)
        page.keyboard.up("w")
        page.wait_for_timeout(300)
        p1 = pos_of(page)
        stage = stage_box(page)
        cx = stage["x"] + stage["width"] / 2
        cy = stage["y"] + stage["height"] / 2
        y0 = m3(page, "yaw")
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 100, cy, steps=5)
        page.mouse.up()
        page.wait_for_timeout(300)
        y1 = m3(page, "yaw")
        page.click("#regen-btn")
        wait_idle(page)
        face_open(page)
        p2 = pos_of(page)
        cdp = page.context.new_cdp_session(page)
        tx = stage["x"] + stage["width"] * 0.25
        cdp_touch(cdp, "touchStart", {1: (tx, cy)})
        for i in range(1, 7):
            cdp_touch(cdp, "touchMove", {1: (tx, cy - 10 * i)})
            page.wait_for_timeout(30)
        page.wait_for_timeout(500)
        cdp_touch(cdp, "touchEnd", {})
        page.wait_for_timeout(300)
        p3 = pos_of(page)
        details.append(
            f"keys moved={moved(p0, p1)} mouse yaw {y0:.3f}->{y1:.3f}"
            f" touch moved={moved(p2, p3)} quality={m3(page, 'quality')}"
        )
        if not (moved(p0, p1) and abs(y1 - y0) > 0.1 and moved(p2, p3)):
            return False, " ".join(details)
        page.wait_for_timeout(3000)
        n2 = m3(page, "downgradeCount")
        q2 = m3(page, "quality")
        perf = page.inner_text("#perf")
        details.append(f"after 3s: count={n2} quality={q2} perf={perf!r}")
        ok_err, msg = no_errors(errors)
        if not (n2 == 1 and q2 == "low" and ok_err):
            return False, " ".join(details) + " " + msg
    finally:
        close(page)
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&slow=40")
    try:
        wait_idle(page)
        page.wait_for_timeout(3000)
        q = m3(page, "quality")
        details.append(f"no-debug quality={q}")
        return q == "high", " ".join(details)
    finally:
        close(page)


# ---------------------------------------------------------------- themes

THEME_IDS = ["garden", "brick", "blocks", "castle"]


def click_theme(page, tid):
    page.click(f"#theme-{tid}")


def active_themes(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('.theme-btn.active')]"
        ".map((b) => b.dataset.theme)"
    )


def theme_init(tid):
    return "try { localStorage.setItem('maze3d.theme', %s) } catch {}" % json.dumps(tid)


def themes_mod(page, expr, arg=None):
    """在页面里 import themes.js 后求值 expr（可用 T、M=__maze3d、arg）。"""
    return page.evaluate(
        "async ([expr, arg]) => {"
        " const T = await import('/maze-3d/themes.js');"
        " const M = window.__maze3d;"
        " return (new Function('T', 'M', 'arg', 'return (' + expr + ');'))(T, M, arg);"
        "}",
        [expr, arg],
    )


def floor_base_hex(page, tid):
    return themes_mod(
        page, "'#' + T.THEMES[arg].floorBase.toString(16).padStart(6, '0')", tid
    )


COUNT_HEX_JS = """(() => {
  let n = 0;
  for (let r = 0; r < M.size; r++)
    for (let c = 0; c < M.size; c++) if (M.floorColorHex(r, c) === arg) n++;
  return n;
})()"""


def check_t1(browser, base):
    """主题切换与一致性：按钮高亮、普通格底色、纹理数、重复点击、道路色、重建迷宫后的墙色。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    details = []
    try:
        wait_idle(page)
        th = m3(page, "theme")
        act = active_themes(page)
        details.append(f"default={th} active={act}")
        if th != "garden" or act != ["garden"]:
            return False, " ".join(details)
        ground_maps = {}
        for tid in THEME_IDS:
            click_theme(page, tid)
            th = m3(page, "theme")
            act = active_themes(page)
            got = m3(page, "floorColorHex(1, 1)")
            want = floor_base_hex(page, tid)
            tc = m3(page, "textureCount")
            ground_maps[tid] = (m3(page, "ground") or {}).get("mapUuid")
            details.append(f"{tid}: floor={got}/{want} textures={tc}")
            if th != tid or act != [tid] or got != want or tc != 5:
                return False, " ".join(details) + f" theme={th} active={act}"
        uuids = list(ground_maps.values())
        details.append(f"groundMaps distinct={len(set(uuids))}")
        if None in uuids or len(set(uuids)) != 4:
            return False, " ".join(details) + f" {ground_maps}"
        builds = m3(page, "textureStats")["builds"]
        click_theme(page, THEME_IDS[-1])
        b2 = m3(page, "textureStats")["builds"]
        tc = m3(page, "textureCount")
        gm = m3(page, "ground")["mapUuid"]
        details.append(
            f"reclick builds {builds}->{b2} textures={tc}"
            f" groundMapSame={gm == ground_maps[THEME_IDS[-1]]}"
        )
        if b2 != builds or tc != 5 or gm != ground_maps[THEME_IDS[-1]]:
            return False, " ".join(details)
        page.click("#show-path-btn")
        red0 = logic(page, COUNT_HEX_JS, "#ffd740")
        click_theme(page, "garden")
        red1 = logic(page, COUNT_HEX_JS, "#ffd740")
        details.append(f"path red {red0}->{red1}")
        if red0 == 0 or red0 != red1:
            return False, " ".join(details)
        click_theme(page, "blocks")
        builds = m3(page, "textureStats")["builds"]
        page.click("#regen-btn")
        wait_idle(page)
        page.click("#size-15")
        wait_idle(page)
        got = page.evaluate(
            "() => Array.from({ length: 10 }, (_, i) => window.__maze3d.wallColorHex(i))"
        )
        want = themes_mod(
            page,
            "Array.from({ length: 10 }, (_, i) => '#' + T.THEMES.blocks.blockPalette["
            "T.blockColorIndex(i, 5)].toString(16).padStart(6, '0'))",
        )
        b2 = m3(page, "textureStats")["builds"]
        tc = m3(page, "textureCount")
        size = m3(page, "size")
        details.append(
            f"blocks after regen+15: size={size} walls={got == want} builds {builds}->{b2}"
            f" textures={tc}"
        )
        if got != want or b2 != builds or tc != 5 or size != 15:
            return False, " ".join(details) + f" got={got} want={want}"
        ok, msg = no_errors(errors)
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


CLICK_DURING_JS = (
    "(id) => { const s = window.__maze3d.state;"
    " document.getElementById(id).click(); return s; }"
)


def check_t3(browser, base):
    """按住移动 / 转向键途中切换主题：迷宫不重建，小人继续走、视角继续转。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        face_open(page)
        gen0 = m3(page, "generation")
        page.keyboard.down("w")
        page.wait_for_timeout(100)
        page.evaluate("(id) => document.getElementById(id).click()", "theme-castle")
        p0 = pos_of(page)
        # 换主题那一帧要生成并上传纹理、把天空转成立方体贴图，软件渲染下会卡几百毫秒；
        # 等最多 1s 看小人是否接着走，而不是只看固定的 150ms
        try:
            page.wait_for_function(
                "(p) => { const q = window.__maze3d.playerPos;"
                " return Math.hypot(q.x - p.x, q.z - p.z) > 1e-6; }",
                arg=p0,
                timeout=1000,
            )
        except PlaywrightTimeout:
            pass
        p1 = pos_of(page)
        page.keyboard.up("w")
        gen1 = m3(page, "generation")
        th = m3(page, "theme")
        details.append(
            f"walk: moved after click={moved(p0, p1)} gen {gen0}->{gen1} theme={th}"
        )
        if not moved(p0, p1) or gen1 != gen0 or th != "castle":
            return False, " ".join(details)
        page.click("#view-btn")
        page.wait_for_timeout(100)
        page.keyboard.down("ArrowLeft")
        page.wait_for_timeout(100)
        page.evaluate("(id) => document.getElementById(id).click()", "theme-brick")
        y0 = m3(page, "yaw")
        try:
            page.wait_for_function(
                "(y) => window.__maze3d.yaw < y", arg=y0, timeout=1000
            )
        except PlaywrightTimeout:
            pass
        y1 = m3(page, "yaw")
        page.keyboard.up("ArrowLeft")
        th = m3(page, "theme")
        gen2 = m3(page, "generation")
        details.append(f"turn: yaw {y0:.3f}->{y1:.3f} gen={gen2} theme={th}")
        if not (y1 < y0 and gen2 == gen0 and th == "brick"):
            return False, " ".join(details)
        ok, msg = no_errors(errors)
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_t4(browser, base):
    """主题持久化；非法存储值与存储被禁用时以花园主题启动。"""
    details = []
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        click_theme(page, "brick")
        page.reload()
        wait_idle(page)
        th = m3(page, "theme")
        act = active_themes(page)
        details.append(f"reload: theme={th} active={act}")
        if th != "brick" or act != ["brick"]:
            return False, " ".join(details)
        for bad in ["foo", "GARDEN", ""]:
            page.evaluate("(v) => localStorage.setItem('maze3d.theme', v)", bad)
            page.reload()
            wait_idle(page)
            th = m3(page, "theme")
            act = active_themes(page)
            details.append(f"stored {bad!r}: theme={th} active={act}")
            if th != "garden" or act != ["garden"]:
                return False, " ".join(details)
        pageerrors = [e for e in errors if e.startswith("pageerror")]
        if pageerrors:
            return False, " ".join(details) + f" pageerrors={pageerrors}"
    finally:
        close(page)
    page, errors = open_page(
        browser, f"{base}{PAGE}?seed={S}&size=10", init_script=BLOCK_STORAGE
    )
    try:
        wait_idle(page)
        th0 = m3(page, "theme")
        click_theme(page, "castle")
        th1 = m3(page, "theme")
        act = active_themes(page)
        pageerrors = [e for e in errors if e.startswith("pageerror")]
        details.append(
            f"blocked: theme={th0} after click={th1} active={act} pageerrors={pageerrors}"
        )
        ok = (
            th0 == "garden" and th1 == "castle" and act == ["castle"] and not pageerrors
        )
        return ok, " ".join(details)
    finally:
        close(page)


def check_t6(browser, base):
    """反复切换主题：旧纹理被释放，存活纹理数恒为 5。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        stats = m3(page, "textureStats")
        if stats["builds"] != 1 or m3(page, "textureCount") != 5:
            return False, f"start: stats={stats} textures={m3(page, 'textureCount')}"
        prev = 1
        for i in range(20):
            tid = THEME_IDS[(i + 1) % 4]
            click_theme(page, tid)
            tc = m3(page, "textureCount")
            builds = m3(page, "textureStats")["builds"]
            if tc != 5 or builds != prev + 1:
                return False, f"i={i} tid={tid} textures={tc} builds {prev}->{builds}"
            prev = builds
        tc = m3(page, "textureCount")
        builds = m3(page, "textureStats")["builds"]
        if tc != 5 or builds != 21:
            return False, f"after 20 switches: textures={tc} builds={builds}"
        click_theme(page, m3(page, "theme"))
        tc2 = m3(page, "textureCount")
        b2 = m3(page, "textureStats")["builds"]
        ms = m3(page, "textureStats")["lastMs"]
        detail = f"20 switches: textures={tc} builds={builds}; reclick textures={tc2} builds={b2} lastMs={ms:.1f}"
        ok_err, msg = no_errors(errors)
        ok = ok_err and tc2 == 5 and b2 == 21
        return ok, (detail + " " + msg).strip()
    finally:
        close(page)


def check_t8(browser, base):
    """375px 宽：不出横向滚动，主题按钮够大、排在视角行之下。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10",
        viewport={"width": 375, "height": 667},
        is_mobile=True,
        has_touch=True,
        device_scale_factor=2,
    )
    try:
        wait_idle(page)
        page.wait_for_timeout(300)
        sw = page.evaluate("() => document.documentElement.scrollWidth")
        row = box_of(page, "#theme-row")
        view_row = box_of(page, "#view-row")
        bad = []
        for tid in THEME_IDS:
            b = box_of(page, f"#theme-{tid}")
            if b["height"] < 44 or not inside(b, row) or b["y"] <= view_row["y"]:
                bad.append(f"{tid}:{b}")
        ok_err, msg = no_errors(errors)
        ok = ok_err and sw <= 375 and not bad
        return ok, f"scrollWidth={sw} bad={bad} row={row} {msg}".strip()
    finally:
        close(page)


def canvas_image(page, attempts=3):
    """3D canvas 的截图。自动降画质会换掉 canvas 元素，截图途中被换掉时重试。"""
    # 元素截图包含盖在 canvas 上的覆盖层；测的是 3D 画面本身，截图前先藏起小地图与信息栏
    toggle = (
        "(v) => { for (const id of ['minimap', 'hud']) {"
        " const el = document.getElementById(id); if (el) el.style.visibility = v; } }"
    )
    page.evaluate(toggle, "hidden")
    try:
        for i in range(attempts):
            try:
                data = page.locator("#stage > canvas:not(#minimap)").screenshot()
                return Image.open(io.BytesIO(data)).convert("RGB")
            except Exception as exc:
                if "not attached" not in str(exc) or i == attempts - 1:
                    raise
                page.wait_for_timeout(200)
    finally:
        page.evaluate(toggle, "")


def screen_metrics(img):
    """与 __maze3d.wallContrast 相同的网格与公式：中心 50% 区域 16×16 取样。"""
    w, h = img.size
    px = img.load()
    seen = set()
    lumas = []
    for i in range(16):
        for j in range(16):
            x = int(w * (0.25 + 0.5 * (i + 0.5) / 16))
            y = int(h * (0.25 + 0.5 * (j + 0.5) / 16))
            r, g, b = px[x, y]
            seen.add((r, g, b))
            lumas.append(0.299 * r + 0.587 * g + 0.114 * b)
    mean = sum(lumas) / len(lumas)
    std = (sum((v - mean) ** 2 for v in lumas) / len(lumas)) ** 0.5
    lumas.sort()
    spread = lumas[int(0.95 * 255)] - lumas[int(0.05 * 255)]
    return {"colors": len(seen), "std": std, "spread": spread}


def fmt_metrics(m):
    return f"colors={m['colors']} spread={m['spread']:.1f} std={m['std']:.1f}"


def contrast_ok(m):
    return m["colors"] >= 12 and m["spread"] >= 40 and m["std"] >= 10


def check_t2(browser, base):
    """第一人称面墙时墙面有纹理：取样颜色数、亮度分位差、标准差都够大。"""
    if not BASELINE_ROOT:
        return None, "need --baseline-root"
    details = []
    proc, bbase = start_server(BASELINE_ROOT)
    try:
        # 基线是自由移动版本：与当前代码用同一套方式面墙
        page, errors = open_page(browser, f"{bbase}{PAGE}?seed={S}&size=10&debug=1")
        try:
            wait_idle(page)
            facing = find_wall_cell(page)
            page.click("#view-btn")
            if facing is not None:
                set_test_input(page, yaw=DIR_YAW[facing], pitch=0)
                set_test_input(page)
            page.wait_for_timeout(300)
            base_m = screen_metrics(canvas_image(page))
            details.append(f"baseline(facing={facing}): {fmt_metrics(base_m)}")
        finally:
            close(page)
    finally:
        proc.terminate()
        proc.wait()
    all_ok = True
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            init_script=theme_init(tid),
        )
        try:
            wait_idle(page)
            facing = find_wall_cell(page)
            page.click("#view-btn")
            if facing is not None:
                set_test_input(page, yaw=DIR_YAW[facing], pitch=0)
                set_test_input(page)
            page.wait_for_timeout(300)
            wc = m3(page, "wallContrast()")
            sm = screen_metrics(canvas_image(page))
            th = m3(page, "theme")
            ok_err, msg = no_errors(errors)
            ok = (
                facing is not None
                and contrast_ok(wc)
                and contrast_ok(sm)
                and ok_err
                and th == tid
            )
            all_ok = all_ok and ok
            details.append(
                f"{tid}(facing={facing} ok={ok}): gl[{fmt_metrics(wc)}]"
                f" screen[{fmt_metrics(sm)}] {msg}".strip()
            )
        finally:
            close(page)
    return all_ok, " | ".join(details)


def chebyshev(a, b):
    return max(abs(a["row"] - b["row"]), abs(a["col"] - b["col"]))


def sample_kind(page, img, cells, want):
    """在候选格里找第一个种类为 want、且有未遮挡取样点的格，返回取样像素各通道中位数。"""
    cw = page.evaluate(
        "() => document.querySelector('#stage > canvas:not(#minimap)').clientWidth"
    )
    ratio = img.size[0] / cw
    px = img.load()
    for r, c in cells:
        if m3(page, f"floorKindAt({r}, {c})") != want:
            continue
        pts = m3(page, f"floorSamplePoints({r}, {c})")
        if not pts:
            continue
        rgb = []
        for p in pts:
            x = min(img.size[0] - 1, max(0, int(p["x"] * ratio)))
            y = min(img.size[1] - 1, max(0, int(p["y"] * ratio)))
            rgb.append(px[x, y])
        med = []
        for ch in range(3):
            vals = sorted(v[ch] for v in rgb)
            med.append(vals[len(vals) // 2])
        return tuple(med), (r, c)
    return None, None


def cells_by_distance(page, keep=lambda cell, dist: True):
    n = m3(page, "size")
    here = pos(page)
    out = []
    for r in range(n):
        for c in range(n):
            dist = chebyshev(here, {"row": r, "col": c})
            if keep((r, c), dist):
                out.append((dist, r, c))
    out.sort()
    return [(r, c) for _, r, c in out]


def settle_camera(page):
    wait_settled(page)
    page.wait_for_timeout(1200)


def rgb_dist(a, b):
    return sum((x - y) ** 2 for x, y in zip(a, b)) ** 0.5


def walk_near_end(page, dist):
    """沿最短路走到第一个与终点切比雪夫距离 <= dist 的格子（不进终点）。"""
    n = m3(page, "size")
    end = {"row": n - 1, "col": n - 1}
    path = logic(
        page,
        "L.findPath(M.connections, M.playerCell, {row: M.size - 1, col: M.size - 1})",
    )
    for r, c in path:
        cell = {"row": r, "col": c}
        if cell != end and chebyshev(cell, end) <= dist:
            return walk_to(page, r, c)
    return False


def check_t5(browser, base):
    """各主题下五类地板格（普通、起点、终点、道路、迷雾）在屏幕上两两颜色距离 ≥ 60。"""
    details = []
    all_ok = True
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            init_script=theme_init(tid) + preset_storage("0", "1"),
        )
        got = {}
        notes = []
        try:
            wait_idle(page)
            n = m3(page, "size")
            end = {"row": n - 1, "col": n - 1}
            # 场景 A：迷雾关、道路关
            d = open_dir(page)
            walk_to(page, *DIRS[d])
            settle_camera(page)
            img = canvas_image(page)
            got["start"], _ = sample_kind(page, img, [(0, 0)], "start")
            got["floor"], at = sample_kind(page, img, cells_by_distance(page), "floor")
            notes.append(f"floor@{at}")
            walk_near_end(page, 2)
            settle_camera(page)
            img = canvas_image(page)
            end_a, _ = sample_kind(page, img, [(n - 1, n - 1)], "end")
            notes.append(f"A at {pos(page)} endA={end_a}")
            # 场景 B：显示道路
            page.click("#show-path-btn")
            page.wait_for_timeout(300)
            img = canvas_image(page)
            got["path"], at = sample_kind(
                page,
                img,
                cells_by_distance(
                    page, lambda cell, dist: cell not in [(0, 0), (n - 1, n - 1)]
                ),
                "path",
            )
            notes.append(f"path@{at}")
            # 场景 C：迷雾开、视野 1、道路关
            page.click("#hide-path-btn")
            page.click("#fog-btn")
            fog_state = m3(page, "fog")
            settle_camera(page)
            img = canvas_image(page)
            got["fog"], at = sample_kind(
                page,
                img,
                cells_by_distance(page, lambda cell, dist: 3 <= dist <= 4),
                "fog",
            )
            got_edge, edge_at = sample_kind(
                page,
                img,
                cells_by_distance(page, lambda cell, dist: dist == 2),
                "fogEdge",
            )
            notes.append(f"fogEdge@{edge_at}={got_edge}")
            floor_c, _ = sample_kind(
                page,
                img,
                cells_by_distance(page, lambda cell, dist: dist <= 1),
                "floor",
            )
            end_kind_c = m3(page, f"floorKindAt({n - 1}, {n - 1})")
            notes.append(
                f"fog@{at} C fog={fog_state} floorC={floor_c} endKindC={end_kind_c}"
            )
            # 场景 D：继续前进到终点旁边（不进终点）
            walk_near_end(page, 1)
            here = pos(page)
            settle_camera(page)
            img = canvas_image(page)
            end_kind_d = m3(page, f"floorKindAt({n - 1}, {n - 1})")
            got["end"], _ = sample_kind(page, img, [(n - 1, n - 1)], "end")
            notes.append(f"D at {here} endKindD={end_kind_d}")
            missing = [
                k
                for k in ["floor", "start", "end", "path", "fog"]
                if got.get(k) is None
            ]
            pairs = []
            keys = [k for k in ["floor", "start", "end", "path", "fog"] if got.get(k)]
            for i, a in enumerate(keys):
                for b in keys[i + 1 :]:
                    pairs.append((rgb_dist(got[a], got[b]), a, b))
            pairs.sort()
            worst = pairs[0] if pairs else None
            ok_err, msg = no_errors(errors)
            ok = (
                not missing
                and worst is not None
                and worst[0] >= 60
                and end_kind_c in ("fog", "fogEdge")
                and got_edge is not None
                and end_kind_d == "end"
                and here != end
                and fog_state == {"on": True, "radius": 1}
                and ok_err
                and m3(page, "theme") == tid
            )
            all_ok = all_ok and ok
            colors = " ".join(
                f"{k}={got.get(k)}" for k in ["floor", "start", "end", "path", "fog"]
            )
            worst_s = f"{worst[1]}-{worst[2]}={worst[0]:.1f}" if worst else "n/a"
            details.append(
                f"{tid}(ok={ok}): {colors} min={worst_s} missing={missing}"
                f" [{'; '.join(notes)}] {msg}".strip()
            )
        finally:
            close(page)
    return all_ok, " | ".join(details)


def fmt_perf(name, r):
    ms = r["textureMs"]
    ms_s = "None" if ms is None else f"{ms:.1f}"
    ep = r.get("endPos")
    ep_s = "None" if not ep else f"({ep['x']:.2f}, {ep['z']:.2f})"
    return (
        f"{name}: avg={r['avg']} p95={r['p95']} quality={r['quality']}"
        f" downgradeCount={r['downgradeCount']} renderer={r['renderer']!r} textureMs={ms_s}"
        f" endPos={ep_s} wins={r.get('wins')}"
    )


# 基线（3aa67ab）跟随视角的默认俯角与缩放：movement.js FOLLOW_PITCH.def = 40°，main.js cameraZoom = 1
BASELINE_FOLLOW_PITCH = math.radians(40)
BASELINE_ZOOM = 1.0


def perf_fixed_start(page):
    """t7 两边共用的起始条件：朝南、基线默认俯角与缩放；场景雾默认，小人留在开局格。
    只调用基线也有的钩子（setInputForTest、setZoomForTest）。"""
    set_test_input(page, yaw=math.pi, pitch=BASELINE_FOLLOW_PITCH)
    set_test_input(page)
    page.evaluate(f"() => window.__maze3d.setZoomForTest({BASELINE_ZOOM})")


def check_t7(browser, base):
    """GPU 下 iPhone SE + 4 倍 CPU 降速：各主题帧时间不超过基线的 1.3 倍，且不触发降画质。"""
    return perf_compare(browser, base)


def perf_compare(browser, base, extra=None):
    """check_t7 的主体：GPU、iPhone SE、4 倍 CPU 降速，基线与四个主题各跑一轮 play_continuous。
    extra(name, round) 对每个新代码轮次返回 (ok, msg)，不通过即 FAIL。"""
    if not BASELINE_ROOT:
        return None, "need --baseline-root"
    bt = browser.browser_type
    attempts = []
    proc, bbase = start_server(BASELINE_ROOT)
    try:
        for headless in [True, False]:
            gb = bt.launch(
                channel="chromium",
                headless=headless,
                args=["--use-angle=metal", "--enable-gpu"],
            )
            try:
                runs = [
                    (
                        "baseline",
                        perf_round(
                            gb, bbase, mobile=True, debug=True, prepare=perf_fixed_start
                        ),
                    )
                ]
                if "swiftshader" in runs[0][1]["renderer"].lower():
                    attempts.append(
                        f"headless={headless} renderer={runs[0][1]['renderer']!r}"
                    )
                    continue
                for tid in THEME_IDS:
                    runs.append(
                        (
                            tid,
                            perf_round(
                                gb,
                                base,
                                mobile=True,
                                init_script=theme_init(tid),
                                debug=True,
                                prepare=perf_fixed_start,
                            ),
                        )
                    )
            finally:
                gb.close()
            lines = [f"headless={headless}"] + [fmt_perf(n, r) for n, r in runs]
            detail = " | ".join(lines)
            renderers = {r["renderer"] for _, r in runs}
            if any("swiftshader" in x.lower() for x in renderers):
                return None, detail + " | INCONCLUSIVE: swiftshader"
            if len(renderers) != 1:
                return None, detail + f" | INCONCLUSIVE: renderers differ {renderers}"
            errs = [e for _, r in runs for e in r["errors"]]
            if errs:
                return False, detail + " | errors=" + " | ".join(errs[:3])
            bl = runs[0][1]
            # 轨迹一致性：同样的按键序列下，各主题与基线的通关次数、结束位置应一致
            for tid, r in runs[1:]:
                ep, bp = r["endPos"], bl["endPos"]
                if r["wins"] != bl["wins"] or (
                    math.hypot(ep["x"] - bp["x"], ep["z"] - bp["z"]) > 1.5
                ):
                    return None, detail + " | INCONCLUSIVE: trajectory differs"
            limit = 1.3 * bl["avg"]
            high = bl["quality"] == "high" and bl["downgradeCount"] == 0
            verdicts = []
            ok = True
            for tid, r in runs[1:]:
                if extra:
                    e_ok, e_msg = extra(tid, r)
                    if not e_ok:
                        verdicts.append(f"{tid}: FAIL {e_msg}")
                        ok = False
                        continue
                if high and r["downgradeCount"] > 0:
                    verdicts.append(
                        f"{tid}: FAIL 触发降级 downgradeCount={r['downgradeCount']}"
                    )
                    ok = False
                elif r["avg"] > limit:
                    verdicts.append(f"{tid}: FAIL avg {r['avg']} > {limit:.1f}")
                    ok = False
                else:
                    verdicts.append(f"{tid}: ok avg {r['avg']} <= {limit:.1f}")
            detail += " | " + "; ".join(verdicts)
            if not high:
                return None, detail + " | 基线已降级，非高画质比较"
            return ok, detail
    finally:
        proc.terminate()
        proc.wait()
    return None, "still SwiftShader: " + "; ".join(attempts)


def check_t7b(browser, base):
    """自动降画质换了 renderer 之后切换主题：纹理照常显示，各向异性降为 1。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1&slow=40")
    details = []
    try:
        wait_ready(page)
        page.wait_for_function("() => window.__maze3d.quality === 'low'", timeout=10000)
        wait_idle(page, timeout=10000)
        an0 = m3(page, "textureAnisotropy")
        details.append(f"after downgrade anisotropy={an0}")
        if an0 != [1, 1, 1, 1]:
            return False, " ".join(details)
        facing = find_wall_cell(page)
        if facing is None:
            return False, " ".join(details) + " no wall to face"
        page.click("#view-btn")
        set_test_input(page, yaw=DIR_YAW[facing], pitch=0)
        set_test_input(page)
        page.wait_for_timeout(300)
        for tid in THEME_IDS:
            click_theme(page, tid)
            th = m3(page, "theme")
            act = active_themes(page)
            wc = m3(page, "wallContrast()")
            an = m3(page, "textureAnisotropy")
            ok = th == tid and act == [tid] and contrast_ok(wc) and an == [1, 1, 1, 1]
            details.append(f"{tid}: {fmt_metrics(wc)} anisotropy={an} ok={ok}")
            if not ok:
                return False, " ".join(details) + f" theme={th} active={act}"
        builds = m3(page, "textureStats")["builds"]
        click_theme(page, "garden")
        b2 = m3(page, "textureStats")["builds"]
        wc = m3(page, "wallContrast()")
        an = m3(page, "textureAnisotropy")
        details.append(
            f"garden again: builds {builds}->{b2} {fmt_metrics(wc)} anisotropy={an}"
        )
        ok_err, msg = no_errors(errors)
        ok = (
            ok_err
            and b2 == builds + 1
            and contrast_ok(wc)
            and an == [1, 1, 1, 1]
            and m3(page, "quality") == "low"
        )
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_t9(browser, base):
    """每个主题存三张截图（跟随、第一人称看通道、第一人称面墙），供人工查看。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    files = []
    all_errors = []
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=theme_init(tid),
        )
        try:
            wait_idle(page)
            page.wait_for_timeout(500)
            f = SHOTS / f"{tid}-follow.png"
            canvas_image(page).save(f)
            files.append(f)
            page.click("#view-btn")
            face_open(page)
            page.wait_for_timeout(300)
            f = SHOTS / f"{tid}-first.png"
            canvas_image(page).save(f)
            files.append(f)
            d = find_wall_cell(page)
            if d is not None:
                set_test_input(page, yaw=DIR_YAW[d], pitch=0)
                set_test_input(page)
            page.wait_for_timeout(300)
            f = SHOTS / f"{tid}-first-wall.png"
            canvas_image(page).save(f)
            files.append(f)
            all_errors += errors
        finally:
            close(page)
    good = [f for f in files if f.exists() and f.stat().st_size > 0]
    ok_err, msg = no_errors(all_errors)
    ok = ok_err and len(good) == 12
    return ok, f"dir={SHOTS} files={len(good)}/12 {msg}".strip()


# ---------------------------------------------------------------- free move


def check_f1(browser, base):
    """按住 w 0.5 秒：位置逐帧连续变化，没有一格一格的跳变。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 640, "height": 480},
    )
    try:
        wait_idle(page)
        page.wait_for_timeout(300)
        face_open(page)

        def hold():
            page.keyboard.down("w")
            page.wait_for_timeout(500)
            page.keyboard.up("w")

        frames = record_frames(page, "playerPos", 600, during=hold)
        steps = [
            math.hypot(b["x"] - a["x"], b["z"] - a["z"])
            for a, b in zip(frames, frames[1:])
        ]
        total = math.hypot(
            frames[-1]["x"] - frames[0]["x"], frames[-1]["z"] - frames[0]["z"]
        )
        distinct = len({(round(p["x"], 9), round(p["z"], 9)) for p in frames})
        worst = max(steps) if steps else None
        ok_err, msg = no_errors(errors)
        ok = (
            ok_err
            and worst is not None
            and worst < 0.1
            and total > 0.5
            and distinct >= 10
        )
        return (
            ok,
            (
                f"frames={len(frames)} maxStep={worst:.4f} total={total:.3f} distinct={distinct} {msg}"
            ).strip(),
        )
    finally:
        close(page)


def check_f2(browser, base):
    """按住 → 0.75 秒：yaw 连续增加约 90°，逐帧平滑。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 640, "height": 480},
    )
    try:
        wait_idle(page)
        page.wait_for_timeout(300)

        def hold():
            page.keyboard.down("ArrowRight")
            page.wait_for_timeout(750)
            page.keyboard.up("ArrowRight")

        yaws = record_frames(page, "yaw", 1000, during=hold)
        deltas = [math.degrees(b - a) for a, b in zip(yaws, yaws[1:])]
        total = math.degrees(yaws[-1] - yaws[0])
        ok_err, msg = no_errors(errors)
        ok = ok_err and abs(total - 90) <= 15 and all(0 <= d < 10 for d in deltas)
        return (
            ok,
            (
                f"frames={len(yaws)} total={total:.1f}deg maxStep={max(deltas):.2f}deg"
                f" minStep={min(deltas):.2f}deg {msg}"
            ).strip(),
        )
    finally:
        close(page)


def wall_face_distance(p, cell, d):
    """圆心到 cell 的 d 方向墙面的水平距离（墙厚 0.1，墙面 = 格边界内缩 0.05）。"""
    r, c = cell["row"], cell["col"]
    if d == "up":
        return p["z"] - (r + 0.05)
    if d == "down":
        return (r + 1 - 0.05) - p["z"]
    if d == "left":
        return p["x"] - (c + 0.05)
    return (c + 1 - 0.05) - p["x"]


def check_f3(browser, base):
    """朝墙按住前进 2 秒：小人停在墙前，不穿墙。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        d = find_wall_cell(page)
        if d is None:
            return False, "no wall cell"
        cell = m3(page, "playerCell")
        face_yaw(page, DIR_YAW[d])
        page.keyboard.down("w")
        page.wait_for_timeout(2000)
        page.keyboard.up("w")
        page.wait_for_timeout(200)
        cell2 = m3(page, "playerCell")
        p = pos_of(page)
        dist = wall_face_distance(p, cell, d)
        ok_err, msg = no_errors(errors)
        ok = ok_err and cell2 == cell and dist >= 0.28 - 0.01 and dist < 0.35
        return (
            ok,
            f"cell={cell}->{cell2} dir={d} pos={p} faceDist={dist:.4f} {msg}".strip(),
        )
    finally:
        close(page)


def check_f4(browser, base):
    """触屏：左半边摇杆走路、右半边拖动转视角、两指同时操作、拖出画布松手 / 取消、窄屏 40% 处按下。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 900, "height": 600},
        has_touch=True,
    )
    details = []
    try:
        wait_idle(page)
        page.wait_for_timeout(300)
        cdp = page.context.new_cdp_session(page)
        st = stage_box(page)
        lx = st["x"] + st["width"] * 0.25
        rx = st["x"] + st["width"] * 0.75
        cy = st["y"] + st["height"] * 0.5
        scroll0 = page.evaluate("() => window.scrollY")

        def regen():
            # 用脚本点击：page.click 会把按钮滚进视口，干扰 scrollY 断言
            page.evaluate("() => document.getElementById('regen-btn').click()")

        def stick_hidden():
            return page.evaluate("() => document.getElementById('stick').hidden")

        # (a) 左半边摇杆
        face_open(page)
        p0 = pos_of(page)
        cdp_touch(cdp, "touchStart", {1: (lx, cy)})
        for i in range(1, 11):
            cdp_touch(cdp, "touchMove", {1: (lx, cy - 6 * i)})
            page.wait_for_timeout(50)
        visible = not stick_hidden()
        cdp_touch(cdp, "touchEnd", {})
        page.wait_for_timeout(300)
        p1 = pos_of(page)
        ok_a = moved(p0, p1) and visible
        details.append(f"a:moved={moved(p0, p1)} stickVisible={visible}")

        # (b) 右半边单指拖动
        y0, pi0 = m3(page, "yaw"), m3(page, "pitch")
        cdp_touch(cdp, "touchStart", {2: (rx, cy)})
        for i in range(1, 5):
            cdp_touch(cdp, "touchMove", {2: (rx + 20 * i, cy + 10 * i)})
            page.wait_for_timeout(30)
        cdp_touch(cdp, "touchEnd", {})
        page.wait_for_timeout(200)
        y1, pi1 = m3(page, "yaw"), m3(page, "pitch")
        ok_b = abs(y1 - y0) > 0.1 and abs(pi1 - pi0) > 0.05
        details.append(f"b:yaw {y0:.3f}->{y1:.3f} pitch {pi0:.3f}->{pi1:.3f}")

        # (c) 两指同时：左摇杆 + 右拖动
        regen()
        wait_idle(page)
        face_open(page)
        p0 = pos_of(page)
        y0 = m3(page, "yaw")
        z0 = m3(page, "cameraZoom")
        d0 = m3(page, "cameraIdealDistance")
        cdp_touch(cdp, "touchStart", {1: (lx, cy)})
        cdp_touch(cdp, "touchStart", {1: (lx, cy), 2: (rx, cy)})
        for i in range(1, 11):
            cdp_touch(cdp, "touchMove", {1: (lx, cy - 6 * i), 2: (rx + 8 * i, cy)})
            page.wait_for_timeout(50)
        z_mid = m3(page, "cameraZoom")
        cdp_touch(cdp, "touchEnd", {1: (lx, cy - 60)})
        cdp_touch(cdp, "touchEnd", {})
        page.wait_for_timeout(300)
        p1 = pos_of(page)
        y1 = m3(page, "yaw")
        z1 = m3(page, "cameraZoom")
        d1 = m3(page, "cameraIdealDistance")
        ok_c = moved(p0, p1) and abs(y1 - y0) > 0.1 and z0 == z_mid == z1 and d0 == d1
        details.append(
            f"c:moved={moved(p0, p1)} yaw {y0:.3f}->{y1:.3f} zoom {z0}->{z_mid}->{z1}"
        )

        # (e) 摇杆手指拖出画布后松开；(f) 同样用 touchCancel
        res = {}
        for kind in ["touchEnd", "touchCancel"]:
            face_open(page)
            cdp_touch(cdp, "touchStart", {1: (lx, cy)})
            for i in range(1, 6):
                cdp_touch(cdp, "touchMove", {1: (lx, cy - 8 * i)})
                page.wait_for_timeout(40)
            out_y = st["y"] + st["height"] + 50
            cdp_touch(cdp, "touchMove", {1: (lx, out_y)})
            page.wait_for_timeout(100)
            if kind == "touchEnd":
                cdp_touch(cdp, "touchEnd", {})
            else:
                cdp_touch(cdp, "touchCancel", {})
            page.wait_for_timeout(300)
            q1 = pos_of(page)
            page.wait_for_timeout(300)
            q2 = pos_of(page)
            res[kind] = (not moved(q1, q2)) and stick_hidden()
            regen()
            wait_idle(page)
        details.append(f"e/f:{res}")

        # (d) 页面不滚动
        scroll1 = page.evaluate("() => window.scrollY")
        details.append(f"d:scrollY {scroll0}->{scroll1}")

        # (g) 窄屏：stage 宽度 40% 处按下成为摇杆
        page.set_viewport_size({"width": 600, "height": 600})
        page.wait_for_timeout(300)
        st2 = stage_box(page)
        cdp_touch(
            cdp,
            "touchStart",
            {3: (st2["x"] + st2["width"] * 0.4, st2["y"] + st2["height"] / 2)},
        )
        page.wait_for_timeout(150)
        ok_g = not stick_hidden()
        cdp_touch(cdp, "touchEnd", {})
        details.append(f"g:stickAt40%={ok_g}")

        ok_err, msg = no_errors(errors)
        ok = (
            ok_a and ok_b and ok_c and all(res.values()) and scroll0 == scroll1 and ok_g
        )
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_f5(browser, base):
    """鼠标拖动改 yaw / pitch；滚轮缩放跟随距离，钳在 0.7×–1.5×。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        page.wait_for_timeout(300)
        st = stage_box(page)
        cx = st["x"] + st["width"] / 2
        cy = st["y"] + st["height"] / 2
        y0, p0 = m3(page, "yaw"), m3(page, "pitch")
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 100, cy + 50, steps=5)
        page.mouse.up()
        page.wait_for_timeout(200)
        y1, p1 = m3(page, "yaw"), m3(page, "pitch")
        pdeg = math.degrees(p1)
        ok_drag = (
            abs(y1 - y0) > 0.1
            and abs(p1 - p0) > 0.05
            and 15 - 1e-6 <= pdeg <= 75 + 1e-6
        )
        details.append(
            f"drag: yaw {y0:.3f}->{y1:.3f} pitch {math.degrees(p0):.1f}->{pdeg:.1f}deg"
        )
        for _ in range(10):
            page.mouse.wheel(0, 2000)
            page.wait_for_timeout(30)
        page.wait_for_timeout(1500)
        z_max = m3(page, "cameraZoom")
        d_max = m3(page, "cameraDistance")
        for _ in range(10):
            page.mouse.wheel(0, -2000)
            page.wait_for_timeout(30)
        page.wait_for_timeout(1500)
        z_min = m3(page, "cameraZoom")
        d_min = m3(page, "cameraDistance")
        scroll = page.evaluate("() => window.scrollY")
        details.append(
            f"wheel: zoom max={z_max} min={z_min} distance {d_max:.3f}/{d_min:.3f} scrollY={scroll}"
        )
        ok_err, msg = no_errors(errors)
        ok = ok_drag and z_max == 1.5 and z_min == 0.7 and d_max > d_min + 0.5
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def segment_hits_box(a, b, box, eps=1e-4):
    """线段 a→b 是否穿进（各面内缩 eps 的）盒子。"""
    t0, t1 = 0.0, 1.0
    for k in ["x", "y", "z"]:
        lo = box["min" + k.upper()] + eps
        hi = box["max" + k.upper()] - eps
        d = b[k] - a[k]
        if abs(d) < 1e-12:
            if a[k] <= lo or a[k] >= hi:
                return False
            continue
        u0 = (lo - a[k]) / d
        u1 = (hi - a[k]) / d
        if u0 > u1:
            u0, u1 = u1, u0
        t0 = max(t0, u0)
        t1 = min(t1, u1)
        if t0 >= t1:
            return False
    return True


def point_in_box(p, box, eps=1e-4):
    return all(
        box["min" + k.upper()] + eps < p[k] < box["max" + k.upper()] - eps
        for k in "xyz"
    )


CAMERA_MIN_DIST = 1.5  # 与 movement.js 一致：收近到这以下时改为抬高俯角
LOOK_AHEAD = 1.5  # 与 effects.js 一致：跟随视角观察点在小人前方的格数


def follow_camera_pos(target, yaw, pitch, dist):
    """与 movement.js followCameraPos 相同的公式（Python 独立实现）。"""
    h = math.cos(pitch) * dist
    return {
        "x": target["x"] - math.sin(yaw) * h,
        "y": target["y"] + math.sin(pitch) * dist,
        "z": target["z"] + math.cos(yaw) * h,
    }


def find_lookahead_wall_cell(page):
    """从 (0,0) 按 BFS 找最近的、有内部墙且面朝墙时前瞻点不落进任何墙盒的格子，走到格心，
    返回墙的方向名。前瞻点取格心沿墙方向 1.2–1.8 格（覆盖格心与贴墙两种站位）。"""
    cands = logic(
        page,
        """(() => {
          const out = [];
          const seen = new Set(['0,0']);
          const q = [{ row: 0, col: 0 }];
          for (let i = 0; i < q.length; i++) {
            const p = q[i];
            for (const [name, [dr, dc]] of Object.entries(L.DIRS)) {
              const n = { row: p.row + dr, col: p.col + dc };
              const inside = n.row >= 0 && n.row < M.size && n.col >= 0 && n.col < M.size;
              if (inside && !L.canMove(M.connections, p, n)) out.push({ row: p.row, col: p.col, d: name });
              if (!L.canMove(M.connections, p, n) || seen.has(n.row + ',' + n.col)) continue;
              seen.add(n.row + ',' + n.col);
              q.push(n);
            }
          }
          return out;
        })()""",
    )
    boxes = m3(page, "wallBoxes3d")
    for c in cands:
        dr, dc = DIRS[c["d"]]
        free = True
        for i in range(13):
            k = 1.2 + 0.05 * i
            pt = {"x": c["col"] + 0.5 + dc * k, "y": 0.4, "z": c["row"] + 0.5 + dr * k}
            if any(point_in_box(pt, b, eps=-0.05) for b in boxes):
                free = False
                break
        if free:
            if not walk_to(page, c["row"], c["col"]):
                return None
            return c["d"]
    return None


def low_pitch_wall_view(page, yaw, shot):
    """俯角 15°、转到 yaw，等稳定后检查相机：线段不穿墙、不在盒内、俯角被抬高、距离可用。
    前提：15° 俯角、理想距离下观察点（前瞻点）到相机的连线确实被墙挡（blocked15），
    否则「必须抬高」无从谈起，直接判 FAIL。"""
    set_test_input(page, yaw=yaw, pitch=math.radians(15))
    page.wait_for_timeout(1500)
    target = m3(page, "cameraTarget")
    cam = m3(page, "cameraPos")
    boxes = m3(page, "wallBoxes3d")
    dist = m3(page, "cameraDistance")
    ideal = m3(page, "cameraIdealDistance")
    cam_pitch = m3(page, "cameraPitch")
    ideal15 = follow_camera_pos(target, yaw, math.radians(15), ideal)
    blocked15 = any(segment_hits_box(target, ideal15, b) for b in boxes)
    # 前瞻点落在墙盒外：否则连线从观察点出发就在盒内，「不穿墙」无从判断
    target_free = not any(point_in_box(target, b) for b in boxes)
    hits = [b for b in boxes if segment_hits_box(target, cam, b)]
    inside_box = [b for b in boxes if point_in_box(cam, b)]
    colors = m3(page, "sampleDistinctColors()")
    canvas_image(page).save(SHOTS / shot)
    usable = dist >= 0.98 * min(ideal, CAMERA_MIN_DIST)
    lifted = cam_pitch > math.radians(15) + 1e-6
    ok = blocked15 and target_free and not hits and not inside_box and usable and lifted
    detail = (
        f"distance={dist:.3f} ideal={ideal:.3f} camPitch={math.degrees(cam_pitch):.1f}"
        f" hits={len(hits)} camInside={len(inside_box)} colors={colors}"
        f" blocked15={blocked15} targetFree={target_free}"
        f" target=({target['x']:.3f},{target['y']:.3f},{target['z']:.3f})"
    )
    return ok, detail


def check_f6(browser, base):
    """跟随视角低俯角：格心面朝墙（前瞻点越过墙）与面朝墙贴墙两处，相机都抬高俯角从墙顶
    看过去，线段不穿墙、距离不小于 CAMERA_MIN_DIST（小人不占满画面）；两处都先断言 15° 时
    观察点到相机的连线确实被墙挡、前瞻点不在墙盒内；格心 60° 俯角本来就看得过去，不拉近。
    贴墙改为面朝墙前进：观察点移到前瞻点后，背对墙贴墙时观察点离墙约 1.83 格，15° 收近
    距离仍 ≥ CAMERA_MIN_DIST，不需要抬高，原前提不成立。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
    )
    details = []
    try:
        wait_idle(page)
        d = find_lookahead_wall_cell(page)
        if d is None:
            return False, "no wall cell"
        face = DIR_YAW[d]
        # 格心面朝墙：前瞻点越过墙，相机→观察点连线穿过这面墙
        # （背对墙时观察点离墙 2.0 格，15° 连线在墙处高于墙盒顶，前提不成立）
        ok_center, msg = low_pitch_wall_view(page, face, "follow-lowpitch-wall.png")
        details.append(f"center pitch15 wall={d}: {msg}")
        set_test_input(page, pitch=math.radians(60))
        page.wait_for_timeout(1500)
        dist60 = m3(page, "cameraDistance")
        ideal60 = m3(page, "cameraIdealDistance")
        ok_high = dist60 >= 0.98 * ideal60
        details.append(f"center pitch60: distance={dist60:.3f} ideal={ideal60:.3f}")
        # 面朝墙前进 1 秒，贴到墙上
        p0 = m3(page, "playerPos")
        set_test_input(page, forward=1, yaw=face, pitch=math.radians(15))
        page.wait_for_timeout(1000)
        p1 = m3(page, "playerPos")
        ok_hug, msg = low_pitch_wall_view(page, face, "follow-lowpitch-hug.png")
        set_test_input(page)
        moved_back = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
        details.append(f"hug moved={moved_back:.3f} pitch15: {msg}")
        ok_err, msg = no_errors(errors)
        ok = ok_center and ok_high and ok_hug and moved_back > 0.1
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_f10(browser, base):
    """起点格的跟随视角不被不渲染的入口封口拉近：a. 默认开局（yaw = 3π/4，相机在西北角外）；
    b. 原「朝南、相机在北侧入口外」前提（yaw = π）。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        page.wait_for_timeout(500)
        dist = m3(page, "cameraDistance")
        ideal = m3(page, "cameraIdealDistance")
        ok_a = dist >= 0.98 * ideal
        set_test_input(page, yaw=math.pi)
        set_test_input(page)
        page.wait_for_timeout(1500)
        dist_s = m3(page, "cameraDistance")
        ideal_s = m3(page, "cameraIdealDistance")
        ok_b = dist_s >= 0.98 * ideal_s
        ok_err, msg = no_errors(errors)
        return (
            ok_a and ok_b and ok_err,
            f"start distance={dist:.3f} ideal={ideal:.3f}"
            f" south distance={dist_s:.3f} ideal={ideal_s:.3f} {msg}".strip(),
        )
    finally:
        close(page)


def check_f7(browser, base):
    """胜利后仍按住 w 点「再来一局」：小人留在起点不动（自动重复也不行），重新按键才走。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        if not walk_to_exit(page):
            return False, "did not win"
        page.keyboard.down("w")
        page.click("#again-btn")
        seen = hold_still_with_repeats(page)
        still = all(abs(p["x"] - 0.5) < 1e-9 and abs(p["z"] - 0.5) < 1e-9 for p in seen)
        page.keyboard.up("w")
        face_open(page)
        start = pos_of(page)
        page.keyboard.down("w")
        page.wait_for_timeout(300)
        page.keyboard.up("w")
        resumed = moved(start, pos_of(page))
        ok_err, msg = no_errors(errors)
        ok = still and resumed and m3(page, "state") == "idle"
        return (
            ok and ok_err,
            f"still={still} samples={len(seen)} resumed={resumed} {msg}".strip(),
        )
    finally:
        close(page)


def check_f8(browser, base):
    """走进距起点 ≥ 3 格的格子：显示格与所在格一致，迷雾按新格计算。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        cell = logic(
            page,
            """(() => {
              const dist = new Map([['0,0', 0]]);
              const q = [{ row: 0, col: 0 }];
              for (let i = 0; i < q.length; i++) {
                const p = q[i];
                const dp = dist.get(p.row + ',' + p.col);
                if (dp >= 3) return p;
                for (const [dr, dc] of Object.values(L.DIRS)) {
                  const n = { row: p.row + dr, col: p.col + dc };
                  if (!L.canMove(M.connections, p, n) || dist.has(n.row + ',' + n.col)) continue;
                  dist.set(n.row + ',' + n.col, dp + 1);
                  q.push(n);
                }
              }
              return null;
            })()""",
        )
        arrived = walk_to(page, cell["row"], cell["col"])
        disp = m3(page, "display")
        pc = m3(page, "playerCell")
        r = logic_themes(page, FOG_STATE_JS, m3(page, "fog")["radius"])
        ok_err, msg = no_errors(errors)
        ok = (
            arrived
            and disp == pc == cell
            and r["wallMismatch"] == 0
            and r["floorMismatch"] == 0
        )
        return (
            ok and ok_err,
            f"target={cell} display={disp} cell={pc} {r} {msg}".strip(),
        )
    finally:
        close(page)


def check_f9(browser, base):
    """依次切视角、切主题、切尺寸、重新生成：无控制台错误，状态正常。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        steps = (
            ["#view-btn"]
            + [f"#theme-{t}" for t in THEME_IDS]
            + ["#size-20", "#regen-btn"]
        )
        for sel in steps:
            page.click(sel)
            page.wait_for_timeout(300)
        state = m3(page, "state")
        size = m3(page, "size")
        view = m3(page, "view")
        ok_err, msg = no_errors(errors)
        ok = ok_err and state == "idle" and size == 20 and view == "first"
        return ok, f"state={state} size={size} view={view} {msg}".strip()
    finally:
        close(page)


# ---------------------------------------------------------------- runner

# ---------------------------------------------------------------- ground / fog


CANVAS_SEL = "#stage > canvas:not(#minimap)"


def hex_rgb(h):
    if isinstance(h, str):
        h = int(h.lstrip("#"), 16)
    return ((h >> 16) & 255, (h >> 8) & 255, h & 255)


def theme_colors(page, tid):
    """主题的天空上下色与雾色，均为 (r, g, b)。"""
    t = themes_mod(
        page,
        "({ top: T.THEMES[arg].sky.top, bottom: T.THEMES[arg].sky.bottom,"
        " fog: T.THEMES[arg].fogColor })",
        tid,
    )
    return {k: hex_rgb(v) for k, v in t.items()}


def seg_dist(p, a, b):
    """RGB 空间里点 p 到线段 ab 的距离。"""
    ab = [y - x for x, y in zip(a, b)]
    ap = [y - x for x, y in zip(a, p)]
    len2 = sum(v * v for v in ab)
    t = 0 if len2 == 0 else sum(u * v for u, v in zip(ab, ap)) / len2
    t = max(0.0, min(1.0, t))
    return sum((pp - (aa + u * t)) ** 2 for pp, aa, u in zip(p, a, ab)) ** 0.5


def sky_dist(px, colors):
    return seg_dist(px, colors["top"], colors["bottom"])


def horizon_y(page, img, legacy=False):
    """地平线在截图中的像素行（可为负或超出高度）。legacy=True 时用 cameraPitch 与 fov 50（基线代码）。"""
    if legacy:
        st = page.evaluate(
            "() => ({ theta: window.__maze3d.cameraPitch, fov: 50,"
            f" h: document.querySelector('{CANVAS_SEL}').clientHeight }})"
        )
        theta = st["theta"]
    else:
        st = page.evaluate(
            "() => { const c = window.__maze3d.cameraState;"
            " return { fwd: c.forward, fov: c.fov,"
            f" h: document.querySelector('{CANVAS_SEL}').clientHeight }}; }}"
        )
        theta = math.asin(max(-1.0, min(1.0, -st["fwd"][1])))
    half = math.radians(st["fov"] / 2)
    y_css = st["h"] / 2 * (1 - math.tan(theta) / math.tan(half))
    return y_css * img.size[1] / st["h"]


def sky_fraction_below_horizon(img, hy, colors):
    """地平线以下区域 32×32 网格中与天空渐变色距离 ≤ 12 的占比；地平线在画面下方之外时返回 0。"""
    w, h = img.size
    top = max(0, int(math.ceil(hy)))
    if top >= h:
        return 0.0, 0
    px = img.load()
    n = 0
    sky = 0
    for i in range(32):
        for j in range(32):
            x = min(w - 1, int(w * (i + 0.5) / 32))
            y = min(h - 1, int(top + (h - top) * (j + 0.5) / 32))
            n += 1
            if sky_dist(px[x, y], colors) <= 12:
                sky += 1
    return sky / n, n


def check_g1(browser, base):
    """迷宫外有地面：各主题地平线以下与天空渐变同色的取样点占比 ≤ 10%。"""
    details = []
    all_ok = True
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=theme_init(tid),
        )
        try:
            wait_idle(page)
            page.wait_for_timeout(600)
            img = canvas_image(page)
            hy = horizon_y(page, img)
            frac, n = sky_fraction_below_horizon(img, hy, theme_colors(page, tid))
            ok_err, msg = no_errors(errors)
            ok = frac <= 0.10 and n > 0 and ok_err and m3(page, "theme") == tid
            all_ok = all_ok and ok
            details.append(
                f"{tid}(ok={ok}): horizon={hy:.0f} sky={frac:.1%} n={n} {msg}".strip()
            )
        finally:
            close(page)
    if BASELINE_ROOT:
        proc, bbase = start_server(BASELINE_ROOT)
        try:
            page, errors = open_page(
                browser,
                f"{bbase}{PAGE}?seed={S}&size=10&debug=1",
                viewport={"width": 1280, "height": 800},
                init_script=theme_init("garden"),
            )
            try:
                wait_idle(page)
                page.wait_for_timeout(600)
                img = canvas_image(page)
                hy = horizon_y(page, img, legacy=True)
                frac, n = sky_fraction_below_horizon(
                    img, hy, theme_colors(page, "garden")
                )
                details.append(f"baseline sky={frac:.1%} (garden, horizon={hy:.0f})")
            finally:
                close(page)
        finally:
            proc.terminate()
            proc.wait()
    return all_ok, " | ".join(details)


def sample_points(img, page, pts):
    """取样点（CSS px）各通道中位数。"""
    cw = page.evaluate(f"() => document.querySelector('{CANVAS_SEL}').clientWidth")
    ratio = img.size[0] / cw
    px = img.load()
    rgb = []
    for p in pts:
        x = min(img.size[0] - 1, max(0, int(p["x"] * ratio)))
        y = min(img.size[1] - 1, max(0, int(p["y"] * ratio)))
        rgb.append(px[x, y])
    return tuple(sorted(v[ch] for v in rgb)[len(rgb) // 2] for ch in range(3))


FOG_MATCH_JS = """(() => {
  const f = M.sceneFog;
  if (!f) return { ok: false, fog: null };
  const r = L.followFogRange(Math.max(M.cameraIdealDistance, M.cameraDistance), M.size, M.lookAhead);
  return {
    ok: Math.abs(f.near - r.near) < 1e-6 && Math.abs(f.far - r.far) < 1e-6,
    fog: f,
    want: r,
  };
})()"""


def check_g3(browser, base):
    """跟随视角距离雾：迷宫内不被染色；缩放、切视角后雾参数跟上。"""
    page, errors = open_page(
        browser,
        # slow=40 让自动降画质在取样前确定发生：否则软件渲染下可能在两次截图之间降画质，
        # 两张图的渲染设置不同，像素对比失真
        f"{base}{PAGE}?seed={S}&size=20&debug=1&slow=40",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("0", "5"),
    )
    details = []
    try:
        wait_idle(page)
        page.wait_for_function("() => window.__maze3d.quality === 'low'", timeout=10000)
        page.evaluate("() => window.__maze3d.setZoomForTest(1.5)")
        set_test_input(page, yaw=3 * math.pi / 4, pitch=math.radians(15))
        set_test_input(page)
        settle_camera(page)
        wait_camera_still(page)
        # 1. 关掉场景雾前后，迷宫最远角的地板颜色不变。低俯角下远角常被墙挡住，
        #    三个角都看不到时退而取离相机最远的可见地板格
        cell = None
        pts = None
        for r, c in [(19, 19), (19, 0), (0, 19)]:
            pts = m3(page, f"floorSamplePoints({r}, {c})")
            if pts:
                cell = (r, c)
                break
        if cell is None:
            far = page.evaluate(
                "() => { const M = window.__maze3d; const p = M.cameraPos;"
                " let best = null;"
                " for (let r = 0; r < M.size; r++) for (let c = 0; c < M.size; c++) {"
                "  const pts = M.floorSamplePoints(r, c); if (!pts.length) continue;"
                "  const d = Math.hypot(c + 0.5 - p.x, r + 0.5 - p.z);"
                "  if (!best || d > best.d) best = { r, c, d, pts }; }"
                " return best; }"
            )
            if far is None:
                return False, "no visible floor cell"
            cell = (far["r"], far["c"], "fallback")
            pts = far["pts"]
        # 迷宫物体所在像素：32×20 网格中 screenHitsScene 为真的点
        cw, chh = page.evaluate(
            f"() => {{ const c = document.querySelector('{CANVAS_SEL}');"
            " return [c.clientWidth, c.clientHeight]; }"
        )
        maze_pts = page.evaluate(
            "([w, h]) => { const out = [];"
            " for (let i = 0; i < 32; i++) for (let j = 0; j < 20; j++) {"
            "  const x = (w * (i + 0.5)) / 32, y = (h * (j + 0.5)) / 20;"
            "  if (window.__maze3d.screenHitsScene(x, y)) out.push({ x, y }); }"
            " return out; }",
            [cw, chh],
        )
        img_fog = canvas_image(page)
        with_fog = sample_points(img_fog, page, pts)
        page.evaluate("() => window.__maze3d.setSceneFogForTest(false)")
        page.wait_for_timeout(300)
        img_nofog = canvas_image(page)
        no_fog = sample_points(img_nofog, page, pts)
        page.evaluate("() => window.__maze3d.setSceneFogForTest(true)")
        d = rgb_dist(with_fog, no_fog)
        ratio = img_fog.size[0] / cw
        pf = img_fog.load()
        pn = img_nofog.load()
        changed = 0
        for q in maze_pts:
            x = min(img_fog.size[0] - 1, int(q["x"] * ratio))
            y = min(img_fog.size[1] - 1, int(q["y"] * ratio))
            if rgb_dist(pf[x, y], pn[x, y]) > 8:
                changed += 1
        details.append(
            f"1:cell={cell} fog={with_fog} nofog={no_fog} d={d:.1f}"
            f" mazePts={len(maze_pts)} changed={changed}"
        )
        if d > 8 or not maze_pts or changed > 0.02 * len(maze_pts):
            return False, " ".join(details)
        # 2. 雾参数与 followFogRange 一致，颜色是主题雾色
        r = logic(page, FOG_MATCH_JS)
        want_color = themes_mod(
            page,
            "'#' + T.THEMES[M.theme].fogColor.toString(16).padStart(6, '0')",
        )
        details.append(f"2:{r} color want {want_color}")
        if not r["ok"] or r["fog"]["color"] != want_color:
            return False, " ".join(details)
        # 3. 滚轮缩放后立即跟上
        box = page.locator(CANVAS_SEL).bounding_box()
        z0 = m3(page, "cameraZoom")
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.wheel(0, -400)
        page.wait_for_timeout(300)
        z1 = m3(page, "cameraZoom")
        r = logic(page, FOG_MATCH_JS)
        details.append(f"3:zoom {z0:.3f}->{z1:.3f} {r}")
        if abs(z1 - z0) < 1e-6 or not r["ok"]:
            return False, " ".join(details)
        # 4. 第一人称 near 0.5、far size×1.5（迷雾关）；切回跟随后还原
        page.click("#view-btn")
        page.wait_for_timeout(200)
        f = m3(page, "sceneFog")
        n = m3(page, "size")
        ok_first = (
            f is not None
            and abs(f["near"] - 0.5) < 1e-9
            and abs(f["far"] - n * 1.5) < 1e-9
        )
        page.click("#view-btn")
        page.wait_for_timeout(200)
        r = logic(page, FOG_MATCH_JS)
        details.append(f"4:first={f} ok={ok_first} back={r['ok']}")
        if not ok_first or not r["ok"]:
            return False, " ".join(details)
        ok, msg = no_errors(errors)
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


# 在页面里执行 action（'fog' 点开迷雾 / 'zoom' 一次拉到最近），随后逐帧记录
# 场景雾 near 与实际相机距离；返回违反「near ≥ 实际距离 + size×√2 + 前瞻量」的帧
FOG_TRANSITION_JS = """async (action) => {
  const M = window.__maze3d;
  const out = [];
  const rec = (tag) => {
    const f = M.sceneFog;
    const need = M.cameraDistance + M.size * Math.SQRT2 + M.lookAhead;
    out.push({ tag, near: f ? f.near : null, dist: M.cameraDistance, need });
  };
  if (action === 'fog') document.getElementById('fog-btn').click();
  else M.setZoomForTest(0.7);
  rec('sync');
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    rec('frame' + i);
  }
  const bad = out.filter((o) => o.near === null || o.near < o.need - 1e-6);
  return { n: out.length, bad: bad.slice(0, 3), badCount: bad.length,
           first: out[0], last: out[out.length - 1] };
}"""


def check_g3b(browser, base):
    """跟随视角相机平滑收近期间（开启小半径迷雾、快速拉近缩放），雾 near 每帧都覆盖整个迷宫。"""
    details = []
    for action in ("fog", "zoom"):
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=preset_storage("0" if action == "fog" else "1", "1"),
        )
        try:
            wait_idle(page)
            page.evaluate("() => window.__maze3d.setZoomForTest(1.5)")
            set_test_input(page, pitch=math.radians(40))
            set_test_input(page)
            settle_camera(page)
            wait_camera_still(page)
            r = page.evaluate(FOG_TRANSITION_JS, action)
            details.append(
                f"{action}:frames={r['n']} bad={r['badCount']} first={r['first']}"
                f" last={r['last']} sample={r['bad']}"
            )
            if r["badCount"] or r["first"]["dist"] <= r["last"]["dist"] + 1e-3:
                # 第二个条件确保确实经历了收近过渡，否则检查没测到要测的阶段
                return False, " ".join(details)
            ok, msg = no_errors(errors)
            if not ok:
                return False, " ".join(details) + " " + msg
        finally:
            close(page)
    return True, " ".join(details)


def ground_fog_far_max(size, zoom_max=1.5, look_ahead=LOOK_AHEAD):
    """与 game-logic.js groundFogFarMax 相同的公式（Python 独立实现）；跟随项含前瞻量
    look_ahead（前瞻观察点最多离开小人这么多格）。"""
    h = 3 + 0.8 * 10
    d = 2 + 0.6 * 10
    follow = math.hypot(h, d) * zoom_max + size * math.sqrt(2) + look_ahead + 25
    return max(follow, max(25.5, size * 1.5))


def ground_half_extent(fog_far_max, fov_deg, aspect):
    tan = math.tan(math.radians(fov_deg / 2))
    return math.ceil(fog_far_max * math.sqrt(1 + tan * tan * (1 + aspect * aspect))) + 2


def to_camera(view, p):
    """列主序 4×4 视图矩阵把世界点 p 变换到相机空间。"""
    return [
        view[i] * p[0] + view[i + 4] * p[1] + view[i + 8] * p[2] + view[i + 12]
        for i in range(3)
    ]


def edge_min_depth(cam, seg):
    """世界线段 seg=(a, b) 裁剪到视锥后两端深度（−z）的较小值；与视锥无交集返回 None。"""
    a = to_camera(cam["view"], seg[0])
    b = to_camera(cam["view"], seg[1])
    tan = math.tan(math.radians(cam["fov"] / 2))
    asp = cam["aspect"]

    # 每个半空间写成 f(P) >= 0，f 在相机空间线性
    def planes(p):
        w = -p[2]
        return [
            w - cam["near"],
            cam["far"] - w,
            w * tan * asp - p[0],
            w * tan * asp + p[0],
            w * tan - p[1],
            w * tan + p[1],
        ]

    fa = planes(a)
    fb = planes(b)
    t0, t1 = 0.0, 1.0
    for va, vb in zip(fa, fb):
        if va < 0 and vb < 0:
            return None
        if va < 0:
            t0 = max(t0, va / (va - vb))
        elif vb < 0:
            t1 = min(t1, va / (va - vb))
        if t0 > t1:
            return None
    depth = lambda t: -(a[2] + (b[2] - a[2]) * t)  # noqa: E731
    return min(depth(t0), depth(t1))


def row_ground_depth(cam, ground_y, x_ndc, y_ndc):
    """屏幕一点的视线与地面平面交点的相机深度；不相交返回 None。"""
    tan = math.tan(math.radians(cam["fov"] / 2))
    v = [x_ndc * tan * cam["aspect"], y_ndc * tan, -1.0]
    view = cam["view"]
    # 世界方向 = 视图矩阵旋转部分的转置 × v
    dy = sum(view[1 * 4 + j] * v[j] for j in range(3))
    if abs(dy) < 1e-12:
        return None
    t = (ground_y - cam["pos"][1]) / dy
    return t if t > 0 else None


def check_g7(browser, base):
    """运行中改窗口比例（3:1）、改尺寸（10 → 20）后，任意角落、任意朝向都看不到外围地面的边缘。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("0", "5"),
    )
    details = []
    try:
        wait_idle(page)
        page.click("#size-20")
        page.wait_for_function("() => window.__maze3d.size === 20")
        wait_idle(page)
        page.set_viewport_size({"width": 1500, "height": 500})
        page.wait_for_timeout(300)
        page.evaluate(
            "() => { const s = document.getElementById('stage');"
            " s.style.width = '900px'; s.style.height = '300px'; }"
        )
        page.wait_for_timeout(300)
        cam = m3(page, "cameraState")
        details.append(f"aspect={cam['aspect']:.6f}")
        if abs(cam["aspect"] - 3) >= 1e-6:
            return False, " ".join(details)
        want_e = ground_half_extent(ground_fog_far_max(20), cam["fov"], cam["aspect"])
        page.evaluate("() => window.__maze3d.setZoomForTest(1.5)")
        colors = theme_colors(page, m3(page, "theme"))
        passed = 0
        sampled = 0
        fails = []
        extents = set()
        for row, col in [(0, 0), (0, 19), (19, 0), (19, 19)]:
            page.evaluate(f"() => window.__maze3d.teleportForTest({row}, {col})")
            for k in range(8):
                yaw_deg = 45 * k
                set_test_input(page, yaw=math.radians(yaw_deg), pitch=math.radians(15))
                set_test_input(page)
                page.wait_for_timeout(1200)
                st = page.evaluate(
                    "() => ({ g: window.__maze3d.ground, c: window.__maze3d.cameraState,"
                    " f: window.__maze3d.sceneFog })"
                )
                g, c, f = st["g"], st["c"], st["f"]
                extents.add(g["halfExtent"])
                tag = f"({row},{col})@{yaw_deg}"
                if f is None:
                    fails.append(f"{tag}:no fog")
                    continue
                e = g["halfExtent"]
                y = g["y"]
                x0, x1 = g["cx"] - e, g["cx"] + e
                z0, z1 = g["cz"] - e, g["cz"] + e
                edges = [
                    ((x0, y, z0), (x1, y, z0)),
                    ((x0, y, z1), (x1, y, z1)),
                    ((x0, y, z0), (x0, y, z1)),
                    ((x1, y, z0), (x1, y, z1)),
                ]
                depths = [edge_min_depth(c, s) for s in edges]
                seen = [d for d in depths if d is not None]
                min_depth = min(seen) if seen else None
                ok_edge = all(d >= f["far"] - 1e-6 for d in seen)
                # 左右 5% 竖条的中线：地平线下方到深度 = 雾终点之间应全是雾色
                img = canvas_image(page)
                hy = horizon_y(page, img)
                w_img, h_img = img.size
                ch_css = page.evaluate(
                    f"() => document.querySelector('{CANVAS_SEL}').clientHeight"
                )
                ratio = h_img / ch_css
                px = img.load()
                samples = 0
                worst = 0.0
                for frac in (0.025, 0.975):
                    x_img = min(w_img - 1, int(w_img * frac))
                    x_ndc = frac * 2 - 1
                    yy = max(0, int(math.ceil(hy + 2)))
                    while yy < h_img:
                        y_ndc = 1 - (yy / ratio) / ch_css * 2
                        dep = row_ground_depth(c, y, x_ndc, y_ndc)
                        if dep is None or dep < f["far"]:
                            break
                        worst = max(worst, rgb_dist(px[x_img, yy], colors["fog"]))
                        samples += 1
                        yy += 4
                # 身后有墙时 liftPitch 会把俯角抬到 50°–75°，地平线与所有「深度 ≥ 雾终点」的行
                # 都在画面外，这类状态没有可取样的行，只做边缘深度判定
                if samples:
                    sampled += 1
                ok_px = worst <= 8
                if ok_edge and ok_px:
                    passed += 1
                else:
                    md = "None" if min_depth is None else f"{min_depth:.1f}"
                    fails.append(
                        f"{tag}:minDepth={md} far={f['far']:.1f}"
                        f" samples={samples} worst={worst:.1f}"
                    )
        details.append(
            f"states={passed}/32 sampled={sampled}/32"
            f" halfExtent={sorted(extents)} want={want_e}"
        )
        if fails:
            details.append("fails=" + "; ".join(fails[:8]))
        ok_err, msg = no_errors(errors)
        ok = passed == 32 and sampled >= 8 and extents == {want_e} and ok_err
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


G8_STATES = [
    ("follow15", "follow", 15),
    ("follow40", "follow", 40),
    ("first0", "first", 0),
    ("firstUp20", "first", 20),
    ("firstDown20", "first", -20),
]


def wait_camera_still(page, timeout=5000):
    """等相机位置与朝向连续 3 次读数（间隔 100ms）都不再变化（相机平滑收敛）。"""
    page.wait_for_function(
        "() => { const c = window.__maze3d.cameraState;"
        " const v = [...c.pos, ...c.forward];"
        " const w = window.__camStill || (window.__camStill = { last: null, n: 0 });"
        " const same = w.last && v.every((x, i) => Math.abs(x - w.last[i]) < 1e-4);"
        " w.n = same ? w.n + 1 : 0; w.last = v;"
        " if (w.n >= 3) { window.__camStill = null; return true; }"
        " return false; }",
        timeout=timeout,
        polling=100,
    )


def check_g8(browser, base):
    """地平线上下各 3px 颜色连续，没有色带接缝。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    details = []
    all_ok = True
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=theme_init(tid) + preset_storage("1", "1"),
        )
        notes = []
        ok_theme = True
        try:
            wait_idle(page)
            page.evaluate("() => window.__maze3d.teleportForTest(0, 0)")
            for name, view, deg in G8_STATES:
                if m3(page, "view") != view:
                    page.click("#view-btn")
                # 正值向下看
                set_test_input(page, yaw=0.0, pitch=math.radians(deg))
                set_test_input(page)
                # 传送与改视角后相机要平滑收敛；没收敛就截图，地平线位置与截图对不上
                wait_camera_still(page)
                page.wait_for_timeout(400)
                img = canvas_image(page)
                img.save(SHOTS / f"horizon-{tid}-{name}.png")
                hy = horizon_y(page, img)
                h = img.size[1]
                if hy - 3 < 0 or hy + 3 >= h:
                    notes.append(f"{name}:offscreen({hy:.0f})")
                    continue
                cw, ch = page.evaluate(
                    f"() => {{ const c = document.querySelector('{CANVAS_SEL}');"
                    " return [c.clientWidth, c.clientHeight]; }"
                )
                ratio = img.size[0] / cw
                px = img.load()
                cols = 0
                worst = 0.0
                for i in range(16):
                    x_css = cw * (i + 0.5) / 16
                    ya = (hy - 3) / ratio
                    yb = (hy + 3) / ratio
                    hit = page.evaluate(
                        "([x, ya, yb]) => window.__maze3d.screenHitsScene(x, ya)"
                        " || window.__maze3d.screenHitsScene(x, yb)",
                        [x_css, ya, yb],
                    )
                    if hit:
                        continue
                    x = min(img.size[0] - 1, int(x_css * ratio))
                    d = rgb_dist(px[x, int(hy - 3)], px[x, int(hy + 3)])
                    worst = max(worst, d)
                    cols += 1
                ok = cols >= 4 and worst <= 8
                ok_theme = ok_theme and ok
                notes.append(f"{name}:y={hy:.0f} cols={cols} worst={worst:.1f}")
            ok_err, msg = no_errors(errors)
            ok_theme = ok_theme and ok_err
            all_ok = all_ok and ok_theme
            details.append(f"{tid}(ok={ok_theme}): {' '.join(notes)} {msg}".strip())
        finally:
            close(page)
    return all_ok, " | ".join(details)


# ---------------------------------------------------------------- polish（画面打磨）

MAZE_FRACTION_JS = """() => {
  const c = document.querySelector('#stage > canvas:not(#minimap)');
  const w = c.clientWidth;
  const h = c.clientHeight;
  let hit = 0;
  for (let i = 0; i < 16; i++) {
    for (let j = 0; j < 16; j++) {
      const x = w * (0.2 + (0.6 * (i + 0.5)) / 16);
      const y = h * (0.2 + (0.6 * (j + 0.5)) / 16);
      if (window.__maze3d.screenHitsScene(x, y)) hit += 1;
    }
  }
  return hit / 256;
}"""


def maze_fraction(page):
    """canvas 中心 60% 区域 16×16 网格点里落在迷宫物体上的比例。"""
    return page.evaluate(MAZE_FRACTION_JS)


def p1_round(browser, base):
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("1", "5"),
    )
    try:
        wait_idle(page)
        page.wait_for_timeout(600)
        return {
            "view": m3(page, "view"),
            "yaw": m3(page, "yaw"),
            "startYaw": page.evaluate("() => window.__maze3d.startYaw"),
            "frac": maze_fraction(page),
            "errors": errors,
        }
    finally:
        close(page)


def check_p1(browser, base):
    """开局跟随视角朝迷宫中心：yaw = startYaw = 3π/4，画面中心 60% 区域至少一半是迷宫。"""
    r = p1_round(browser, base)
    want = 3 * math.pi / 4
    ok = (
        r["view"] == "follow"
        and abs(r["yaw"] - want) < 1e-9
        and r["startYaw"] is not None
        and abs(r["startYaw"] - want) < 1e-9
        and r["frac"] >= 0.5
    )
    ok_err, msg = no_errors(r["errors"])
    detail = (
        f"view={r['view']} yaw={r['yaw']:.4f} startYaw={r['startYaw']}"
        f" frac={r['frac']:.0%}"
    )
    if BASELINE_ROOT:
        proc, bbase = start_server(BASELINE_ROOT)
        try:
            b = p1_round(browser, bbase)
        finally:
            proc.terminate()
            proc.wait()
        detail += f" baseline frac={b['frac']:.0%} (baseline yaw={b['yaw']:.4f})"
    return ok and ok_err, (detail + " " + msg).strip()


RECORD_SHADOW_JS = """(ms) => {
  window.__rec = { values: [], done: false };
  const t0 = performance.now();
  const tick = () => {
    const M = window.__maze3d;
    window.__rec.values.push({ s: M.shadow, p: M.playerPos });
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else window.__rec.done = true;
  };
  requestAnimationFrame(tick);
}"""


def check_p2(browser, base):
    """小人脚下阴影：走动中每帧位置跟随小人（误差 ≤ 0.01）且可见；第一人称隐藏，切回显示；
    阴影纹理不计入主题纹理数。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("0", "5"),
    )
    details = []
    try:
        wait_idle(page)
        d = open_dir(page)
        dr, dc = DIRS[d]
        page.evaluate(RECORD_SHADOW_JS, 3000)
        ok_walk = walk_to(page, dr, dc)
        page.wait_for_function("() => window.__rec.done", timeout=15000)
        rec = page.evaluate("() => window.__rec.values")
        errs = [
            math.hypot(r["s"]["x"] - r["p"]["x"], r["s"]["z"] - r["p"]["z"])
            for r in rec
        ]
        worst = max(errs) if errs else float("inf")
        all_vis = all(r["s"]["visible"] for r in rec)
        p_first = rec[0]["p"] if rec else None
        p_last = rec[-1]["p"] if rec else None
        travelled = (
            math.hypot(p_last["x"] - p_first["x"], p_last["z"] - p_first["z"])
            if rec
            else 0
        )
        details.append(
            f"dir={d} walk={ok_walk} frames={len(rec)} worst={worst:.4f}"
            f" visible={all_vis} travelled={travelled:.2f}"
        )
        page.click("#view-btn")
        page.wait_for_timeout(200)
        vis_first = m3(page, "shadow")["visible"]
        page.click("#view-btn")
        page.wait_for_timeout(200)
        vis_back = m3(page, "shadow")["visible"]
        tex = m3(page, "textureCount")
        details.append(f"first={vis_first} back={vis_back} textureCount={tex}")
        ok_err, msg = no_errors(errors)
        ok = (
            ok_walk
            and len(rec) > 10
            and travelled > 0.5
            and worst <= 0.01
            and all_vis
            and vis_first is False
            and vis_back is True
            and tex == 5
        )
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_p3(browser, base):
    """墙脚暗边：实例数等于 wallFootStrips 的条数；每条暗边与所属墙段同显同隐（迷雾开时有隐有显，
    关雾后全部显示）；暗边纹理不计入主题纹理数。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("1", "1"),
    )
    details = []
    try:
        wait_idle(page)
        count = m3(page, "footStripCount")
        want = page.evaluate(
            "async () => { const E = await import('/maze-3d/effects.js');"
            " return E.wallFootStrips(window.__maze3d.segments).length; }"
        )
        st = page.evaluate("() => window.__maze3d.footStripsVisible()")
        wv = page.evaluate("() => window.__maze3d.wallsVisible()")
        match = all(x["visible"] == wv[x["seg"]] for x in st)
        n_vis = sum(1 for x in st if x["visible"])
        n_hid = len(st) - n_vis
        details.append(
            f"count={count} want={want} fogOn: match={match} visible={n_vis} hidden={n_hid}"
        )
        page.click("#fog-btn")
        page.wait_for_function("() => !window.__maze3d.fog.on")
        st2 = page.evaluate("() => window.__maze3d.footStripsVisible()")
        all_vis = all(x["visible"] for x in st2)
        tex = m3(page, "textureCount")
        details.append(f"fogOff: allVisible={all_vis} textureCount={tex}")
        ok_err, msg = no_errors(errors)
        ok = (
            count == want
            and len(st) == count
            and match
            and n_vis > 0
            and n_hid > 0
            and all_vis
            and tex == 5
        )
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


BEAM_RADIUS = 0.35  # 与 effects.js 一致
# 光柱区域亮度差至少比基线（没有光柱）高这么多。实测（SwiftShader，garden，格 (6, 2)）：
# diff≈22.0，diff_base≈−0.1；取 10，留出主题与渲染差异的余量
BEAM_LUMA_MARGIN = 10


def project_css(cam, p, cw, ch):
    """用 cameraState 的 view（列主序）、fov、aspect 把世界点 p 投影成相对 canvas 左上角的
    CSS 像素 (x, y)；在近裁剪面以内或相机背后返回 None。"""
    v = to_camera(cam["view"], p)
    depth = -v[2]
    if depth <= cam["near"]:
        return None
    f = 1 / math.tan(math.radians(cam["fov"] / 2))
    nx = (f / cam["aspect"]) * v[0] / depth
    ny = f * v[1] / depth
    return ((nx + 1) / 2 * cw, (1 - ny) / 2 * ch)


def region_luma(img, ratio, x0, y0, x1, y1):
    """CSS 像素矩形 [x0, x1] × [y0, y1] 内的平均亮度。"""
    px = img.load()
    w, h = img.size
    xa, xb = max(0, int(x0 * ratio)), min(w - 1, int(math.ceil(x1 * ratio)))
    ya, yb = max(0, int(y0 * ratio)), min(h - 1, int(math.ceil(y1 * ratio)))
    total = 0.0
    n = 0
    for y in range(ya, yb + 1):
        for x in range(xa, xb + 1):
            r, g, b = px[x, y]
            total += 0.299 * r + 0.587 * g + 0.114 * b
            n += 1
    return total / n if n else float("nan")


def end_yaw_from(row, col, size=10):
    """从格 (row, col) 中心指向终点格中心的 yaw。"""
    dx = (size - 0.5) - (col + 0.5)
    dz = (size - 0.5) - (row + 0.5)
    return math.atan2(dx, -dz)


def beam_view_setup(page, row, col):
    """小人传送到 (row, col)，跟随视角 15° 俯角朝终点，暂停光柱动画（基线没有该钩子就跳过），
    等相机静止；返回 (cameraState, canvas CSS 宽, 高)。"""
    page.evaluate(f"() => window.__maze3d.teleportForTest({row}, {col})")
    set_test_input(page, yaw=end_yaw_from(row, col), pitch=math.radians(15))
    set_test_input(page)
    page.evaluate(
        "() => { const M = window.__maze3d;"
        " if (typeof M.setBeamForTest === 'function') M.setBeamForTest({ paused: true }); }"
    )
    wait_camera_still(page)
    cam = m3(page, "cameraState")
    cw, ch = page.evaluate(
        "() => { const c = document.querySelector('#stage > canvas:not(#minimap)');"
        " return [c.clientWidth, c.clientHeight]; }"
    )
    return cam, cw, ch


def beam_rect(cam, cw, ch):
    """终点格中心上方 1.5–3 的光柱段投影成的 CSS 矩形 (x0, y0, x1, y1)，半宽取
    max(3, 光柱半径在该深度的投影像素)；在相机背后返回 None。"""
    top = project_css(cam, (9.5, 3.0, 9.5), cw, ch)
    bot = project_css(cam, (9.5, 1.5, 9.5), cw, ch)
    if top is None or bot is None:
        return None
    mid = to_camera(cam["view"], (9.5, 2.25, 9.5))
    f = 1 / math.tan(math.radians(cam["fov"] / 2))
    half = max(3.0, BEAM_RADIUS * f / (-mid[2]) * ch / 2)
    cx = (top[0] + bot[0]) / 2
    return (cx - half, min(top[1], bot[1]), cx + half, max(top[1], bot[1]))


def find_beam_cell(page, cell=None):
    """cell 为 None 时在距终点 Chebyshev 2–8 的格里由远到近找第一个「跟随视角 15° 朝终点时，
    光柱 1.5–3 段及左右对照区都在画面内」的格（按投影计算，不依赖提示逻辑）；返回
    (格, 光柱矩形, canvas CSS 宽)，找不到返回 (None, None, None)。页面停在该格的朝终点状态。"""
    if cell is None:
        cands = sorted(
            (
                (r, c)
                for r in range(10)
                for c in range(10)
                if 2 <= max(9 - r, 9 - c) <= 8
            ),
            key=lambda rc: -math.hypot(9 - rc[0], 9 - rc[1]),
        )
    else:
        cands = [tuple(cell)]
    for rc in cands:
        cam, cw, ch = beam_view_setup(page, *rc)
        rect = beam_rect(cam, cw, ch)
        if rect is None:
            continue
        w = rect[2] - rect[0]
        inside = (
            rect[0] - 2 * w >= 0
            and rect[2] + 2 * w <= cw
            and rect[1] >= 0
            and rect[3] <= ch
        )
        if inside or cell is not None:
            return rc, rect, cw
    return None, None, None


def beam_view_round(browser, base, cell=None, shot=None):
    """p4a 的场景：迷雾开、视野 1（终点在迷雾外），跟随视角 15° 俯角朝终点。cell 为 None 时
    在距终点 Chebyshev 2–8 的格里由远到近找第一个「光柱 1.5–3 段及左右对照区都在画面内」的格
    （从起点看过去俯角会被 liftPitch 抬高，光柱出画）。返回光柱投影区域与左右相邻同尺寸区域的
    亮度差、所用的格与提示状态。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("1", "1"),
    )
    try:
        wait_idle(page)
        chosen, rect, cw = find_beam_cell(page, cell)
        if chosen is None:
            return {"ok": False, "why": "no cell with beam in view", "errors": errors}
        img = canvas_image(page)
        if shot:
            img.save(SHOTS / shot)
        ratio = img.size[0] / cw
        x0, y0, x1, y1 = rect
        w = x1 - x0
        lum = region_luma(img, ratio, x0, y0, x1, y1)
        left = region_luma(img, ratio, x0 - 2 * w, y0, x1 - 2 * w, y1)
        right = region_luma(img, ratio, x0 + 2 * w, y0, x1 + 2 * w, y1)
        return {
            "ok": True,
            "cell": chosen,
            "diff": lum - max(left, right),
            "lum": lum,
            "left": left,
            "right": right,
            "rect": rect,
            "beamEnabled": page.evaluate("() => window.__maze3d.beamEnabled"),
            "endHint": page.evaluate("() => window.__maze3d.endHint"),
            "errors": errors,
        }
    finally:
        close(page)


def check_p4a(browser, base):
    """光柱在视锥内：迷雾开、终点在迷雾外，跟随视角朝终点；beamEnabled 为真，截图里光柱投影
    区域比左右相邻同尺寸区域亮，且亮度差比改动前（没有光柱）至少高 BEAM_LUMA_MARGIN。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    r = beam_view_round(browser, base, shot="polish-beam-view.png")
    if not r["ok"]:
        return False, r["why"]
    detail = (
        f"cell={r['cell']} beamEnabled={r['beamEnabled']} diff={r['diff']:.1f} lum={r['lum']:.1f}"
        f" left={r['left']:.1f} right={r['right']:.1f}"
        f" rect=({', '.join(f'{v:.0f}' for v in r['rect'])})"
    )
    hint = r["endHint"] or {}
    detail += f" endHint.mode={hint.get('mode')}"
    ok = r["beamEnabled"] is True and hint.get("mode") == "hidden"
    if BASELINE_ROOT:
        proc, bbase = start_server(BASELINE_ROOT)
        try:
            b = beam_view_round(browser, bbase, cell=r["cell"])
        finally:
            proc.terminate()
            proc.wait()
        if not b["ok"]:
            return False, detail + f" baseline: {b['why']}"
        detail += f" diff_base={b['diff']:.1f} margin={BEAM_LUMA_MARGIN}"
        ok = ok and r["diff"] >= b["diff"] + BEAM_LUMA_MARGIN
    else:
        ok = False
        detail += " (needs --baseline-root)"
    ok_err, msg = no_errors(r["errors"])
    return ok and ok_err, (detail + " " + msg).strip()


HINT_INSET = 28  # 与 effects.js 一致


def end_hint(page):
    return m3(page, "endHint")


def hint_dom(page):
    """两个提示元素的可见性、距离文字与 pointer-events。"""
    return page.evaluate(
        "() => { const out = {};"
        " for (const id of ['end-arrow', 'end-marker']) {"
        "  const el = document.getElementById(id);"
        "  const cs = getComputedStyle(el);"
        "  const kids = [...el.querySelectorAll('*')].map((k) => getComputedStyle(k).pointerEvents);"
        "  out[id] = { visible: !el.hidden && cs.display !== 'none', text: el.querySelector('.end-dist').textContent,"
        "   pe: cs.pointerEvents, kidsPe: kids }; }"
        " const st = document.getElementById('stage');"
        " out.W = st.clientWidth; out.H = st.clientHeight; return out; }"
    )


def hint_page(browser, base, on, radius):
    """1280×800、size=10、指定迷雾设置打开页面并等到 idle；返回 (page, errors)。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage(on, radius),
    )
    wait_idle(page)
    return page, errors


def wait_frames(page, n=2):
    page.evaluate(
        "(n) => new Promise((res) => { const f = (k) => k <= 0 ? res() :"
        " requestAnimationFrame(() => f(k - 1)); f(n); })",
        n,
    )


def back_to_end_state(page, row=0, col=0):
    """跟随视角，小人在 (row, col)，终点在右后方（yaw = yaw_e − (π − 0.8)）。等 300ms 后再等
    帧推进、相机静止（页面刚加载时头几百毫秒可能还没出新帧，读到的是旧状态）。"""
    page.evaluate(f"() => window.__maze3d.teleportForTest({row}, {col})")
    face_yaw(page, end_yaw_from(row, col) - (math.pi - 0.8))
    page.wait_for_timeout(300)
    wait_frames(page, 5)
    wait_camera_still(page)
    wait_frames(page)


def check_p4b(browser, base):
    """光柱在视锥外：跟随视角背对终点（终点在右后方）时，画面右侧边框出现箭头与「13 格」，
    标记不出现，光柱仍开着。"""
    page, errors = hint_page(browser, base, "1", "1")
    try:
        back_to_end_state(page)
        h = end_hint(page)
        dom = hint_dom(page)
        W = dom["W"]
        dist = round(math.hypot(9, 9))
        beam = m3(page, "beamEnabled")
        ok = (
            beam is True
            and h["mode"] == "edge"
            and h["x"] > W / 2
            and math.cos(h["angle"]) > 0
            and dom["end-arrow"]["visible"]
            and not dom["end-marker"]["visible"]
            and dom["end-arrow"]["text"] == f"{h['distance']} 格"
            and h["distance"] == dist == 13
        )
        detail = (
            f"beamEnabled={beam} endHint={h} W={W} arrow={dom['end-arrow']['visible']}"
            f" marker={dom['end-marker']['visible']} text={dom['end-arrow']['text']!r} want={dist}"
        )
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (detail + " " + msg).strip()
    finally:
        close(page)


def p5_hidden(browser, base):
    """a. 背对终点为 edge；转向终点使光柱可见后为 hidden，两个提示元素都不可见。
    起点格默认 40° 俯角朝终点时光柱整根在画面上沿之外（edge 是正确结果），所以先按 p4a 的
    投影规则找一个「15° 朝终点时光柱在画面内」的格作为前提。"""
    page, errors = hint_page(browser, base, "1", "1")
    try:
        cell, _, _ = find_beam_cell(page)
        if cell is None:
            return False, "a:no cell with beam in view", errors
        back_to_end_state(page, *cell)
        h0 = end_hint(page)
        set_test_input(page, yaw=end_yaw_from(*cell), pitch=math.radians(15))
        set_test_input(page)
        wait_frames(page, 5)
        wait_camera_still(page)
        wait_frames(page)
        m1 = end_hint(page)["mode"]
        dom = hint_dom(page)
        ok = (
            h0["mode"] == "edge"
            and math.cos(h0["angle"]) > 0
            and m1 == "hidden"
            and not dom["end-arrow"]["visible"]
            and not dom["end-marker"]["visible"]
        )
        return (
            ok,
            f"a:cell={cell} {h0['mode']}(angle={h0['angle']:.2f})->{m1}"
            f" arrow={dom['end-arrow']['visible']} marker={dom['end-marker']['visible']}",
            errors,
        )
    finally:
        close(page)


def p5_marker(browser, base):
    """b. 迷雾关、第一人称、pitch 0：由远到近找第一个终点被墙挡住但在画面内的格（marker），
    标记位置在内缩边框内，标记可见、箭头不可见。"""
    page, errors = hint_page(browser, base, "0", "5")
    try:
        page.click("#view-btn")
        cells = sorted(
            (
                (r, c)
                for r in range(10)
                for c in range(10)
                if math.hypot(9 - r, 9 - c) >= 5
            ),
            key=lambda rc: -math.hypot(9 - rc[0], 9 - rc[1]),
        )
        found = None
        tried = 0
        for r, c in cells:
            tried += 1
            page.evaluate(f"() => window.__maze3d.teleportForTest({r}, {c})")
            set_test_input(page, yaw=end_yaw_from(r, c), pitch=0)
            set_test_input(page)
            wait_frames(page)
            h = end_hint(page)
            if h["mode"] == "marker":
                found = ((r, c), h)
                break
        if not found:
            return False, f"b:no marker cell (tried {tried})", errors
        (cell, h) = found
        dom = hint_dom(page)
        W, H, I = dom["W"], dom["H"], HINT_INSET
        ok = (
            I <= h["x"] <= W - I
            and I <= h["y"] <= H - I
            and dom["end-marker"]["visible"]
            and not dom["end-arrow"]["visible"]
        )
        return (
            ok,
            f"b:cell={cell} tried={tried} endHint={h} W={W} H={H}"
            f" marker={dom['end-marker']['visible']} arrow={dom['end-arrow']['visible']}",
            errors,
        )
    finally:
        close(page)


def player_sight(page):
    """相机到小人身体中心、观察点高度的连线是否被看得见的墙挡住（与 effects.js 同一判定）。"""
    return page.evaluate(
        "async () => {"
        " const E = await import('/maze-3d/effects.js');"
        " const V = await import('/maze-3d/movement.js');"
        " const M = window.__maze3d;"
        " const vis = M.wallsVisible();"
        " const segs = M.segments.filter((_, i) => vis[i]);"
        " const boxes = V.wallBoxes3d(V.segmentBoxes(segs), V.WALL_HEIGHT, 0);"
        " const cam = M.cameraPos; const p = M.playerPos;"
        " const blocked = E.PLAYER_SIGHT_HEIGHTS.map((y) =>"
        "  E.segmentBlocked(cam, { x: p.x, y, z: p.z }, boxes));"
        " return { blocked, cam, ahead: M.lookAheadNow, max: M.lookAhead }; }"
    )


def check_p1b(browser, base):
    """评审 r1：前瞻不能让墙挡住小人。seed 12345、10×10、视野 1、(0,1)、yaw 225°、pitch 15°、
    缩放 0.7 时前瞻缩短、相机看得见小人；开局默认视角仍是完整前瞻。"""
    page, errors = hint_page(browser, base, "1", "1")
    try:
        wait_camera_still(page)
        start = player_sight(page)
        page.evaluate("() => window.__maze3d.teleportForTest(0, 1)")
        page.evaluate("() => window.__maze3d.setZoomForTest(0.7)")
        set_test_input(page, yaw=math.radians(225), pitch=math.radians(15))
        set_test_input(page)
        page.wait_for_timeout(300)
        wait_frames(page, 5)
        wait_camera_still(page)
        wait_frames(page)
        r = player_sight(page)
        ok = (
            start["ahead"] == start["max"]
            and not any(start["blocked"])
            and r["ahead"] < r["max"]
            and not any(r["blocked"])
        )
        cam = r["cam"]
        detail = (
            f"start: ahead={start['ahead']} blocked={start['blocked']}"
            f" | (0,1) yaw225 pitch15 zoom0.7: ahead={r['ahead']} blocked={r['blocked']}"
            f" cam=({cam['x']:.3f},{cam['y']:.3f},{cam['z']:.3f})"
        )
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (detail + " " + msg).strip()
    finally:
        close(page)


def check_p5m(browser, base):
    """评审 r1：第一人称时终点箭头不能落在右上角小地图上。起点格第一人称扫一圈 yaw × pitch，
    每个 edge 状态下箭头元素与小地图的矩形不相交；且至少有一次箭头是被移开的（原位置在小地图上）。"""
    page, errors = hint_page(browser, base, "0", "5")
    try:
        page.click("#view-btn")
        bad = []
        moved = 0
        edges = 0
        for yd in range(0, 360, 15):
            for pd in (30, 0, -30):
                set_test_input(page, yaw=math.radians(yd), pitch=math.radians(pd))
                wait_frames(page, 3)
                r = page.evaluate(
                    "() => { const M = window.__maze3d; const h = M.endHint;"
                    " const st = document.getElementById('stage').getBoundingClientRect();"
                    " const mm = document.getElementById('minimap');"
                    " const a = document.getElementById('end-arrow').getBoundingClientRect();"
                    " const m = mm.getBoundingClientRect();"
                    " const hit = !(a.right <= m.left || a.left >= m.right || a.bottom <= m.top || a.top >= m.bottom);"
                    " return { h, hit, mini: !mm.hidden,"
                    "  rect: { left: m.left - st.left, top: m.top - st.top, right: m.right - st.left, bottom: m.bottom - st.top } }; }"
                )
                h = r["h"]
                if h["mode"] != "edge":
                    continue
                edges += 1
                if r["hit"]:
                    bad.append((yd, pd, round(h["x"]), round(h["y"])))
                rc = r["rect"]
                if (
                    abs(h["y"] - (rc["bottom"] + HINT_INSET)) < 0.5
                    or abs(h["x"] - (rc["left"] - HINT_INSET)) < 0.5
                ):
                    moved += 1
        set_test_input(page)
        mini = page.is_visible("#minimap")
        ok = mini and edges > 0 and moved > 0 and not bad
        detail = f"minimap={mini} edges={edges} moved={moved} overlaps={bad[:5]}"
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (detail + " " + msg).strip()
    finally:
        close(page)


def pixels_changed(a, b, thresh=20):
    import numpy as np

    x = np.asarray(a, dtype=np.int32)
    y = np.asarray(b, dtype=np.int32)
    d = np.sqrt(((x - y) ** 2).sum(axis=2))
    return int((d >= thresh).sum())


def p5_consistency(browser, base):
    """c. 跟随视角、迷雾关、15° 俯角、缩放 0.7：对距终点 Chebyshev 2–4 的格（最多 12 个）朝终点，
    比较光柱开 / 关两张截图；「看得见光柱」（≥ 30 像素 RGB 距离 ≥ 20）必须与 mode == 'hidden' 一致。"""
    page, errors = hint_page(browser, base, "0", "5")
    try:
        page.evaluate("() => window.__maze3d.setZoomForTest(0.7)")
        cells = sorted(
            (
                (r, c)
                for r in range(10)
                for c in range(10)
                if 2 <= max(9 - r, 9 - c) <= 4
            ),
            key=lambda rc: (-max(9 - rc[0], 9 - rc[1]), rc),
        )[:12]
        ok = True
        rows = []
        counts = {"hidden": 0, "marker": 0, "edge": 0}
        for r, c in cells:
            page.evaluate(f"() => window.__maze3d.teleportForTest({r}, {c})")
            set_test_input(page, yaw=end_yaw_from(r, c), pitch=math.radians(15))
            set_test_input(page)
            wait_camera_still(page)
            page.evaluate("() => window.__maze3d.setBeamForTest({ paused: true })")
            wait_frames(page)
            mode = end_hint(page)["mode"]
            a = canvas_image(page)
            page.evaluate("() => window.__maze3d.setBeamForTest({ visible: false })")
            wait_frames(page)
            b = canvas_image(page)
            page.evaluate(
                "() => window.__maze3d.setBeamForTest({ visible: true, paused: false })"
            )
            n = pixels_changed(a, b)
            seen = n >= 30
            counts[mode] = counts.get(mode, 0) + 1
            good = (mode == "hidden") == seen
            ok = ok and good
            rows.append(f"({r},{c}):{mode}/{n}{'' if good else '!'}")
        return ok, f"c:{counts} " + " ".join(rows), errors
    finally:
        close(page)


def p5_cross_plane(browser, base):
    """d. 第一人称在起点原地拖动转三圈多：每帧箭头坐标与角度都有限，yaw 总变化 ≥ 2π。"""
    page, errors = hint_page(browser, base, "1", "1")
    try:
        page.click("#view-btn")
        page.evaluate("() => window.__maze3d.teleportForTest(0, 0)")
        box = stage_box(page)
        cx, cy = box["x"] + box["width"] / 2 - 225, box["y"] + box["height"] / 2
        y0 = m3(page, "yaw")

        def drag():
            for _ in range(3):
                page.mouse.move(cx, cy)
                page.mouse.down()
                page.mouse.move(cx + 450, cy, steps=30)
                page.mouse.up()
                page.mouse.move(cx, cy)

        vals = record_frames(page, "endHint", 6000, during=drag)
        y1 = m3(page, "yaw")
        bad = [
            v
            for v in vals
            if not all(
                isinstance(v.get(k), (int, float)) and math.isfinite(v[k])
                for k in ("x", "y", "angle")
            )
        ]
        modes = sorted({v["mode"] for v in vals})
        ok = len(vals) > 0 and not bad and abs(y1 - y0) >= 2 * math.pi
        return (
            ok,
            f"d:frames={len(vals)} bad={len(bad)} dyaw={y1 - y0:.2f} modes={modes}",
            errors,
        )
    finally:
        close(page)


def p5_pointer(browser, base):
    """e. 在箭头位置按下拖动 100px 仍能转视角；两个提示元素 pointer-events 都是 none。"""
    page, errors = hint_page(browser, base, "1", "1")
    try:
        back_to_end_state(page)
        h = end_hint(page)
        box = stage_box(page)
        px, py = box["x"] + h["x"], box["y"] + h["y"]
        y0 = m3(page, "yaw")
        page.mouse.move(px, py)
        page.mouse.down()
        page.mouse.move(px - 100, py, steps=10)
        page.mouse.up()
        page.wait_for_timeout(100)
        y1 = m3(page, "yaw")
        dom = hint_dom(page)
        pes = [dom[k]["pe"] for k in ("end-arrow", "end-marker")] + [
            x for k in ("end-arrow", "end-marker") for x in dom[k]["kidsPe"]
        ]
        ok = (
            h["mode"] == "edge"
            and abs(y1 - y0) >= 0.4
            and all(p == "none" for p in pes)
        )
        return (
            ok,
            f"e:mode={h['mode']} at=({px:.0f},{py:.0f}) dyaw={y1 - y0:.2f} pointerEvents={pes}",
            errors,
        )
    finally:
        close(page)


def check_p5(browser, base):
    """终点方向提示的各状态：a 转向终点后隐藏；b 被墙挡住时出标记；c 提示与截图里光柱
    是否看得见一致；d 第一人称原地转圈时箭头坐标始终有限；e 提示不挡指针。"""
    ok = True
    details = []
    errs = []
    for fn in (p5_hidden, p5_marker, p5_consistency, p5_cross_plane, p5_pointer):
        try:
            good, d, e = fn(browser, base)
        except Exception as exc:
            good, d, e = False, f"{fn.__name__}: {type(exc).__name__}: {exc}", []
        ok = ok and good
        details.append(("" if good else "FAIL ") + d)
        errs += e
    ok_err, msg = no_errors(errs)
    return ok and ok_err, (" | ".join(details) + " " + msg).strip()


WON_WATCH_JS = """() => {
  window.__wonWatch = { values: [], done: false, t0: null };
  const w = window.__wonWatch;
  const tick = () => {
    const M = window.__maze3d;
    if (M.state === 'won') {
      if (w.t0 === null) w.t0 = performance.now();
      w.values.push(M.confettiActive);
      if (performance.now() - w.t0 >= 600) { w.done = true; return; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}"""

CONFETTI_CLEAR_JS = """() => {
  const c = document.getElementById('confetti');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}"""


def check_p6(browser, base):
    """通关彩带：判胜时启动、约 3 秒内自己停；播放中途点「再来一局」立即停、画布清空、按钮
    可点；系统开启「减少动态效果」时不播放。"""
    details = []
    ok = True
    errs = []
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        # 1. 判胜启动，3.5 秒内停
        if not walk_to_exit(page):
            return False, "1:did not win"
        active = m3(page, "confettiActive")
        t0 = time.time()
        stopped = True
        try:
            page.wait_for_function(
                "() => !window.__maze3d.confettiActive", timeout=3500
            )
        except Exception:
            stopped = False
        took = time.time() - t0
        clear1 = page.evaluate(CONFETTI_CLEAR_JS)
        good = active is True and stopped and took <= 3.5 and clear1
        ok = ok and good
        details.append(
            f"1:active={active} stopped={stopped} took={took:.2f}s clear={clear1}"
        )

        # 2. 播放中途点「再来一局」
        page.click("#again-btn")
        wait_idle(page)
        if not walk_to_exit(page):
            return False, " ".join(details) + " 2:did not win"
        t_win = time.time()
        hit = page.evaluate(
            "() => { const b = document.getElementById('again-btn').getBoundingClientRect();"
            " const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);"
            " return !!el && (el.id === 'again-btn' || !!el.closest('#again-btn')); }"
        )
        active2 = m3(page, "confettiActive")
        within = time.time() - t_win
        page.click("#again-btn")
        after = page.evaluate(
            "() => ({ active: window.__maze3d.confettiActive,"
            " winHidden: document.getElementById('win').hidden })"
        )
        clear2 = page.evaluate(CONFETTI_CLEAR_JS)
        good = (
            hit
            and active2 is True
            and after["active"] is False
            and after["winHidden"]
            and clear2
        )
        ok = ok and good
        details.append(
            f"2:hit={hit} activeBefore={active2} readAt+{within * 1000 + 200:.0f}ms"
            f" after={after} clear={clear2}"
        )
        errs += errors
    finally:
        close(page)

    # 3. 减少动态效果时不播放
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        reduced_motion="reduce",
    )
    try:
        wait_idle(page)
        page.evaluate(WON_WATCH_JS)
        won = walk_to_exit(page)
        page.wait_for_function("() => window.__wonWatch.done", timeout=5000)
        frames = page.evaluate("() => window.__wonWatch.values")
        samples = []
        for _ in range(4):
            samples.append(m3(page, "confettiActive"))
            page.wait_for_timeout(100)
        good = won and len(frames) > 0 and not any(frames) and not any(samples)
        ok = ok and good
        details.append(
            f"3:reduce won={won} frames={len(frames)} anyActive={any(frames) or any(samples)}"
        )
        errs += errors
    finally:
        close(page)
    ok_err, msg = no_errors(errs)
    return ok and ok_err, (" ".join(details) + " " + msg).strip()


def check_p8(browser, base):
    """每个主题存两张验收截图：开局（polish-{主题}-start.png）与背对终点出边缘箭头
    （polish-{主题}-arrow.png）；8 个文件都存在且非空才 PASS。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    details = []
    ok = True
    errs = []
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=theme_init(tid),
        )
        try:
            wait_idle(page)
            page.wait_for_timeout(600)
            start = SHOTS / f"polish-{tid}-start.png"
            canvas_image(page).save(start)
            back_to_end_state(page)
            mode = end_hint(page)["mode"]
            arrow = SHOTS / f"polish-{tid}-arrow.png"
            page.locator("#stage").screenshot(path=str(arrow))
            good = (
                mode == "edge"
                and start.exists()
                and start.stat().st_size > 0
                and arrow.exists()
                and arrow.stat().st_size > 0
            )
            ok = ok and good
            details.append(f"{tid}:mode={mode} saved={good}")
            errs += errors
        finally:
            close(page)
    ok_err, msg = no_errors(errs)
    return ok and ok_err, (" ".join(details) + f" dir={SHOTS} " + msg).strip()


# ---------------------------------------------------------------- gameplay（PR B）


def gameplay(page, expr, arg=None):
    """在页面里 import gameplay.js（G）与 game-logic.js（L）后求值 expr（可用 G、L、M=__maze3d、arg）。"""
    return page.evaluate(
        "async ([expr, arg]) => {"
        " const G = await import('/maze-3d/gameplay.js');"
        " const L = await import('/maze-3d/game-logic.js');"
        " const M = window.__maze3d;"
        " return (new Function('G', 'L', 'M', 'arg', 'return (' + expr + ');'))(G, L, M, arg);"
        "}",
        [expr, arg],
    )


def mini_colors(page):
    return {k: hex_rgb(v) for k, v in gameplay(page, "G.MINI_COLORS").items()}


def minimap_image(page):
    """#minimap 画布的设备像素图（解码 toDataURL）。"""
    data = minimap_data(page)
    raw = base64.b64decode(data.split(",", 1)[1])
    return Image.open(io.BytesIO(raw)).convert("RGB")


def mini_px(lay, row, col, fx=0.5, fz=0.5):
    """格 (row, col) 内相对位置 (fx, fz) 在小地图画布上的设备像素坐标。"""
    return (
        lay["pad"] + (col + fx) * lay["cell"],
        lay["pad"] + (row + fz) * lay["cell"],
    )


def cheb_rc(a, b):
    """两个 (row, col) 序列的 Chebyshev 距离。"""
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


def px_at(img, xy):
    return img.getpixel((int(xy[0]), int(xy[1])))


def footprint_alpha(i, n):
    """与 gameplay.js 的 footprintAlpha 同公式。"""
    if n <= 1:
        return 0.9
    return 0.35 + 0.55 * i / (n - 1)


def mix_rgb(a, b, alpha):
    return tuple(alpha * x + (1 - alpha) * y for x, y in zip(a, b))


def route_to_end(page):
    return logic(
        page,
        "L.findPath(M.connections, {row: 0, col: 0}, {row: M.size - 1, col: M.size - 1})",
    )


def check_b1(browser, base):
    """已探索格子：开局 4 格；沿通关路线走到第 7 格后路上视野都已探索；小地图已探索 / 未探索格颜色；
    关迷雾全部已探索，再开仍是全部。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        init_script=preset_storage("1", "1"),
    )
    details = []
    try:
        wait_idle(page)
        e0 = m3(page, "explored")
        details.append(f"start explored={e0}")
        if e0 != 4:
            return False, " ".join(details)
        route = route_to_end(page)
        details.append(f"route={len(route)}")
        if len(route) < 8:
            return False, " ".join(details)
        t = route[6]
        ok_walk = walk_to(page, *t)
        cell = m3(page, "playerCell")
        st = m3(page, "state")
        details.append(f"walk to {t}: ok={ok_walk} cell={cell} state={st}")
        if not ok_walk or cell != {"row": t[0], "col": t[1]} or st == "won":
            return False, " ".join(details)
        e1 = m3(page, "explored")
        missing = page.evaluate(
            "(route) => { const M = window.__maze3d; const out = [];"
            " for (const [r, c] of route) for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {"
            "  const rr = r + dr, cc = c + dc;"
            "  if (rr < 0 || cc < 0 || rr >= M.size || cc >= M.size) continue;"
            "  if (!M.exploredAt(rr, cc)) out.push([rr, cc]); }"
            " return out; }",
            route[:7],
        )
        details.append(f"explored={e1} missingOnRoute={missing[:5]}")
        if e1 <= 4 or missing:
            return False, " ".join(details)
        wait_frames(page, 3)
        colors = mini_colors(page)
        lay = m3(page, "minimapLayout")
        img = minimap_image(page)
        explored_map = page.evaluate(
            "() => { const M = window.__maze3d; const out = [];"
            " for (let r = 0; r < M.size; r++) { const row = [];"
            "  for (let c = 0; c < M.size; c++) row.push(M.exploredAt(r, c)); out.push(row); }"
            " return out; }"
        )
        bad = []
        n_seen = n_fog = 0
        for r in range(10):
            for c in range(10):
                if cheb_rc((r, c), t) <= 1 or (r, c) == (9, 9):
                    continue
                px = px_at(img, mini_px(lay, r, c, 0.25, 0.25))
                if explored_map[r][c]:
                    d = min(rgb_dist(px, colors["floor"]), rgb_dist(px, colors["seen"]))
                    n_seen += 1
                else:
                    d = rgb_dist(px, colors["fog"])
                    n_fog += 1
                if d > 20:
                    bad.append(((r, c), explored_map[r][c], px, round(d, 1)))
        details.append(f"pixels explored={n_seen} fog={n_fog} bad={bad[:4]}")
        if bad or n_fog == 0:
            return False, " ".join(details)
        page.click("#fog-btn")
        page.wait_for_timeout(100)
        e2 = m3(page, "explored")
        page.click("#fog-btn")
        page.wait_for_timeout(100)
        e3 = m3(page, "explored")
        details.append(f"fogOff explored={e2} fogOn again={e3}")
        ok = e2 == 100 and e3 == 100
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b2(browser, base):
    """脚印：按走过顺序记录；小地图格心是按不透明度混合的脚印色；回头走移到末尾；
    瞬移不记；重新生成只剩起点。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        init_script=preset_storage("1", "5"),
    )
    details = []
    try:
        wait_idle(page)
        route = route_to_end(page)[:6]
        ok_walk = walk_to(page, *route[5])
        fp = m3(page, "footprints")
        details.append(f"route={route} walk={ok_walk} footprints={fp}")
        if not ok_walk or fp != route:
            return False, " ".join(details)
        wait_frames(page, 3)
        colors = mini_colors(page)
        lay = m3(page, "minimapLayout")
        img = minimap_image(page)
        ppos = m3(page, "playerPos")
        pc = (
            lay["pad"] + ppos["x"] * lay["cell"],
            lay["pad"] + ppos["z"] * lay["cell"],
        )
        rad = 2.2 * max(2.5 * lay["dpr"], 0.28 * lay["cell"]) + 2
        cur = route[5]
        n = len(fp)
        bad = []
        checked = 0
        for i, (r, c) in enumerate(route[:-1]):
            xy = mini_px(lay, r, c)
            if math.hypot(xy[0] - pc[0], xy[1] - pc[1]) < rad:
                continue
            under = colors["floor"] if cheb_rc((r, c), cur) <= 5 else colors["seen"]
            want = mix_rgb(colors["foot"], under, footprint_alpha(i, n))
            got = px_at(img, xy)
            d = rgb_dist(got, want)
            checked += 1
            if d > 30:
                bad.append(((r, c), got, tuple(round(v) for v in want), round(d, 1)))
        details.append(f"pixels checked={checked} bad={bad[:4]}")
        if bad or checked == 0:
            return False, " ".join(details)
        ok_back = walk_to(page, *route[4])
        fp2 = m3(page, "footprints")
        details.append(
            f"back to {route[4]}: ok={ok_back} last={fp2[-1]} len={len(fp2)}"
        )
        if not ok_back or fp2[-1] != route[4] or len(fp2) != 6:
            return False, " ".join(details)
        page.evaluate("() => window.__maze3d.teleportForTest(5, 5)")
        fp3 = m3(page, "footprints")
        details.append(f"teleport unchanged={fp3 == fp2}")
        if fp3 != fp2:
            return False, " ".join(details)
        page.click("#regen-btn")
        wait_idle(page)
        fp4 = m3(page, "footprints")
        details.append(f"regen footprints={fp4}")
        ok = fp4 == [[0, 0]]
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b3(browser, base):
    """小地图在跟随视角也显示；跟随视角下终点箭头不压小地图；静止时小地图连续 30 帧不变。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        v0 = m3(page, "minimapVisible")
        page.click("#view-btn")
        page.wait_for_timeout(100)
        v1 = m3(page, "minimapVisible")
        page.click("#view-btn")
        page.wait_for_timeout(100)
        details.append(f"visible follow={v0} first={v1}")
        if not (v0 is True and v1 is True):
            return False, " ".join(details)
        errs = list(errors)
    finally:
        close(page)
    page, errors = hint_page(browser, base, "0", "5")
    try:
        back_to_end_state(page)
        r = page.evaluate(
            "() => { const M = window.__maze3d;"
            " const a = document.getElementById('end-arrow').getBoundingClientRect();"
            " const m = document.getElementById('minimap').getBoundingClientRect();"
            " const hit = !(a.right <= m.left || a.left >= m.right || a.bottom <= m.top || a.top >= m.bottom);"
            " return { mode: M.endHint.mode, hit, mini: !document.getElementById('minimap').hidden }; }"
        )
        details.append(f"arrow: {r}")
        if r["mode"] != "edge" or r["hit"] or not r["mini"]:
            return False, " ".join(details)
        set_test_input(page)
        wait_camera_still(page)
        shots = []
        for _ in range(30):
            wait_frames(page, 1)
            shots.append(minimap_data(page))
        same = all(x == shots[0] for x in shots)
        details.append(f"still 30 frames same={same}")
        ok_err, msg = no_errors(errs + errors)
        return same and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def best_init(value):
    """init script：只在 maze3d.best.10 缺失时写入 value（刷新不会覆盖）。"""
    return (
        "try { const k = 'maze3d.best.10';"
        " if (localStorage.getItem(k) === null) localStorage.setItem(k, %s); } catch (e) {}"
        % json.dumps(value)
    )


SET_VISIBILITY_JS = """(v) => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}"""


def set_visibility(page, value):
    """模拟页面切到后台 / 回到前台：改写 document.visibilityState 并派发 visibilitychange。"""
    page.evaluate(SET_VISIBILITY_JS, value)


def timer_of(page):
    return m3(page, "timer")


def check_b4(browser, base):
    """计时：不动不走；只转视角不走；首次移动开始；后台暂停、回前台不补算；通关冻结；
    再来一局与切换尺寸清零。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        page.wait_for_timeout(1000)
        t0 = timer_of(page)
        dom0 = page.inner_text("#timer")
        details.append(f"idle: {t0} dom={dom0!r}")
        if t0["started"] or t0["text"] != "00:00.0" or "00:00.0" not in dom0:
            return False, " ".join(details)
        set_test_input(page, turn=1)
        page.wait_for_timeout(500)
        set_test_input(page)
        t1 = timer_of(page)
        details.append(f"turn: started={t1['started']}")
        if t1["started"]:
            return False, " ".join(details)
        face_open(page)
        set_test_input(page, forward=1)
        page.wait_for_timeout(200)
        t2 = timer_of(page)
        page.wait_for_timeout(1000)
        t3 = timer_of(page)
        set_test_input(page)
        details.append(
            f"forward: started@200ms={t2['started']} elapsed@1.2s={t3['elapsedMs']:.0f}"
        )
        if not t2["started"] or not (800 <= t3["elapsedMs"] <= 1400):
            return False, " ".join(details)
        # 后台：渲染循环停止，计时不走；回到前台 dt 不含后台时长
        set_visibility(page, "hidden")
        h0 = timer_of(page)["elapsedMs"]
        page.wait_for_timeout(1000)
        h1 = timer_of(page)["elapsedMs"]
        set_visibility(page, "visible")
        page.wait_for_timeout(500)
        h2 = timer_of(page)["elapsedMs"]
        details.append(f"hidden: {h0:.0f}->{h1:.0f} visible+500ms: {h2:.0f}")
        if h1 != h0 or not (h0 < h2 <= h0 + 900):
            return False, " ".join(details)
        if not walk_to_exit(page):
            details.append("walk_to_exit failed")
            return False, " ".join(details)
        w0 = timer_of(page)
        page.wait_for_timeout(500)
        w1 = timer_of(page)
        want = gameplay(page, "G.formatTime(M.lastResult.timeMs)")
        win_time = page.inner_text("#win-time")
        details.append(
            f"won: running={w0['running']} {w0['elapsedMs']:.1f}->{w1['elapsedMs']:.1f}"
            f" winTime={win_time!r} want={want}"
        )
        if w0["running"] or w0["elapsedMs"] != w1["elapsedMs"] or want not in win_time:
            return False, " ".join(details)
        page.click("#again-btn")
        wait_idle(page)
        a = timer_of(page)
        details.append(f"again: {a['elapsedMs']} started={a['started']}")
        if a["elapsedMs"] != 0 or a["started"]:
            return False, " ".join(details)
        face_open(page)
        set_test_input(page, forward=1)
        page.wait_for_timeout(400)
        set_test_input(page)
        moved_t = timer_of(page)
        page.click("#size-15")
        wait_idle(page)
        z = timer_of(page)
        details.append(
            f"size15: before={moved_t['started']} after={z['elapsedMs']} started={z['started']}"
        )
        ok = moved_t["started"] and z["elapsedMs"] == 0 and not z["started"]
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


WIN_DOM_JS = """() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && getComputedStyle(el).display !== 'none'; };
  const txt = (id) => document.getElementById(id).textContent;
  let b10 = null, b15 = null;
  try { b10 = localStorage.getItem('maze3d.best.10'); b15 = localStorage.getItem('maze3d.best.15'); } catch (e) {}
  return { r: window.__maze3d.lastResult, record: vis('win-record'), recordText: txt('win-record'),
    best: vis('win-best'), bestText: txt('win-best'), note: vis('win-path-note'), b10, b15 };
}"""


def win_dom(page):
    return page.evaluate(WIN_DOM_JS)


def int_ok(w):
    """整数毫秒：lastResult.timeMs 是整数；存储（如有）是正整数串。"""
    r = w["r"] or {}
    t = r.get("timeMs")
    store_ok = w["b10"] is None or bool(re.fullmatch(r"[1-9]\d*", w["b10"]))
    return isinstance(t, int) and store_ok


def forward_half_second(page):
    face_open(page)
    set_test_input(page, forward=1)
    page.wait_for_timeout(500)
    set_test_input(page)


def b5_case(browser, base, name, init, run):
    """一个子场景：新上下文、init script、执行 run(page) → (ok, detail)。"""
    page, errors = open_page(
        browser, f"{base}{PAGE}?seed={S}&size=10&debug=1", init_script=init
    )
    try:
        wait_idle(page)
        ok, detail = run(page)
        ok_err, msg = no_errors(errors)
        return ok and ok_err, f"[{name}] {detail} {msg}".strip()
    finally:
        close(page)


def check_b5(browser, base):
    """最佳成绩：新纪录、跨刷新保留、更慢不刷新、非法记录、看了道路不计入（三种路径）、
    开始前看过再隐藏仍计入、整数毫秒、存储被禁用时照常显示新纪录。"""
    results = []

    def record_then_reload(page):
        if not walk_to_exit(page):
            return False, "walk1 failed"
        w = win_dom(page)
        r = w["r"]
        ok1 = (
            r["isNew"]
            and w["record"]
            and w["recordText"] == "新纪录!"
            and w["b10"] == str(r["timeMs"])
            and w["b15"] is None
            and int_ok(w)
        )
        d = f"first: isNew={r['isNew']} record={w['record']} b10={w['b10']} timeMs={r['timeMs']} b15={w['b15']}"
        if not ok1:
            return False, d
        prev = int(w["b10"])
        page.reload()
        wait_idle(page)
        if not walk_to_exit(page):
            return False, d + " walk2 failed"
        w2 = win_dom(page)
        r2 = w2["r"]
        want = gameplay(page, "G.formatTime(M.lastResult.bestMs)")
        ok2 = (
            r2["bestMs"] is not None
            and r2["bestMs"] <= prev
            and w2["best"]
            and want in w2["bestText"]
            and int_ok(w2)
        )
        return (
            ok2,
            d + f" reload: bestMs={r2['bestMs']} prev={prev} best={w2['bestText']!r}",
        )

    results.append(
        b5_case(browser, base, "new", best_init("9999999"), record_then_reload)
    )

    def slower(page):
        if not walk_to_exit(page):
            return False, "walk failed"
        w = win_dom(page)
        r = w["r"]
        ok = (
            not r["isNew"]
            and not w["record"]
            and w["b10"] == "1"
            and w["best"]
            and "00:00.0" in w["bestText"]
            and int_ok(w)
        )
        return (
            ok,
            f"isNew={r['isNew']} record={w['record']} b10={w['b10']} best={w['bestText']!r}",
        )

    results.append(b5_case(browser, base, "slower", best_init("1"), slower))

    def invalid(page):
        if not walk_to_exit(page):
            return False, "walk failed"
        w = win_dom(page)
        r = w["r"]
        ok = r["isNew"] and w["b10"] == str(r["timeMs"]) and int_ok(w)
        return ok, f"isNew={r['isNew']} b10={w['b10']} timeMs={r['timeMs']}"

    results.append(b5_case(browser, base, "abc", best_init("abc"), invalid))

    def not_counted(w):
        r = w["r"]
        ok = (
            r["eligible"] is False
            and not r["isNew"]
            and w["b10"] == "9999999"
            and w["note"]
            and int_ok(w)
        )
        return (
            ok,
            f"eligible={r['eligible']} isNew={r['isNew']} b10={w['b10']} note={w['note']}",
        )

    def path_mid(page):
        forward_half_second(page)
        page.click("#show-path-btn")
        if not walk_to_exit(page):
            return False, "walk failed"
        return not_counted(win_dom(page))

    results.append(b5_case(browser, base, "pathMid", best_init("9999999"), path_mid))

    def path_before(page):
        page.click("#show-path-btn")
        if not walk_to_exit(page):
            return False, "walk failed"
        return not_counted(win_dom(page))

    results.append(
        b5_case(browser, base, "pathBefore", best_init("9999999"), path_before)
    )

    def path_carry(page):
        page.click("#show-path-btn")
        if not walk_to_exit(page):
            return False, "walk1 failed"
        page.click("#again-btn")
        wait_idle(page)
        if not walk_to_exit(page):
            return False, "walk2 failed"
        return not_counted(win_dom(page))

    results.append(
        b5_case(browser, base, "pathCarry", best_init("9999999"), path_carry)
    )

    def path_hidden(page):
        page.click("#show-path-btn")
        page.click("#hide-path-btn")
        if not walk_to_exit(page):
            return False, "walk failed"
        w = win_dom(page)
        r = w["r"]
        ok = r["eligible"] is True and not w["note"] and int_ok(w)
        return ok, f"eligible={r['eligible']} note={w['note']} isNew={r['isNew']}"

    results.append(
        b5_case(browser, base, "pathHidden", best_init("9999999"), path_hidden)
    )

    def blocked(page):
        if not walk_to_exit(page):
            return False, "walk failed"
        w = win_dom(page)
        r = w["r"]
        st = m3(page, "state")
        ok = st == "won" and r["isNew"] and w["record"]
        return ok, f"state={st} isNew={r['isNew']} record={w['record']}"

    results.append(b5_case(browser, base, "blocked", BLOCK_STORAGE, blocked))

    ok = all(r[0] for r in results)
    return ok, " ".join(r[1] for r in results)


def star_cells(page):
    return [[st["row"], st["col"]] for st in m3(page, "stars")]


def first_clear_star(page):
    """第一颗「从起点出发的最短路不经过其他星星格」的星星，返回 (star, path)。"""
    return logic(
        page,
        """(() => {
          const S = M.stars;
          for (const s of S) {
            const p = L.findPath(M.connections, {row: 0, col: 0}, s);
            const others = S.filter((o) => o !== s && p.some(([r, c]) => r === o.row && c === o.col));
            if (p.length && !others.length) return [s, p];
          }
          return [null, []];
        })()""",
    )


def check_b10(browser, base):
    """星星数量 3 / 5 / 7、信息栏计数文字；同 seed 刷新位置不变；与页面里调用 placeStars 一致；
    20 → 10 后多出来的星星网格隐藏。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        for n, want in [(10, 3), (15, 5), (20, 7)]:
            page.click(f"#size-{n}")
            wait_idle(page)
            total = m3(page, "starTotal")
            text = page.inner_text("#star-count")
            details.append(f"{n}: total={total} text={text!r}")
            if total != want or text != f"⭐ 0/{want}":
                return False, " ".join(details)
        before = star_cells(page)
        page.reload()
        wait_idle(page)
        after = star_cells(page)
        ref = gameplay(
            page,
            "G.placeStars(M.connections, M.seed, G.starCountFor(M.size)).map((s) => [s.row, s.col])",
        )
        details.append(f"reload same={before == after} placeStars same={after == ref}")
        if before != after or after != ref:
            return False, " ".join(details)
        errs = list(errors)
    finally:
        close(page)
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=20&debug=1",
        init_script=preset_storage("0", "5"),
    )
    try:
        wait_idle(page)
        v20 = m3(page, "starMeshesVisible")
        page.click("#size-10")
        wait_idle(page)
        v10 = m3(page, "starMeshesVisible")
        details.append(f"fogOff meshesVisible 20={v20} ->10={v10}")
        ok = v20 == 7 and v10 == 3
        ok_err, msg = no_errors(errs + errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b11(browser, base):
    """收集星星：计数、隐藏、小地图标记消失；来回走不重复计数；通关层显示 1 / 3；再来一局清零。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        star, path = first_clear_star(page)
        details.append(f"star={star} path={len(path)}")
        if not star:
            return False, " ".join(details)
        idx = [
            i
            for i, st in enumerate(m3(page, "stars"))
            if st["row"] == star["row"] and st["col"] == star["col"]
        ][0]
        ok_walk = walk_to(page, star["row"], star["col"])
        n1 = m3(page, "starsCollected")
        text = page.inner_text("#star-count")
        st = m3(page, "stars")[idx]
        details.append(f"walk={ok_walk} collected={n1} text={text!r} star={st}")
        if not (
            ok_walk
            and n1 == 1
            and text == "⭐ 1/3"
            and st["collected"]
            and not st["visible"]
        ):
            return False, " ".join(details)
        prev = path[-2]
        walk_to(page, *prev)
        walk_to(page, star["row"], star["col"])
        walk_to(page, *prev)
        n2 = m3(page, "starsCollected")
        wait_frames(page, 3)
        lay = m3(page, "minimapLayout")
        px = px_at(minimap_image(page), mini_px(lay, star["row"], star["col"]))
        d = rgb_dist(px, hex_rgb("#ffb300"))
        details.append(f"back&forth collected={n2} miniCenter={px} distStar={d:.1f}")
        if n2 != 1 or d <= 60:
            return False, " ".join(details)
        cur = m3(page, "playerCell")
        p = logic(
            page,
            "L.findPath(M.connections, arg, {row: M.size - 1, col: M.size - 1})",
            cur,
        )
        page.evaluate(
            "([r, c]) => window.__maze3d.teleportForTest(r, c)", [p[-2][0], p[-2][1]]
        )
        won = walk_to_exit(page)
        ws = page.inner_text("#win-stars")
        details.append(f"won={won} winStars={ws!r}")
        if not won or "1 / 3" not in ws:
            return False, " ".join(details)
        page.click("#again-btn")
        wait_idle(page)
        n3 = m3(page, "starsCollected")
        details.append(f"again collected={n3}")
        ok = n3 == 0
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b12(browser, base):
    """星星与迷雾：视野外隐藏、小地图不暴露；到相邻格后显示并出现标记；离开后 3D 隐藏、标记保留。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        init_script=preset_storage("1", "1"),
    )
    details = []
    try:
        wait_idle(page)
        star = m3(page, "stars")[0]
        r, c = star["row"], star["col"]
        colors = mini_colors(page)

        def center_px():
            wait_frames(page, 3)
            lay = m3(page, "minimapLayout")
            return px_at(minimap_image(page), mini_px(lay, r, c))

        p0 = center_px()
        d0 = rgb_dist(p0, colors["fog"])
        details.append(
            f"star=({r},{c}) visible={star['visible']} center={p0} distFog={d0:.1f}"
        )
        if star["visible"] or d0 > 20:
            return False, " ".join(details)
        nb = next(
            (r + dr, c + dc)
            for dr in (-1, 0, 1)
            for dc in (-1, 0, 1)
            if (dr or dc) and 0 <= r + dr < 10 and 0 <= c + dc < 10
        )
        page.evaluate("([r, c]) => window.__maze3d.teleportForTest(r, c)", list(nb))
        v1 = m3(page, "stars")[0]["visible"]
        p1 = center_px()
        d1 = rgb_dist(p1, colors["star"])
        details.append(f"near {nb}: visible={v1} center={p1} distStar={d1:.1f}")
        if not v1 or d1 > 40:
            return False, " ".join(details)
        page.evaluate("() => window.__maze3d.teleportForTest(0, 0)")
        v2 = m3(page, "stars")[0]["visible"]
        p2 = center_px()
        d2 = rgb_dist(p2, colors["star"])
        details.append(f"away: visible={v2} center={p2} distStar={d2:.1f}")
        ok = not v2 and d2 <= 40
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def avg3(img, x, y):
    """(x, y)（设备像素）周围 3×3 平均色。"""
    px = img.load()
    acc = [0, 0, 0]
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            xx = min(img.size[0] - 1, max(0, int(x) + dx))
            yy = min(img.size[1] - 1, max(0, int(y) + dy))
            v = px[xx, yy]
            for k in range(3):
                acc[k] += v[k]
    return tuple(a / 9 for a in acc)


def check_b13(browser, base):
    """星星可见度：四个主题，星星中心颜色与周围 0.6 格的地板、与道路都相差 ≥ 60。"""
    details = []
    ok = True
    errs = []
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=theme_init(tid) + preset_storage("0", "5"),
        )
        try:
            wait_idle(page)
            page.evaluate("() => window.__maze3d.setStarsForTest({ paused: true })")
            star = m3(page, "stars")[0]
            r, c = star["row"], star["col"]
            nb = logic(
                page,
                "Object.values(L.DIRS).map(([dr, dc]) => ({row: arg.row + dr, col: arg.col + dc}))"
                ".find((n) => L.canMove(M.connections, arg, n))",
                {"row": r, "col": c},
            )
            page.evaluate(
                "([r, c]) => window.__maze3d.teleportForTest(r, c)",
                [nb["row"], nb["col"]],
            )
            face_yaw(page, math.atan2(c - nb["col"], -(r - nb["row"])))
            wait_camera_still(page)
            wait_frames(page, 3)
            cam = m3(page, "cameraState")
            cw, ch = page.evaluate(
                f"() => {{ const c = document.querySelector('{CANVAS_SEL}'); return [c.clientWidth, c.clientHeight]; }}"
            )
            sp = project_css(cam, (c + 0.5, 0.35, r + 0.5), cw, ch)
            img = canvas_image(page)
            ratio = img.size[0] / cw

            def color_at(pt):
                return avg3(img, pt[0] * ratio, pt[1] * ratio)

            if sp is None or not (0 <= sp[0] < cw and 0 <= sp[1] < ch):
                details.append(f"{tid}: star off screen {sp}")
                ok = False
                continue
            sc = color_at(sp)

            def ring(kind):
                out = []
                for k in range(8):
                    a = k * math.pi / 4
                    x = c + 0.5 + 0.6 * math.cos(a)
                    z = r + 0.5 + 0.6 * math.sin(a)
                    cell = (math.floor(z), math.floor(x))
                    if not (0 <= cell[0] < 10 and 0 <= cell[1] < 10):
                        continue
                    if m3(page, f"floorKindAt({cell[0]}, {cell[1]})") != kind:
                        continue
                    pt = page.evaluate(
                        "([x, z]) => window.__maze3d.floorPointCss(x, z)", [x, z]
                    )
                    if pt:
                        out.append((pt["x"], pt["y"]))
                return out

            floor_pts = ring("floor")
            floor_d = [rgb_dist(sc, color_at(pt)) for pt in floor_pts]
            page.click("#show-path-btn")
            wait_frames(page, 3)
            img2 = canvas_image(page)

            def color2(pt):
                return avg3(img2, pt[0] * ratio, pt[1] * ratio)

            sc2 = color2(sp)
            if m3(page, f"floorKindAt({r}, {c})") == "path":
                path_pts = ring("path")
                src = "ring"
            else:
                cell = logic(
                    page,
                    """(() => { let best = null, bd = 1e9;
                      for (let rr = 0; rr < M.size; rr++) for (let cc = 0; cc < M.size; cc++) {
                        if (M.floorKindAt(rr, cc) !== 'path') continue;
                        if (!M.floorSamplePoints(rr, cc).length) continue;
                        const d = Math.hypot(rr - arg.row, cc - arg.col);
                        if (d < bd) { bd = d; best = [rr, cc]; } }
                      return best; })()""",
                    {"row": r, "col": c},
                )
                path_pts = (
                    [
                        (q["x"], q["y"])
                        for q in m3(page, f"floorSamplePoints({cell[0]}, {cell[1]})")
                    ]
                    if cell
                    else []
                )
                src = f"cell{cell}"
            path_d = [rgb_dist(sc2, color2(pt)) for pt in path_pts]
            good = (
                len(floor_d) >= 1
                and min(floor_d) >= 60
                and len(path_d) >= 1
                and min(path_d) >= 60
            )
            ok = ok and good
            details.append(
                f"{tid}: star={tuple(round(v) for v in sc)} floor n={len(floor_d)}"
                f" min={min(floor_d) if floor_d else None!s:.5} path({src}) n={len(path_d)}"
                f" min={min(path_d) if path_d else None!s:.5} ok={good}"
            )
            errs += errors
        finally:
            close(page)
    ok_err, msg = no_errors(errs)
    return ok and ok_err, (" ".join(details) + " " + msg).strip()


VIBRATE_RECORD = """
Object.defineProperty(Navigator.prototype, 'vibrate', { configurable: true, writable: true,
  value: function (p) { (window.__vib = window.__vib || []).push(p); return true; } });
"""

NO_AUDIO = """
delete window.AudioContext; delete window.webkitAudioContext; delete Navigator.prototype.vibrate;
"""


def sfx_log(page):
    return m3(page, "sfxLog")


def sfx_names(page):
    return [e["name"] for e in sfx_log(page)]


def clear_sfx(page):
    page.evaluate("() => window.__maze3d.clearSfxLog()")


def vib_log(page):
    return page.evaluate("() => window.__vib || []")


def straight_cell(page, n):
    """从起点 BFS 找第一个「某方向连续 n 格可走」的格（路线与直线都不经过终点），返回 (cell, dir)。"""
    r = logic(
        page,
        """(() => {
          const N = arg; const end = M.size - 1;
          const isEnd = (p) => p.row === end && p.col === end;
          const seen = new Set(['0,0']);
          const q = [{ row: 0, col: 0 }];
          for (let i = 0; i < q.length; i++) {
            const p = q[i];
            for (const d of ['up', 'right', 'down', 'left']) {
              const [dr, dc] = L.DIRS[d];
              let ok = true; let a = p;
              for (let k = 1; k <= N; k++) {
                const b = { row: p.row + dr * k, col: p.col + dc * k };
                if (!L.canMove(M.connections, a, b) || isEnd(b)) { ok = false; break; }
                a = b;
              }
              if (ok) return [p, d];
            }
            for (const [dr, dc] of Object.values(L.DIRS)) {
              const nb = { row: p.row + dr, col: p.col + dc };
              if (!L.canMove(M.connections, p, nb) || isEnd(nb) || seen.has(nb.row + ',' + nb.col)) continue;
              seen.add(nb.row + ',' + nb.col);
              q.push(nb);
            }
          }
          return [null, null];
        })()""",
        n,
    )
    return r[0], r[1]


def walk_straight(page, n=2):
    """走到 straight_cell 的起点、朝该方向，清空日志后沿直线走 n 格；返回是否到达。"""
    cell, d = straight_cell(page, n)
    if cell is None or not walk_to(page, cell["row"], cell["col"]):
        return False
    face_yaw(page, DIR_YAW[d])
    clear_sfx(page)
    dr, dc = DIRS[d]
    return walk_to(page, cell["row"] + dr * n, cell["col"] + dc * n)


def push_wall(page, seconds):
    set_test_input(page, forward=1)
    page.wait_for_timeout(int(seconds * 1000))
    set_test_input(page)


def check_b6(browser, base):
    """声音调试日志：手势前不建 AudioContext；直线脚步 3–5 条且高低交替；顶墙只响一次、松开再顶再响一次、
    顶墙期间无脚步；星星与通关各一条；通关后继续推不再响、计时不走；切到后台挂起音频。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    details = []
    try:
        wait_idle(page)
        a0 = m3(page, "audioState")
        page.keyboard.press("Shift")
        page.wait_for_timeout(200)
        a1 = m3(page, "audioState")
        details.append(f"audio before={a0} afterShift={a1}")
        if a0 != "none" or a1 == "none":
            return False, " ".join(details)
        ok_walk = walk_straight(page, 2)
        steps = [e for e in sfx_log(page) if e["name"] == "step"]
        variants = [e["variant"] for e in steps]
        alt = all(variants[i] != variants[i - 1] for i in range(1, len(variants)))
        details.append(
            f"straight walk={ok_walk} steps={len(steps)} variants={variants}"
        )
        if not ok_walk or not (3 <= len(steps) <= 5) or not alt:
            return False, " ".join(details)
        d = find_wall_cell(page)
        if d is None:
            details.append("no wall cell")
            return False, " ".join(details)
        face_yaw(page, DIR_YAW[d])
        clear_sfx(page)
        push_wall(page, 2)
        bumps1 = sfx_names(page).count("bump")
        page.wait_for_timeout(700)
        push_wall(page, 1)
        log = sfx_log(page)
        bump_t = [e["t"] for e in log if e["name"] == "bump"]
        steps_after = [
            e for e in log if e["name"] == "step" and bump_t and e["t"] > bump_t[0]
        ]
        details.append(
            f"bump: first2s={bumps1} total={len(bump_t)} stepsAfterBump={len(steps_after)}"
        )
        if bumps1 != 1 or len(bump_t) != 2 or steps_after:
            return False, " ".join(details)
        star, path = first_clear_star(page)
        page.evaluate("() => window.__maze3d.teleportForTest(0, 0)")
        clear_sfx(page)
        walk_to(page, star["row"], star["col"])
        n_star = sfx_names(page).count("star")
        clear_sfx(page)
        won = walk_to_exit(page)
        n_win = sfx_names(page).count("win")
        details.append(f"star={n_star} won={won} win={n_win}")
        if n_star != 1 or not won or n_win != 1:
            return False, " ".join(details)
        clear_sfx(page)
        e0 = timer_of(page)["elapsedMs"]
        push_wall(page, 1)
        names = sfx_names(page)
        e1 = timer_of(page)["elapsedMs"]
        details.append(f"afterWin names={names} elapsed {e0:.1f}->{e1:.1f}")
        if "step" in names or "bump" in names or e0 != e1:
            return False, " ".join(details)
        before = m3(page, "audioState")
        set_visibility(page, "hidden")
        page.wait_for_timeout(300)
        hidden = m3(page, "audioState")
        set_visibility(page, "visible")
        details.append(f"background: {before}->{hidden}")
        ok = before != "running" or hidden == "suspended"
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b7(browser, base):
    """震动：顶墙 2 秒恰好一次 25；通关时 [80, 60, 80, 60, 200]。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        init_script=VIBRATE_RECORD,
    )
    details = []
    try:
        wait_idle(page)
        d = find_wall_cell(page)
        if d is None:
            return False, "no wall cell"
        face_yaw(page, DIR_YAW[d])
        v0 = len(vib_log(page))
        push_wall(page, 2)
        v1 = vib_log(page)[v0:]
        details.append(f"bump vib={v1}")
        if v1 != [25]:
            return False, " ".join(details)
        won = walk_to_exit(page)
        vib = vib_log(page)
        details.append(f"won={won} last={vib[-1] if vib else None}")
        ok = won and [80, 60, 80, 60, 200] in vib
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b8(browser, base):
    """静音：按钮文字、存储、soundOn；静音时顶墙走路不记日志不震动；刷新后保持静音且按键不建 AudioContext；
    再点恢复。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        init_script=VIBRATE_RECORD,
    )
    details = []

    def stored():
        return page.evaluate("() => localStorage.getItem('maze3d.sound')")

    try:
        wait_idle(page)
        page.click("#sound-btn")
        t1 = page.inner_text("#sound-btn")
        s1 = stored()
        on1 = m3(page, "soundOn")
        details.append(f"off: text={t1!r} stored={s1} soundOn={on1}")
        if t1 != "声音：关" or s1 != "0" or on1 is not False:
            return False, " ".join(details)
        n0 = len(sfx_log(page))
        v0 = len(vib_log(page))
        d = find_wall_cell(page)
        if d is None:
            return False, " ".join(details) + " no wall cell"
        face_yaw(page, DIR_YAW[d])
        push_wall(page, 2)
        walk_straight(page, 2)
        n1 = len(sfx_log(page))
        v1 = len(vib_log(page))
        details.append(f"muted log {n0}->{n1} vib {v0}->{v1}")
        if n1 != n0 or v1 != v0:
            return False, " ".join(details)
        page.reload()
        wait_idle(page)
        t2 = page.inner_text("#sound-btn")
        on2 = m3(page, "soundOn")
        page.keyboard.press("Shift")
        page.wait_for_timeout(200)
        a2 = m3(page, "audioState")
        details.append(f"reload: text={t2!r} soundOn={on2} audioAfterKey={a2}")
        if t2 != "声音：关" or on2 is not False or a2 != "none":
            return False, " ".join(details)
        page.click("#sound-btn")
        page.wait_for_timeout(200)
        t3 = page.inner_text("#sound-btn")
        s3 = stored()
        a3 = m3(page, "audioState")
        details.append(f"on: text={t3!r} stored={s3} audio={a3}")
        ok = t3 == "声音：开" and s3 == "1" and a3 != "none"
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b9(browser, base):
    """没有 Web Audio、没有震动：按键、顶墙、收集星星、通关、点静音开关都不报错；状态 unsupported；
    日志照常记录。"""
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        init_script=NO_AUDIO,
    )
    details = []
    try:
        wait_idle(page)
        page.keyboard.press("Shift")
        d = find_wall_cell(page)
        if d is None:
            return False, "no wall cell"
        face_yaw(page, DIR_YAW[d])
        push_wall(page, 2)
        star, path = first_clear_star(page)
        page.evaluate("() => window.__maze3d.teleportForTest(0, 0)")
        walk_to(page, star["row"], star["col"])
        won = walk_to_exit(page)
        # 通关层盖住了按钮行：直接派发 click 事件（走的仍是按钮的点击处理）
        page.locator("#sound-btn").dispatch_event("click")
        page.locator("#sound-btn").dispatch_event("click")
        st = m3(page, "audioState")
        names = sfx_names(page)
        details.append(
            f"won={won} audioState={st} bump={names.count('bump')} star={names.count('star')}"
            f" win={names.count('win')}"
        )
        ok = (
            won
            and st == "unsupported"
            and "bump" in names
            and "star" in names
            and "win" in names
        )
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_b14(browser, base):
    """性能：t7 的方法，新代码轮次里小地图在跟随视角显示、星星在场（20×20 共 7 颗）、声音开启且已创建
    AudioContext；各主题平均帧时间 ≤ 基线 1.3 倍且不降画质。"""

    def extra(name, r):
        x = r.get("extras") or {}
        ok = (
            x.get("minimapVisible") is True
            and x.get("starTotal") == 7
            and x.get("soundOn") is True
            and x.get("audioState") not in (None, "none")
        )
        return ok, f"extras={x}"

    return perf_compare(browser, base, extra=extra)


def check_b15(browser, base):
    """截图：四个主题各一张游戏中画面（星星、脚印、未探索区、信息栏）、一张第一人称、一张新纪录通关层；
    6 个文件都存在且非空才 PASS。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    details = []
    ok = True
    errs = []
    files = []
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10&debug=1",
            viewport={"width": 1280, "height": 800},
            init_script=theme_init(tid) + preset_storage("1", "2"),
            reduced_motion="reduce",
        )
        try:
            wait_idle(page)
            star, path = logic(
                page,
                """(() => { let best = [null, []];
                  for (const s of M.stars) {
                    const p = L.findPath(M.connections, {row: 0, col: 0}, s);
                    if (p.length > best[1].length) best = [s, p]; }
                  return best; })()""",
            )
            if not star or len(path) < 7:
                details.append(f"{tid}: route too short star={star} len={len(path)}")
                ok = False
                continue
            prev = path[-2]
            walk_to(page, *prev)
            page.evaluate("() => window.__maze3d.setStarsForTest({ paused: true })")
            face_yaw(page, math.atan2(star["col"] - prev[1], -(star["row"] - prev[0])))
            wait_camera_still(page)
            wait_frames(page, 3)
            fp = m3(page, "footprints")
            st = [
                x
                for x in m3(page, "stars")
                if x["row"] == star["row"] and x["col"] == star["col"]
            ][0]
            cam = m3(page, "cameraState")
            cw, ch = page.evaluate(
                f"() => {{ const c = document.querySelector('{CANVAS_SEL}'); return [c.clientWidth, c.clientHeight]; }}"
            )
            sp = project_css(cam, (star["col"] + 0.5, 0.35, star["row"] + 0.5), cw, ch)
            on_screen = sp is not None and 0 <= sp[0] < cw and 0 <= sp[1] < ch
            shot = SHOTS / f"gameplay-{tid}-play.png"
            page.locator("#stage").screenshot(path=str(shot))
            files.append(shot)
            good = len(fp) >= 6 and st["visible"] and on_screen
            details.append(
                f"{tid}: star=({star['row']},{star['col']}) route={len(path)} footprints={len(fp)}"
                f" visible={st['visible']} onScreen={on_screen}"
            )
            ok = ok and good
            if tid == "garden":
                page.click("#view-btn")
                page.wait_for_timeout(300)
                wait_frames(page, 3)
                st2 = [
                    x
                    for x in m3(page, "stars")
                    if x["row"] == star["row"] and x["col"] == star["col"]
                ][0]
                seen = m3(page, f"exploredAt({star['row']}, {star['col']})")
                fpv = SHOTS / "gameplay-first-person.png"
                page.locator("#stage").screenshot(path=str(fpv))
                files.append(fpv)
                good = not st2["collected"] and seen
                details.append(
                    f"firstPerson: collected={st2['collected']} explored={seen}"
                )
                ok = ok and good
            errs += errors
        finally:
            close(page)
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=best_init("9999999"),
        reduced_motion="reduce",
    )
    try:
        wait_idle(page)
        star, path = first_clear_star(page)
        walk_to(page, star["row"], star["col"])
        won = walk_to_exit(page)
        r = m3(page, "lastResult")
        page.wait_for_timeout(300)
        win = SHOTS / "gameplay-win.png"
        page.screenshot(path=str(win))
        files.append(win)
        good = won and r and r["isNew"] and r["stars"] >= 1
        details.append(f"win: won={won} result={r}")
        ok = ok and good
        errs += errors
    finally:
        close(page)
    saved = [f for f in files if f.exists() and f.stat().st_size > 0]
    details.append(f"files={len(saved)}/6 dir={SHOTS}")
    ok = ok and len(saved) == 6
    ok_err, msg = no_errors(errs)
    return ok and ok_err, (" ".join(details) + " " + msg).strip()


CHECKS = {
    "1": check_1,
    "10": check_10,
    "12": check_12,
    "6": check_6,
    "6b": check_6b,
    "7": check_7,
    "11": check_11,
    "4": check_4,
    "4b": check_4b,
    "5": check_5,
    "3": check_3,
    "8": check_8,
    "9": check_9,
    "9b": check_9b,
    "9c": check_9c,
    "13": check_13,
    "t1": check_t1,
    "t3": check_t3,
    "t4": check_t4,
    "t6": check_t6,
    "t8": check_t8,
    "t2": check_t2,
    "t5": check_t5,
    "t7": check_t7,
    "t7b": check_t7b,
    "t9": check_t9,
    "f1": check_f1,
    "f2": check_f2,
    "f3": check_f3,
    "f4": check_f4,
    "f5": check_f5,
    "f6": check_f6,
    "f7": check_f7,
    "f8": check_f8,
    "f9": check_f9,
    "f10": check_f10,
    "g1": check_g1,
    "g3": check_g3,
    "g3b": check_g3b,
    "g7": check_g7,
    "g8": check_g8,
    "p1": check_p1,
    "p1b": check_p1b,
    "p2": check_p2,
    "p3": check_p3,
    "p4a": check_p4a,
    "p4b": check_p4b,
    "p5": check_p5,
    "p5m": check_p5m,
    "p6": check_p6,
    "p8": check_p8,
    "b1": check_b1,
    "b2": check_b2,
    "b3": check_b3,
    "b4": check_b4,
    "b5": check_b5,
    "b6": check_b6,
    "b7": check_b7,
    "b8": check_b8,
    "b9": check_b9,
    "b10": check_b10,
    "b11": check_b11,
    "b12": check_b12,
    "b13": check_b13,
    "b14": check_b14,
    "b15": check_b15,
}


def order_key(name):
    num = "".join(ch for ch in name if ch.isdigit())
    return (int(num), name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--baseline-root", default="")
    ap.add_argument("--shots", default="")
    args = ap.parse_args()
    global BASELINE_ROOT, SHOTS
    BASELINE_ROOT = Path(args.baseline_root) if args.baseline_root else None
    if args.shots:
        SHOTS = Path(args.shots)
    names = (
        [n.strip() for n in args.only.split(",") if n.strip()]
        if args.only
        else sorted(CHECKS, key=order_key)
    )
    unknown = [n for n in names if n not in CHECKS]
    if unknown:
        print(f"unknown checks: {unknown}")
        return 2

    proc, base = start_server()
    lines = []
    all_ok = True
    try:
        with sync_playwright() as p:
            global PW
            PW = p
            browser = p.chromium.launch(args=SWIFTSHADER_ARGS)
            version = browser.version
            for name in names:
                started = time.time()
                try:
                    ok, detail = CHECKS[name](browser, base)
                except Exception as exc:  # 检查本身出错也算失败
                    ok = False
                    detail = f"exception: {exc!r}\n{traceback.format_exc()}"
                if ok is None:
                    status = "INCONCLUSIVE"
                    ok = False
                else:
                    status = "PASS" if ok else "FAIL"
                all_ok = all_ok and ok
                line = f"{status} {name} {detail} ({time.time() - started:.1f}s)"
                print(line, flush=True)
                lines.append(line)
            browser.close()
    finally:
        proc.terminate()
        proc.wait()

    if args.write:
        header = [
            "# 3D 迷宫浏览器验收结果",
            f"日期：{datetime.datetime.now().isoformat(timespec='seconds')}",
            f"Chromium：{version}",
            "命令：python tests/browser/maze3d_accept.py --write"
            + (f" --baseline-root {BASELINE_ROOT}" if BASELINE_ROOT else ""),
            f"自动检查：{'PASS' if all_ok else 'FAIL'}",
            f"基线代码：{BASELINE_ROOT}（merge-base）",
            f"人工检查：待用户查看 {SHOTS} 下 gameplay-*-play.png（星星、脚印、未探索区、信息栏）、"
            "gameplay-first-person.png 与 gameplay-win.png（用时、最佳、新纪录、星星数）",
            "",
        ]
        RESULTS.write_text("\n".join(header + lines) + "\n", encoding="utf-8")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
