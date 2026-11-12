"""3D 迷宫浏览器验收脚本。

用法：
    ~/tmp/fuck/c/.venv/bin/python tests/browser/maze3d_accept.py [--only 1,10,12] [--write]

脚本在仓库根目录起 python3 -m http.server（只绑 127.0.0.1），用 Playwright 驱动
Chromium 逐项检查，打印 PASS / FAIL；任一项失败时退出码为 1。
--write 把本次全部结果覆盖写入 tests/browser/test-results.txt。
"""

import argparse
import datetime
import json
import os
import socket
import subprocess
import sys
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, urlparse

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
DIRS = {"up": (-1, 0), "down": (1, 0), "left": (0, -1), "right": (0, 1)}


# ---------------------------------------------------------------- helpers


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start_server():
    port = free_port()
    proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1"],
        cwd=str(ROOT),
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

    ok, msg = no_errors(errors + errors2 + errors3)
    return ok, (" ".join(details) + " " + msg).strip()


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
}


def order_key(name):
    num = "".join(ch for ch in name if ch.isdigit())
    return (int(num), name)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
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
            f"命令：python tests/browser/maze3d_accept.py --write",
            f"总体：{'PASS' if all_ok else 'FAIL'}",
            "",
        ]
        RESULTS.write_text("\n".join(header + lines) + "\n", encoding="utf-8")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
