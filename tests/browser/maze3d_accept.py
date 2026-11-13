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
    "/Users/jialiu/Projects/saisai.me/.xdev/20261113-001535-maze-3d-themes/screenshots"
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


def pos(page):
    p = m3(page, "player")
    return {"row": p["row"], "col": p["col"]}


def next_stop(page, d, at=None):
    return logic(
        page,
        "L.findNextIntersection(M.connections, arg.at || M.player, arg.d)",
        {"d": d, "at": at},
    )


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


def press_dir(page, mode, d):
    if mode == "keys":
        page.keyboard.press(KEYS[d])
    elif mode == "wasd":
        page.keyboard.press(WASD[d])
    else:
        page.click(f"#btn-{d}")


def check_2(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        log = []
        for mode in ["keys", "wasd", "buttons"]:
            for d in ["right", "down", "left", "up"]:
                before = pos(page)
                exp = next_stop(page, d)
                press_dir(page, mode, d)
                wait_settled(page)
                page.wait_for_timeout(50)
                now = m3(page, "player")
                got = {"row": now["row"], "col": now["col"]}
                want = exp if exp else before
                if got != want:
                    return False, f"{mode} {d} from {before}: got {got} want {want}"
                if exp and now["facing"] != d:
                    return False, f"{mode} {d}: facing {now['facing']}"
                log.append(f"{mode}:{d}->{got['row']},{got['col']}")
        # 往墙走：找一个走不动的方向
        blocked = None
        for d in ["up", "left", "down", "right"]:
            if next_stop(page, d) is None:
                blocked = d
                break
        if blocked is None:
            return False, "no blocked direction found at " + str(pos(page))
        before = pos(page)
        page.keyboard.press(KEYS[blocked])
        page.wait_for_timeout(300)
        if pos(page) != before or m3(page, "state") != "idle":
            return False, f"walked into wall {blocked}"
        ok, msg = no_errors(errors)
        return ok, f"{' '.join(log)} wall={blocked} {msg}".strip()
    finally:
        close(page)


def walk_to_win(page, limit=200):
    for _ in range(limit):
        if m3(page, "state") == "won":
            return True
        d = path_dir(page)
        if d is None:
            return m3(page, "state") == "won"
        page.keyboard.press(KEYS[d])
        wait_settled(page)
    return m3(page, "state") == "won"


def check_6(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        if not walk_to_win(page):
            return False, f"did not win, player={m3(page, 'player')}"
        page.wait_for_timeout(100)
        win_visible = page.is_visible("#win")
        text = page.inner_text("#win")
        if not win_visible or "恭喜！你成功走出了迷宫！" not in text:
            return False, f"win visible={win_visible} text={text!r}"
        seed_before = url_seed(page)
        gen = m3(page, "generation")
        page.click("#again-btn")
        wait_idle(page)
        page.wait_for_timeout(100)
        hidden = not page.is_visible("#win")
        gen2 = m3(page, "generation")
        p = pos(page)
        seed_after = url_seed(page)
        seed_m = str(m3(page, "seed"))
        ok = (
            hidden
            and gen2 == gen + 1
            and p == {"row": 0, "col": 0}
            and seed_after != seed_before
            and seed_after == seed_m
        )
        ok_err, msg = no_errors(errors)
        return (
            ok and ok_err,
            (
                f"won; again: hidden={hidden} gen {gen}->{gen2} player={p} "
                f"seed {seed_before}->{seed_after} (__maze3d.seed={seed_m}) {msg}"
            ).strip(),
        )
    finally:
        close(page)


def check_6b(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        if not walk_to_win(page):
            return False, "did not win"
        before = m3(page, "player")
        page.keyboard.press("ArrowUp")
        page.wait_for_timeout(300)
        # 胜利遮罩盖住了方向按钮，直接派发 pointerdown 验证处理函数本身会丢弃输入
        page.dispatch_event("#btn-left", "pointerdown")
        page.wait_for_timeout(300)
        after = m3(page, "player")
        state = m3(page, "state")
        ok = after == before and state == "won"
        return ok, f"before={before} after={after} state={state}"
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


def check_14(browser, base):
    """跟随视角移动全过程中相机水平朝向保持朝北（偏航 0）。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        if m3(page, "view") != "follow":
            return False, f"default view={m3(page, 'view')}"
        # 南北移动不会让 lookAt 产生偏航，要找一次横向（东西）移动
        d = None
        for _ in range(50):
            d = next(
                (h for h in ["right", "left"] if next_stop(page, h) is not None), None
            )
            if d is not None:
                break
            step = path_dir(page)
            if step is None:
                break
            page.keyboard.press(KEYS[step])
            wait_settled(page)
        if d is None:
            return False, f"no horizontal move found, player={pos(page)}"
        page.wait_for_timeout(1000)  # 等相机追上，从静止状态开始记录
        start = pos(page)
        # 每帧记录相机偏航，直到移动结束后再多记 1 秒（覆盖相机追赶阶段）
        page.evaluate(
            "() => { window.__yaws = []; const tick = () => {"
            " window.__yaws.push(window.__maze3d.cameraYaw);"
            " if (window.__yaws.length < 600) requestAnimationFrame(tick); };"
            " requestAnimationFrame(tick); }"
        )
        page.keyboard.press(KEYS[d])
        wait_settled(page)
        page.wait_for_timeout(1000)
        yaws = page.evaluate("() => window.__yaws.slice()")
        worst = max(abs(y) for y in yaws) if yaws else None
        moved = pos(page) != start
        ok_err, msg = no_errors(errors)
        ok = ok_err and moved and len(yaws) > 10 and worst < 1e-6
        return (
            ok,
            f"dir={d} frames={len(yaws)} maxYaw={worst} moved={moved} {msg}".strip(),
        )
    finally:
        close(page)


def entrance_dir(page):
    for d in ["down", "right"]:
        if next_stop(page, d) is not None:
            return d
    return None


def check_11(browser, base):
    details = []
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        # (a) 动画中途切换尺寸 / 重新生成
        for target, want_size in [("#size-15", 15), ("#regen-btn", 15)]:
            d = entrance_dir(page)
            gen = m3(page, "generation")
            page.keyboard.press(KEYS[d])
            state_at_click = page.evaluate(
                "sel => { const s = window.__maze3d.state;"
                " document.querySelector(sel).click(); return s; }",
                target,
            )
            page.wait_for_timeout(1000)
            ok = (
                state_at_click == "moving"
                and m3(page, "size") == want_size
                and pos(page) == {"row": 0, "col": 0}
                and m3(page, "generation") == gen + 1
                and m3(page, "state") == "idle"
            )
            details.append(f"a:{target} state_at_click={state_at_click} ok={ok}")
            if not ok:
                return False, " ".join(details) + f" player={pos(page)}"
    finally:
        close(page)

    # (b) 20ms 内连按 5 次，只走一次
    page, errors2 = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        d = entrance_dir(page)
        exp = next_stop(page, d)
        for _ in range(5):
            page.keyboard.press(KEYS[d])
        wait_settled(page)
        page.wait_for_timeout(500)
        got = pos(page)
        ok = got == exp
        details.append(f"b:{d} got={got} want={exp}")
        if not ok:
            return False, " ".join(details)
    finally:
        close(page)

    # (c) 按住 800ms（自动连发），松开后不再多走
    page, errors3 = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        d = entrance_dir(page)
        key = KEYS[d]
        page.keyboard.down(key)
        t0 = time.time()
        while time.time() - t0 < 0.8:
            page.wait_for_timeout(33)
            page.keyboard.down(key)  # 再次 down = repeat 事件
        page.keyboard.up(key)
        wait_settled(page)
        p1 = pos(page)
        s1 = m3(page, "state")
        page.wait_for_timeout(500)
        p2 = pos(page)
        s2 = m3(page, "state")
        ok = p1 == p2 and s1 == s2
        details.append(f"c:{d} after_release={p1} later={p2} state={s1}->{s2}")
        if not ok:
            return False, " ".join(details)
    finally:
        close(page)

    # (d) 第一人称前进途中切换视角：动画丢弃，小人落在点击时的显示格
    page, errors4 = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        page.click("#view-btn")
        facing = face_walkable(page)
        if facing is None:
            return False, " ".join(details) + " d: no walkable direction"
        page.keyboard.press("ArrowUp")
        at_click = page.evaluate(
            "() => { const M = window.__maze3d; const s = M.state; const d = M.display;"
            " document.getElementById('view-btn').click(); return { state: s, display: d }; }"
        )
        state = m3(page, "state")
        p1 = pos(page)
        page.wait_for_timeout(1000)
        p2 = pos(page)
        ok = (
            at_click["state"] == "moving"
            and state == "idle"
            and p1 == at_click["display"]
            and p2 == p1
        )
        details.append(
            f"d:state_at_click={at_click['state']} display={at_click['display']}"
            f" player={p1} later={p2} state={state}"
        )
        if not ok:
            return False, " ".join(details)
    finally:
        close(page)

    ok, msg = no_errors(errors + errors2 + errors3 + errors4)
    return ok, (" ".join(details) + " " + msg).strip()


FOG_STATE_JS = """(() => {
  const vis = M.wallsVisible();
  const want = M.segments.map((s) => L.wallInView(s, M.display, arg));
  let wallMismatch = 0;
  for (let i = 0; i < want.length; i++) if (vis[i] !== want[i]) wallMismatch++;
  let floorMismatch = 0;
  for (let row = 0; row < M.size; row++)
    for (let col = 0; col < M.size; col++) {
      const inView = L.isInFogView(M.display, { row, col }, arg);
      const hex = M.floorColorHex(row, col);
      if (!inView && hex !== '#333333') floorMismatch++;
      if (inView && hex === '#333333') floorMismatch++;
    }
  return { wallMismatch, floorMismatch, walls: want.length };
})()"""


def click_until_disabled(page, sel, limit=40):
    for _ in range(limit):
        if page.is_disabled(sel):
            return True
        page.click(sel)
    return page.is_disabled(sel)


def check_4(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=20")
    details = []
    try:
        wait_idle(page)
        # (a) 默认迷雾
        fog = m3(page, "fog")
        r = logic(page, FOG_STATE_JS, 5)
        ok = fog == {"on": True, "radius": 5} and r["wallMismatch"] == 0
        ok = ok and r["floorMismatch"] == 0
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
        dark = page.evaluate(
            "() => { const M = window.__maze3d; let n = 0;"
            " for (let r = 0; r < M.size; r++) for (let c = 0; c < M.size; c++)"
            " if (M.floorColorHex(r, c) === '#333333') n++; return n; }"
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
        # (e) 空闲时不重算，移动后重算
        n0 = m3(page, "fogRecomputeCount")
        page.wait_for_timeout(1000)
        n1 = m3(page, "fogRecomputeCount")
        d = entrance_dir(page)
        page.keyboard.press(KEYS[d])
        wait_settled(page)
        n2 = m3(page, "fogRecomputeCount")
        ok = n0 == n1 and n2 > n1
        details.append(f"e:count {n0}->{n1} idle, ->{n2} after move")
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


def check_5(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    details = []
    try:
        wait_idle(page)
        page.keyboard.press(KEYS[entrance_dir(page)])
        wait_idle(page)
        page.click("#show-path-btn")
        r = logic(page, PATH_STATE_JS)
        details.append(f"show:{r} showPath={m3(page, 'showPath')}")
        if r["bad"] != 0 or r["len"] < 2:
            return False, " ".join(details)
        # 再走一步，路径按新位置重算
        moved = False
        for d in ["right", "down", "left", "up"]:
            if next_stop(page, d) is not None:
                page.keyboard.press(KEYS[d])
                wait_settled(page)
                moved = True
                break
        r = logic(page, PATH_STATE_JS)
        details.append(f"after-move({moved}) at {pos(page)}:{r}")
        if not moved or r["bad"] != 0:
            return False, " ".join(details)
        page.click("#hide-path-btn")
        res = logic(
            page,
            """(() => {
              let red = 0;
              for (let row = 0; row < M.size; row++)
                for (let col = 0; col < M.size; col++)
                  if (M.floorColorHex(row, col) === '#ff6b6b') red++;
              const startIn = L.isInFogView(M.display, { row: 0, col: 0 }, M.fog.radius) || !M.fog.on;
              const endIn = L.isInFogView(M.display, { row: M.size - 1, col: M.size - 1 }, M.fog.radius) || !M.fog.on;
              return {
                red,
                start: M.floorColorHex(0, 0),
                startWant: startIn ? '#4caf50' : '#333333',
                end: M.floorColorHex(M.size - 1, M.size - 1),
                endWant: endIn ? '#e53935' : '#333333',
              };
            })()""",
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


def face_walkable(page):
    """第一人称下转身到一个可走的方向，返回该方向；找不到返回 None。"""
    for _ in range(4):
        facing = m3(page, "player")["facing"]
        if next_stop(page, facing) is not None:
            return facing
        page.keyboard.press("ArrowLeft")
        wait_idle(page)
    return None


def check_3(browser, base):
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    details = []
    try:
        wait_idle(page)
        page.click("#view-btn")
        page.wait_for_timeout(100)
        view = m3(page, "view")
        text = page.inner_text("#view-btn")
        mini = page.is_visible("#minimap")
        pv = m3(page, "playerVisible")
        details.append(
            f"first: view={view} btn={text} minimap={mini} playerVisible={pv}"
        )
        if not (view == "first" and text == "切换到跟随视角" and mini and pv is False):
            return False, " ".join(details)
        start = pos(page)
        turns = []
        for key, how in [
            ("ArrowLeft", "left"),
            ("ArrowRight", "right"),
            ("ArrowDown", "back"),
            ("ArrowDown", "back"),
        ]:
            before = m3(page, "player")["facing"]
            want = logic(page, "L.turn(arg.f, arg.h)", {"f": before, "h": how})
            page.keyboard.press(key)
            wait_idle(page)
            got = m3(page, "player")["facing"]
            turns.append(f"{key}:{before}->{got}")
            if got != want or pos(page) != start:
                return False, " ".join(details + turns) + f" want={want}"
        if turns[0] != "ArrowLeft:down->right":
            return False, " ".join(details + turns)
        details.append(" ".join(turns))
        facing = face_walkable(page)
        if facing is None:
            return False, " ".join(details) + " no walkable direction"
        before = pos(page)
        exp = next_stop(page, facing)
        img0 = minimap_data(page)
        page.keyboard.press("ArrowUp")
        wait_settled(page)
        got = pos(page)
        img1 = minimap_data(page)
        details.append(
            f"forward {facing}: {before}->{got} want={exp} minimapChanged={img0 != img1}"
        )
        if got != exp or img0 == img1:
            return False, " ".join(details)
        page.click("#view-btn")
        page.wait_for_timeout(100)
        view = m3(page, "view")
        mini = page.is_visible("#minimap")
        pv = m3(page, "playerVisible")
        details.append(f"follow: view={view} minimap={mini} playerVisible={pv}")
        ok = view == "follow" and not mini and pv is True
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
        canvas = box_of(page, "#stage > canvas:not(#minimap)")
        cx = canvas["x"] + canvas["width"] / 2
        cy = canvas["y"] + canvas["height"] / 2
        center = {"x": cx - 60, "y": cy - 60, "width": 120, "height": 120}
        bad = []
        for d in ["up", "down", "left", "right"]:
            b = box_of(page, f"#btn-{d}")
            if intersects(b, center) or b["width"] < 56 or b["height"] < 56:
                bad.append(f"{d}:{b}")
        page.click("#view-btn")
        page.wait_for_timeout(200)
        mini = box_of(page, "#minimap")
        mini_ok = inside(mini, canvas)
        page.screenshot(path=str(SCRATCH / "maze3d-375x667.png"), full_page=True)
        details.append(
            f"portrait: scrollWidth={sw} dpadBad={bad} minimapInside={mini_ok}"
        )
        if sw > 375 or bad or not mini_ok:
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


def play_rounds(page):
    """跟随视角走 10 步（赢了就再来一局），再切第一人称做 10 次前进 / 转身。"""
    for _ in range(10):
        if m3(page, "state") == "won":
            page.click("#again-btn")
            wait_idle(page)
        d = path_dir(page)
        if d is None:
            page.click("#again-btn")
            wait_idle(page)
            d = path_dir(page)
        page.keyboard.press(KEYS[d])
        wait_settled(page, timeout=15000)
    if m3(page, "state") == "won":
        page.click("#again-btn")
        wait_idle(page)
    page.click("#view-btn")
    for i in range(10):
        if m3(page, "state") == "won":
            page.click("#again-btn")
            wait_idle(page)
        facing = m3(page, "player")["facing"]
        if i % 3 != 2 and next_stop(page, facing) is not None:
            page.keyboard.press("ArrowUp")
        else:
            page.keyboard.press("ArrowLeft")
        wait_settled(page, timeout=15000)


def perf_round(browser, base, mobile, init_script=None):
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
        play_rounds(page)
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
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10&debug=1&slow=40")
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
        d = entrance_dir(page)
        exp = next_stop(page, d)
        page.keyboard.press(KEYS[d])
        wait_settled(page, timeout=10000)
        got = pos(page)
        details.append(f"move {d}: {got} want {exp}")
        if got != exp:
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
        for tid in THEME_IDS:
            click_theme(page, tid)
            th = m3(page, "theme")
            act = active_themes(page)
            got = m3(page, "floorColorHex(1, 1)")
            want = floor_base_hex(page, tid)
            tc = m3(page, "textureCount")
            details.append(f"{tid}: floor={got}/{want} textures={tc}")
            if th != tid or act != [tid] or got != want or tc != 4:
                return False, " ".join(details) + f" theme={th} active={act}"
        builds = m3(page, "textureStats")["builds"]
        click_theme(page, THEME_IDS[-1])
        b2 = m3(page, "textureStats")["builds"]
        tc = m3(page, "textureCount")
        details.append(f"reclick builds {builds}->{b2} textures={tc}")
        if b2 != builds or tc != 4:
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
        if got != want or b2 != builds or tc != 4 or size != 15:
            return False, " ".join(details) + f" got={got} want={want}"
        ok, msg = no_errors(errors)
        return ok, (" ".join(details) + " " + msg).strip()
    finally:
        close(page)


def far_direction(page):
    """找一个下一站与当前格相距至少 2 格的方向；找不到就沿最短路走一步再找，最多 20 次。"""
    for _ in range(20):
        here = pos(page)
        for d in ["right", "down", "left", "up"]:
            stop = next_stop(page, d)
            if (
                stop
                and abs(stop["row"] - here["row"]) + abs(stop["col"] - here["col"]) >= 2
            ):
                return d, stop
        step = path_dir(page)
        if step is None:
            return None, None
        page.keyboard.press(KEYS[step])
        wait_settled(page)
    return None, None


CLICK_DURING_JS = (
    "(id) => { const s = window.__maze3d.state;"
    " document.getElementById(id).click(); return s; }"
)


def check_t3(browser, base):
    """移动与转身动画途中切换主题：动画照常完成，迷宫不重建。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    details = []
    try:
        wait_idle(page)
        d, exp = far_direction(page)
        if d is None:
            return False, f"no long move found, player={pos(page)}"
        gen0 = m3(page, "generation")
        page.keyboard.press(KEYS[d])
        st = page.evaluate(CLICK_DURING_JS, "theme-castle")
        wait_settled(page)
        got = pos(page)
        gen1 = m3(page, "generation")
        th = m3(page, "theme")
        details.append(
            f"move {d}: state_at_click={st} pos={got} want={exp} gen {gen0}->{gen1} theme={th}"
        )
        if st != "moving" or got != exp or gen1 != gen0 or th != "castle":
            return False, " ".join(details)
        page.click("#view-btn")
        wait_idle(page)
        before = m3(page, "player")["facing"]
        want = logic(page, "L.turn(arg, 'left')", before)
        page.keyboard.press("ArrowLeft")
        st = page.evaluate(CLICK_DURING_JS, "theme-brick")
        wait_idle(page)
        got = m3(page, "player")["facing"]
        th = m3(page, "theme")
        details.append(
            f"turn: state_at_click={st} facing {before}->{got} want={want} theme={th}"
        )
        if st != "turning" or got != want or th != "brick":
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
    """反复切换主题：旧纹理被释放，存活纹理数恒为 4。"""
    page, errors = open_page(browser, f"{base}{PAGE}?seed={S}&size=10")
    try:
        wait_idle(page)
        stats = m3(page, "textureStats")
        if stats["builds"] != 1 or m3(page, "textureCount") != 4:
            return False, f"start: stats={stats} textures={m3(page, 'textureCount')}"
        prev = 1
        for i in range(20):
            tid = THEME_IDS[(i + 1) % 4]
            click_theme(page, tid)
            tc = m3(page, "textureCount")
            builds = m3(page, "textureStats")["builds"]
            if tc != 4 or builds != prev + 1:
                return False, f"i={i} tid={tid} textures={tc} builds {prev}->{builds}"
            prev = builds
        tc = m3(page, "textureCount")
        builds = m3(page, "textureStats")["builds"]
        if tc != 4 or builds != 21:
            return False, f"after 20 switches: textures={tc} builds={builds}"
        click_theme(page, m3(page, "theme"))
        tc2 = m3(page, "textureCount")
        b2 = m3(page, "textureStats")["builds"]
        ms = m3(page, "textureStats")["lastMs"]
        detail = f"20 switches: textures={tc} builds={builds}; reclick textures={tc2} builds={b2} lastMs={ms:.1f}"
        ok_err, msg = no_errors(errors)
        ok = ok_err and tc2 == 4 and b2 == 21
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


def face_wall(page, max_moves=10):
    """第一人称下转身到正前方是一段墙（迷宫内部的墙，不是外边界）；返回朝向，找不到返回 None。

    迷宫外边界不画墙，所以要求前方的相邻格在迷宫内。当前格没有这样的墙时，
    朝可走的方向前进一站再找，最多前进 max_moves 次。
    """
    for _ in range(max_moves + 1):
        n = m3(page, "size")
        for i in range(4):
            p = m3(page, "player")
            dr, dc = DIRS[p["facing"]]
            r, c = p["row"] + dr, p["col"] + dc
            inside_maze = 0 <= r < n and 0 <= c < n
            if inside_maze and next_stop(page, p["facing"]) is None:
                return p["facing"]
            if i < 3:
                page.keyboard.press("ArrowLeft")
                wait_idle(page)
        if face_walkable(page) is None:
            return None
        page.keyboard.press("ArrowUp")
        wait_settled(page)
        if m3(page, "state") != "idle":
            return None
    return None


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
        page, errors = open_page(browser, f"{bbase}{PAGE}?seed={S}&size=10")
        try:
            wait_idle(page)
            page.click("#view-btn")
            facing = face_wall(page)
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
            browser, f"{base}{PAGE}?seed={S}&size=10", init_script=theme_init(tid)
        )
        try:
            wait_idle(page)
            page.click("#view-btn")
            facing = face_wall(page)
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


def check_t5(browser, base):
    """各主题下五类地板格（普通、起点、终点、道路、迷雾）在屏幕上两两颜色距离 ≥ 60。"""
    details = []
    all_ok = True
    for tid in THEME_IDS:
        page, errors = open_page(
            browser,
            f"{base}{PAGE}?seed={S}&size=10",
            init_script=theme_init(tid) + preset_storage("0", "1"),
        )
        got = {}
        notes = []
        try:
            wait_idle(page)
            n = m3(page, "size")
            end = {"row": n - 1, "col": n - 1}
            # 场景 A：迷雾关、道路关
            page.keyboard.press(KEYS[entrance_dir(page)])
            settle_camera(page)
            img = canvas_image(page)
            got["start"], _ = sample_kind(page, img, [(0, 0)], "start")
            got["floor"], at = sample_kind(page, img, cells_by_distance(page), "floor")
            notes.append(f"floor@{at}")
            for _ in range(60):
                if chebyshev(pos(page), end) <= 2:
                    break
                d = path_dir(page)
                if d is None or next_stop(page, d) == end:
                    break
                page.keyboard.press(KEYS[d])
                wait_settled(page)
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
                cells_by_distance(page, lambda cell, dist: 2 <= dist <= 3),
                "fog",
            )
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
            for _ in range(60):
                here = pos(page)
                if chebyshev(here, end) <= 1 and here != end:
                    break
                d = path_dir(page)
                if d is None:
                    break
                page.keyboard.press(KEYS[d])
                wait_settled(page)
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
                and end_kind_c == "fog"
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
                runs = [("baseline", perf_round(gb, bbase, mobile=True))]
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
        if an0 != [1, 1, 1]:
            return False, " ".join(details)
        page.click("#view-btn")
        facing = face_wall(page)
        if facing is None:
            return False, " ".join(details) + " no wall to face"
        for tid in THEME_IDS:
            click_theme(page, tid)
            th = m3(page, "theme")
            act = active_themes(page)
            wc = m3(page, "wallContrast()")
            an = m3(page, "textureAnisotropy")
            ok = th == tid and act == [tid] and contrast_ok(wc) and an == [1, 1, 1]
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
            and an == [1, 1, 1]
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
            f"{base}{PAGE}?seed={S}&size=10",
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
            face_walkable(page)
            page.wait_for_timeout(300)
            f = SHOTS / f"{tid}-first.png"
            canvas_image(page).save(f)
            files.append(f)
            face_wall(page)
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


# ---------------------------------------------------------------- runner

CHECKS = {
    "1": check_1,
    "10": check_10,
    "12": check_12,
    "2": check_2,
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
    "14": check_14,
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
            f"人工检查：待用户查看 {SHOTS} 下 12 张截图，确认四种风格纹理明显",
            "",
        ]
        RESULTS.write_text("\n".join(header + lines) + "\n", encoding="utf-8")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
