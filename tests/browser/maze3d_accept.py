"""3D 迷宫浏览器验收脚本。

用法：
    ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py [--only 1,10,12] [--write]

脚本在仓库根目录起 python3 -m http.server（只绑 127.0.0.1），用 Playwright 驱动
Chromium 逐项检查，打印 PASS / FAIL；任一项失败时退出码为 1。
--write 把本次全部结果覆盖写入 tests/browser/test-results.txt。
"""

import argparse
import datetime
import io
import json
import math
import os
import socket
import subprocess
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from PIL import Image
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
    "/Users/jialiu/Projects/saisai.me/.xdev/20261113-091931-maze-3d-free-move/screenshots"
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
    """按住 w，交替按住 / 松开 ArrowRight 各 1 秒；胜利就点「再来一局」并重新按下 w。"""
    page.keyboard.down("w")
    t0 = time.time()
    turning = False
    try:
        while time.time() - t0 < seconds:
            if m3(page, "state") == "won":
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
    """沿最短路走到终点出现恭喜提示；「再来一局」后回到起点格中心、朝南、换新 seed。"""
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
            and abs(yaw - math.pi) < 1e-9
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
    start: '#4caf50', end: '#e53935', path: '#ff6b6b' };
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
      const red = M.floorColorHex(row, col) === '#ff6b6b';
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
      const red = M.floorColorHex(row, col) === '#ff6b6b';
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
                  if (M.floorColorHex(row, col) === '#ff6b6b') red++;
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
    """切换视角：保留 yaw，pitch 改为该视角默认值；第一人称显示小地图、隐藏小人。"""
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
            and not mini
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
        sw2 = page.evaluate("() => document.documentElement.scrollWidth")
        cw = box_of(page, "#stage > canvas:not(#minimap)")["width"]
        stw = box_of(page, "#stage")["width"]
        page.screenshot(path=str(SCRATCH / "maze3d-667x375.png"), full_page=True)
        details.append(f"landscape: scrollWidth={sw2} canvas={cw} stage={stw}")
        ok = sw2 <= 667 and abs(cw - stw) < 1
        ok_err, msg = no_errors(errors)
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def perf_round(browser, base, mobile, init_script=None, driver=play_continuous):
    """base 可以指向基线服务器；init_script 用来预设主题。"""
    if mobile:
        dev = dict(PW.devices["iPhone SE"])
        dev.pop("default_browser_type", None)
        page, errors = open_page(
            browser, f"{base}{PAGE}?seed={S}&size=20", init_script=init_script, **dev
        )
        cdp = page.context.new_cdp_session(page)
        cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    else:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=20",
            viewport={"width": 1280, "height": 800},
            init_script=init_script,
        )
    try:
        wait_idle(page, timeout=15000)
        page.wait_for_timeout(500)
        page.evaluate("() => window.__maze3d.resetFrameStats()")
        driver(page)
        stats = m3(page, "frameStats()")
        return {
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
        red0 = logic(page, COUNT_HEX_JS, "#ff6b6b")
        click_theme(page, "garden")
        red1 = logic(page, COUNT_HEX_JS, "#ff6b6b")
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
        page.wait_for_timeout(150)
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
        page.wait_for_timeout(150)
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
    for i in range(attempts):
        try:
            data = page.locator("#stage > canvas:not(#minimap)").screenshot()
            return Image.open(io.BytesIO(data)).convert("RGB")
        except Exception as exc:
            if "not attached" not in str(exc) or i == attempts - 1:
                raise
            page.wait_for_timeout(200)


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
    return (
        f"{name}: avg={r['avg']} p95={r['p95']} quality={r['quality']}"
        f" downgradeCount={r['downgradeCount']} renderer={r['renderer']!r} textureMs={ms_s}"
    )


def check_t7(browser, base):
    """GPU 下 iPhone SE + 4 倍 CPU 降速：各主题帧时间不超过基线的 1.3 倍，且不触发降画质。"""
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
                        perf_round(gb, bbase, mobile=True),
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
                                gb, base, mobile=True, init_script=theme_init(tid)
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
            limit = 1.3 * bl["avg"]
            high = bl["quality"] == "high" and bl["downgradeCount"] == 0
            verdicts = []
            ok = True
            for tid, r in runs[1:]:
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


def low_pitch_wall_view(page, yaw, shot):
    """俯角 15°、相机转到身后墙方向，等稳定后检查相机：线段不穿墙、不在盒内、俯角被抬高、距离可用。"""
    set_test_input(page, yaw=yaw, pitch=math.radians(15))
    page.wait_for_timeout(1500)
    target = m3(page, "cameraTarget")
    cam = m3(page, "cameraPos")
    boxes = m3(page, "wallBoxes3d")
    dist = m3(page, "cameraDistance")
    ideal = m3(page, "cameraIdealDistance")
    cam_pitch = m3(page, "cameraPitch")
    hits = [b for b in boxes if segment_hits_box(target, cam, b)]
    inside_box = [b for b in boxes if point_in_box(cam, b)]
    colors = m3(page, "sampleDistinctColors()")
    canvas_image(page).save(SHOTS / shot)
    usable = dist >= 0.98 * min(ideal, CAMERA_MIN_DIST)
    lifted = cam_pitch > math.radians(15) + 1e-6
    ok = not hits and not inside_box and usable and lifted
    detail = (
        f"distance={dist:.3f} ideal={ideal:.3f} camPitch={math.degrees(cam_pitch):.1f}"
        f" hits={len(hits)} camInside={len(inside_box)} colors={colors}"
    )
    return ok, detail


def check_f6(browser, base):
    """跟随视角背对墙、低俯角：格心与贴墙两处，相机都抬高俯角从墙顶看过去，线段不穿墙、
    距离不小于 CAMERA_MIN_DIST（小人不占满画面）；格心 60° 俯角本来就看得过去，不拉近。"""
    SHOTS.mkdir(parents=True, exist_ok=True)
    page, errors = open_page(
        browser,
        f"{base}{PAGE}?seed={S}&size=10&debug=1",
        viewport={"width": 1280, "height": 800},
    )
    details = []
    try:
        wait_idle(page)
        d = find_wall_cell(page)
        if d is None:
            return False, "no wall cell"
        back = DIR_YAW[d] + math.pi
        ok_center, msg = low_pitch_wall_view(page, back, "follow-lowpitch-wall.png")
        details.append(f"center pitch15 wall={d}: {msg}")
        set_test_input(page, pitch=math.radians(60))
        page.wait_for_timeout(1500)
        dist60 = m3(page, "cameraDistance")
        ideal60 = m3(page, "cameraIdealDistance")
        ok_high = dist60 >= 0.98 * ideal60
        details.append(f"center pitch60: distance={dist60:.3f} ideal={ideal60:.3f}")
        # 背对墙后退 1 秒，贴到墙上
        p0 = m3(page, "playerPos")
        set_test_input(page, forward=-1, yaw=back, pitch=math.radians(15))
        page.wait_for_timeout(1000)
        p1 = m3(page, "playerPos")
        ok_hug, msg = low_pitch_wall_view(page, back, "follow-lowpitch-hug.png")
        set_test_input(page)
        moved_back = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
        details.append(f"hug moved={moved_back:.3f} pitch15: {msg}")
        ok_err, msg = no_errors(errors)
        ok = ok_center and ok_high and ok_hug and moved_back > 0.1
        return ok and ok_err, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def check_f10(browser, base):
    """打开页面的默认跟随视角（起点朝南，相机在北侧入口外）：不被不渲染的入口封口拉近。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1")
    try:
        wait_idle(page)
        page.wait_for_timeout(500)
        dist = m3(page, "cameraDistance")
        ideal = m3(page, "cameraIdealDistance")
        ok_err, msg = no_errors(errors)
        ok = dist >= 0.98 * ideal
        return (
            ok and ok_err,
            f"start distance={dist:.3f} ideal={ideal:.3f} {msg}".strip(),
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
  const r = L.followFogRange(M.cameraIdealDistance, M.size);
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
        f"{base}{PAGE}?seed={S}&size=20&debug=1",
        viewport={"width": 1280, "height": 800},
        init_script=preset_storage("0", "5"),
    )
    details = []
    try:
        wait_idle(page)
        page.evaluate("() => window.__maze3d.setZoomForTest(1.5)")
        set_test_input(page, yaw=3 * math.pi / 4, pitch=math.radians(15))
        set_test_input(page)
        settle_camera(page)
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


G8_STATES = [
    ("follow15", "follow", 15),
    ("follow40", "follow", 40),
    ("first0", "first", 0),
    ("firstUp20", "first", 20),
    ("firstDown20", "first", -20),
]


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
    "g8": check_g8,
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
            f"人工检查：待用户查看 {SHOTS} 下截图（四种主题的跟随 / 第一人称 / 面墙，及 follow-lowpitch-wall.png / follow-lowpitch-hug.png），确认斜视角与贴墙视角能看到小人",
            "",
        ]
        RESULTS.write_text("\n".join(header + lines) + "\n", encoding="utf-8")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
