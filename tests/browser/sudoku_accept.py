"""数独页面浏览器验收脚本。

用法：
    ~/tmp/fuck/c/.venv/bin/python tests/browser/sudoku_accept.py [--only 1,3] [--headed]

在仓库根目录起 python3 -m http.server（只绑 127.0.0.1），用 Playwright 驱动 Chromium
逐项检查任务简报 Step 5 的验收清单，打印 PASS / FAIL；任一项失败时退出码为 1。
截图保存到 .superpowers/sdd/2026-11-14-sudoku/shots/（已被 git 忽略）。
"""

import argparse
import socket
import subprocess
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
SHOTS = ROOT / ".superpowers/sdd/2026-11-14-sudoku/shots"
PAGE = "/sudoku/index.html"
ERRORS = []  # 全部页面的 console error / pageerror


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
    deadline = time.time() + 10
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return proc, f"http://127.0.0.1:{port}"
        except OSError:
            time.sleep(0.1)
    proc.kill()
    raise RuntimeError("http.server did not start")


class Ctx:
    def __init__(self, browser, base):
        self.browser = browser
        self.base = base

    def open(self, hash_="#/", viewport=None, context=None):
        """新开上下文（干净的 localStorage）打开页面；传 context 则复用。"""
        if context is None:
            context = self.browser.new_context(
                viewport=viewport or {"width": 820, "height": 1180},
                device_scale_factor=2,
            )
        page = context.new_page()
        page.on(
            "console",
            lambda m: (
                ERRORS.append(f"console: {m.text}") if m.type == "error" else None
            ),
        )
        page.on("pageerror", lambda e: ERRORS.append(f"pageerror: {e}"))
        page.goto(self.base + PAGE + hash_)
        page.wait_for_selector("#screen > *")
        return page


def shot(page, name):
    SHOTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOTS / f"{name}.png"))


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def givens(page):
    """盘面题面串：题面数字照写，其他格写 '.'。"""
    return page.evaluate(
        "() => [...document.querySelectorAll('#board .cell')]"
        ".map(c => c.classList.contains('given') ? c.textContent.trim() : '.').join('')"
    )


def solution_for(page, chapter, slot):
    """在题库里找出当前盘面所用的变体，返回解串。"""
    puz = givens(page)
    sol = page.evaluate(
        "async ([chapter, slot, puz]) => {"
        " const { CHAPTERS } = await import('/sudoku/data/drills.js');"
        " const v = CHAPTERS.find(c => c.id === chapter).slots[slot].find(v => v.puzzle === puz);"
        " return v ? v.solution : null; }",
        [chapter, slot, puz],
    )
    check(sol, f"盘面 {puz} 不在 {chapter}/{slot} 的变体里")
    return sol


def empty_cells(page):
    return page.evaluate(
        "() => [...document.querySelectorAll('#board .cell')]"
        ".filter(c => !c.querySelector('.digit')).map(c => Number(c.dataset.cell))"
    )


def cell(page, c):
    return page.locator(f'#board .cell[data-cell="{c}"]')


def cell_classes(page, c):
    return cell(page, c).get_attribute("class").split()


def tap(page, c):
    cell(page, c).click()


def key(page, d):
    page.locator(f'#pad .key[data-digit="{d}"]').click()


def hearts(page):
    el = page.locator("#hearts")
    if not el.is_visible():
        return None
    return el.text_content().count("❤")


def hint_btn(page):
    return page.locator('#tools [data-action="hint"]').text_content().strip()


def hint_text(page):
    return page.locator("#hint").text_content().strip()


# ---------------------------------------------------------------- checks


def c1_home(ctx):
    """首页显示 4 章与自由练习，切换开关后刷新仍保持。"""
    page = ctx.open("#/")
    names = page.locator(".chapter .ch-name").all_text_contents()
    check(names == ["排除法", "唯一余数", "区块", "数对"], f"章节 {names}")
    counts = page.locator(".chapter .ch-count").all_text_contents()
    check(counts == ["0/8"] * 4, f"进度 {counts}")
    check(page.locator('[data-action="size"]').count() == 2, "尺寸按钮")
    check(page.locator('[data-action="level"]').count() == 4, "档位按钮")
    check(page.locator('[data-action="start"]').is_visible(), "开始按钮")
    toggle = page.locator('[data-action="instant"]')
    check("on" in toggle.get_attribute("class").split(), "开关默认开")
    shot(page, "1-home")
    toggle.click()
    check("on" not in toggle.get_attribute("class").split(), "点击后关")
    page.reload()
    page.wait_for_selector(".chapter")
    toggle = page.locator('[data-action="instant"]')
    check("on" not in toggle.get_attribute("class").split(), "刷新后仍为关")
    check(toggle.locator(".switch").text_content() == "关", "开关文字")
    shot(page, "1-home-toggle-off")
    page.context.close()


def c2_fill(ctx):
    """第 1 章第 1 题：两种填数方式、填错变红扣红心、连错 5 次出现「再试一次」。"""
    page = ctx.open("#/ch/hidden")
    page.locator('.slot[data-slot="0"]').click()
    page.wait_for_selector("#board .cell")
    check(page.locator("#title").text_content() == "排除法 · 第 1 题", "标题")
    sol = solution_for(page, "hidden", 0)
    empties = empty_cells(page)
    check(hearts(page) == 5, "开局 5 颗红心")
    shot(page, "2-start")

    # 先选数字：没选中格子时点数字键 → 拿在手上，连续点空格
    d = int(sol[empties[0]])
    targets = [c for c in empties if int(sol[c]) == d]
    key(page, d)
    check(
        "on" in page.locator(f'#pad .key[data-digit="{d}"]').get_attribute("class"),
        "数字键高亮",
    )
    for c in targets:
        tap(page, c)
        check(cell(page, c).text_content() == str(d), f"格 {c} 填入 {d}")
        check("player" in cell_classes(page, c), "玩家数字样式")
    shot(page, "2-held-digit")
    key(page, d)  # 放下

    # 先点格子再点数字
    rest = [c for c in empty_cells(page)]
    a = rest[0]
    tap(page, a)
    check("sel" in cell_classes(page, a), "选中格")
    key(page, int(sol[a]))
    check(cell(page, a).text_content() == sol[a], "先点格子再填数")
    check("wrong" not in cell_classes(page, a), "正确数不标红")
    check(hearts(page) == 5, "填对不扣红心")

    # 填错：同一格改填 5 个错数
    b = rest[1]
    tap(page, b)
    wrongs = [x for x in range(1, 7) if x != int(sol[b])]
    for i, w in enumerate(wrongs):
        if i == 4:
            shot(page, "2-four-wrong")
        key(page, w)
        if i < 4:
            check("wrong" in cell_classes(page, b), "错数标红")
            check(hearts(page) == 4 - i, f"第 {i + 1} 次填错后红心 {hearts(page)}")
    page.wait_for_selector("#overlay:not([hidden])")
    retry = page.locator('#overlay [data-action="restart"]')
    check(retry.is_visible() and "再试一次" in retry.text_content(), "再试一次")
    page.wait_for_timeout(400)
    shot(page, "2-failed")
    retry.click()
    check(page.locator("#overlay").is_hidden(), "遮罩关闭")
    check(hearts(page) == 5, "重来后红心恢复")
    check(len(empty_cells(page)) == len(empties), "重来后清空玩家数字")
    page.context.close()


def c3_hint(ctx):
    """点提示 3 次依次出现层 1/2/3，按钮数字递减；层 3 后再点不减。"""
    page = ctx.open("#/play/hidden/0")
    page.wait_for_selector("#board .cell")
    check(hint_btn(page) == "💡 5", f"初始 {hint_btn(page)}")
    check(hint_text(page) == "", "开始无提示")
    texts = []
    for layer in (1, 2, 3):
        page.locator('#tools [data-action="hint"]').click()
        texts.append(hint_text(page))
        if layer == 1:
            check(page.locator("#board .h-focus").count() > 0, "层 1 高亮目标单元")
        if layer == 2:
            check(page.locator("#board .h-digit").count() > 0, "层 2 高亮数字")
        check(hint_btn(page) == f"💡 {5 - layer}", f"层 {layer} 后 {hint_btn(page)}")
        shot(page, f"3-hint-layer{layer}")
    check(len(set(texts)) == 3 and all(texts), f"三层文案 {texts}")
    check(page.locator("#board .h-shade").count() > 0, "层 3 有灰格")
    page.locator('#tools [data-action="hint"]').click()
    check(hint_btn(page) == "💡 2", "层 3 后再点不减")
    check(hint_text(page) == texts[2], "层 3 后文案不变")
    page.context.close()


def note_counts(page):
    return page.evaluate(
        "() => ({ note: document.querySelectorAll('#board .n.note').length,"
        " strike: document.querySelectorAll('#board .n.strike').length,"
        " temp: document.querySelectorAll('#board .n.temp').length })"
    )


def c4_locked(ctx):
    """第 3 章：候选自动显示，第 3 层划掉候选，撤销恢复。"""
    page = ctx.open("#/play/locked/0")
    page.wait_for_selector("#board .cell")
    n0 = note_counts(page)
    check(n0["note"] > 0, "区块章自动显示候选")
    shot(page, "4-locked-start")
    hb = page.locator('#tools [data-action="hint"]')
    hb.click()
    hb.click()
    check(page.locator("#board .h-outline").count() >= 2, "层 2 框出候选格")
    shot(page, "4-locked-layer2")
    hb.click()
    n3 = note_counts(page)
    check(n3["strike"] > 0, f"层 3 有划掉的候选 {n3}")
    check(n3["note"] == n0["note"] - n3["strike"], f"划掉的候选从笔记里去掉 {n0} {n3}")
    shot(page, "4-locked-layer3")
    page.locator('#tools [data-action="undo"]').click()
    n4 = note_counts(page)
    check(n4["strike"] == 0 and n4["note"] == n0["note"], f"撤销后恢复 {n4}")
    check(hint_text(page) == "", "撤销后提示清掉")
    page.context.close()

    page = ctx.open("#/play/hidden/0")
    page.wait_for_selector("#board .cell")
    check(note_counts(page)["note"] == 0, "排除法章不自动显示候选")
    page.context.close()


def c5_win(ctx):
    """过关遮罩显示星星，返回章节列表后该题位显示星星。"""
    page = ctx.open("#/play/hidden/1")
    page.wait_for_selector("#board .cell")
    sol = solution_for(page, "hidden", 1)
    for c in empty_cells(page):
        tap(page, c)
        key(page, int(sol[c]))
    page.wait_for_selector("#overlay:not([hidden])")
    check(page.locator("#overlay .ov-stars").text_content() == "★★★", "过关 3 星")
    check(page.locator('#overlay [data-action="next"]').is_visible(), "下一题")
    check(page.locator('#overlay [data-action="again"]').is_visible(), "再来一题")
    page.wait_for_timeout(400)  # 等遮罩弹出动画结束再截图
    shot(page, "5-won")
    page.locator("#backBtn").click()
    page.wait_for_selector(".slot")
    check(
        page.locator('.slot[data-slot="1"] .slot-stars').text_content() == "★★★",
        "章节列表显示星星",
    )
    check("done" in page.locator('.slot[data-slot="1"]').get_attribute("class"), "")
    shot(page, "5-chapter-stars")
    page.locator("#backBtn").click()
    page.wait_for_selector(".chapter")
    check(page.locator(".chapter .ch-count").first.text_content() == "1/8", "首页进度")
    shot(page, "5-home-progress")
    # 下一题 / 再来一题
    page.goto(ctx.base + PAGE + "#/play/hidden/1")
    page.wait_for_selector("#board .cell")
    sol = solution_for(page, "hidden", 1)
    for c in empty_cells(page):
        tap(page, c)
        key(page, int(sol[c]))
    page.locator('#overlay [data-action="next"]').click()
    # hashchange 是异步的，等标题换掉再断言，避免读到旧盘面
    page.wait_for_function(
        "() => document.getElementById('title').textContent.includes('第 3 题')",
        timeout=3000,
    )
    check(page.locator("#title").text_content() == "排除法 · 第 3 题", "下一题")
    check(page.locator("#overlay").is_hidden(), "")
    page.context.close()


def c6_free(ctx):
    """自由练习 9×9 挑战能开出题。"""
    page = ctx.open("#/")
    page.locator('[data-action="size"][data-size="9"]').click()
    page.locator('[data-action="level"][data-level="hard"]').click()
    page.locator('[data-action="start"]').click()
    check("出题中" in page.locator("#board").text_content(), "出题中提示")
    shot(page, "6-generating")
    for _ in range(3):
        page.wait_for_selector(
            '#board .cell, #board [data-action="regen"]', timeout=15000
        )
        regen = page.locator('#board [data-action="regen"]')
        if regen.count() == 0:
            break
        regen.click()
    check(page.locator("#board .cell").count() == 81, "9×9 盘面")
    g = sum(ch != "." for ch in givens(page))
    check(17 <= g <= 60, f"题面数字 {g}")
    check(
        page.locator("#title").text_content() == "自由练习 · 9×9 挑战", "自由练习标题"
    )
    shot(page, "6-free-9-hard")
    page.context.close()

    page = ctx.open("#/free/6/easy")
    page.wait_for_selector("#board .cell", timeout=15000)
    check(page.locator("#board .cell").count() == 36, "6×6 盘面")
    page.context.close()


def fits(page, label):
    m = page.evaluate(
        "() => { const s = document.getElementById('screen');"
        " const keys = [...document.querySelectorAll('#pad .key')].map(k => k.getBoundingClientRect().height);"
        " const last = document.querySelector('#tools') || s;"
        " return { sw: document.documentElement.scrollWidth, iw: innerWidth,"
        " bodyW: document.body.scrollWidth, sh: s.scrollHeight, ch: s.clientHeight,"
        " sW: s.scrollWidth, cW: s.clientWidth,"
        " keys, bottom: last.getBoundingClientRect().bottom, ih: innerHeight }; }"
    )
    check(m["sw"] <= m["iw"] and m["bodyW"] <= m["iw"], f"{label} 横向滚动 {m}")
    check(m["sW"] <= m["cW"], f"{label} 内容横向溢出 {m}")
    return m


def c7_phone(ctx):
    """360×640：一屏放下、无横向滚动，数字键高度 ≥ 40px。"""
    vp = {"width": 360, "height": 640}
    for hash_, name in (
        ("#/play/hidden/0", "7-phone-6x6"),
        ("#/play/hidden/5", "7-phone-9x9"),
        ("#/play/pair/6", "7-phone-pair-9x9"),
    ):
        page = ctx.open(hash_, viewport=vp)
        page.wait_for_selector("#board .cell")
        m = fits(page, name)
        check(m["sh"] <= m["ch"], f"{name} 需要竖向滚动 {m}")
        check(m["bottom"] <= m["ih"], f"{name} 工具栏超出屏幕 {m}")
        check(m["keys"] and min(m["keys"]) >= 40, f"{name} 数字键高度 {m['keys']}")
        page.locator('#tools [data-action="hint"]').click()
        page.locator('#tools [data-action="hint"]').click()
        fits(page, name + "-hint")
        shot(page, name)
        page.context.close()
    for hash_, name in (("#/", "7-phone-home"), ("#/ch/locked", "7-phone-chapter")):
        page = ctx.open(hash_, viewport=vp)
        fits(page, name)
        shot(page, name)
        page.context.close()
    # 平板横竖屏只截图供人工检查，同时确认一屏放下
    for vp2, name in (
        ({"width": 1024, "height": 768}, "7-ipad-landscape"),
        ({"width": 768, "height": 1024}, "7-ipad-portrait"),
        ({"width": 1440, "height": 900}, "7-desktop"),
    ):
        page = ctx.open("#/play/locked/4", viewport=vp2)
        page.wait_for_selector("#board .cell")
        m = fits(page, name)
        check(m["sh"] <= m["ch"], f"{name} 需要竖向滚动 {m}")
        page.locator('#tools [data-action="hint"]').click()
        shot(page, name)
        page.context.close()


def c9_keyboard(ctx):
    """键盘：方向键移动选中格、数字键填数、Backspace 擦除、n 切换笔记。"""
    page = ctx.open("#/play/hidden/0")
    page.wait_for_selector("#board .cell")
    sol = solution_for(page, "hidden", 0)
    page.keyboard.press("ArrowRight")
    check("sel" in cell_classes(page, 0), "第一次方向键选中左上格")
    page.keyboard.press("ArrowRight")
    page.keyboard.press("ArrowDown")
    check("sel" in cell_classes(page, 7), "方向键移动")
    for _ in range(8):
        page.keyboard.press("ArrowRight")
    check("sel" in cell_classes(page, 11), "撞到右边停住、不取消选中")
    e = empty_cells(page)[0]
    tap(page, e)
    page.keyboard.press(sol[e])
    check(cell(page, e).text_content() == sol[e], "数字键填数")
    page.keyboard.press("Backspace")
    check(cell(page, e).text_content() == "", "Backspace 擦除")
    page.keyboard.press("n")
    check(
        "on" in page.locator('#tools [data-action="notes"]').get_attribute("class"),
        "n 切换笔记",
    )
    page.keyboard.press("1")
    page.keyboard.press("2")
    check(cell(page, e).locator(".n.note").count() == 2, "笔记模式下填小字")
    shot(page, "9-notes")
    page.context.close()


def c10_reselect(ctx):
    """R9：选中格子填完后，再点该格取消选中或选中题面格点数字，都能回到先选数字连续填。"""
    page = ctx.open("#/play/hidden/5")
    page.wait_for_selector("#board .cell")
    sol = solution_for(page, "hidden", 5)

    def digit_with_two(exclude=()):
        empties = empty_cells(page)
        for d in range(1, 10):
            cells = [c for c in empties if int(sol[c]) == d and c not in exclude]
            if len(cells) >= 2:
                return d, cells[:2]
        raise AssertionError("找不到还剩 2 格的数字")

    def held_fill(d, cells, label):
        check(
            "on" in page.locator(f'#pad .key[data-digit="{d}"]').get_attribute("class"),
            f"{label}：数字键 {d} 拿在手上",
        )
        check(page.locator("#board .cell.sel").count() == 0, f"{label}：没有选中格")
        for c in cells:
            tap(page, c)
            check(cell(page, c).text_content() == str(d), f"{label}：格 {c} 填入 {d}")
        key(page, d)  # 放下

    # 路径 1：选格填数 → 再点同一格取消选中 → 拿起数字连续填两格
    d, cells = digit_with_two()
    a = next(c for c in empty_cells(page) if c not in cells)
    tap(page, a)
    key(page, int(sol[a]))
    check(cell(page, a).text_content() == sol[a], "先点格子填数")
    check("sel" in cell_classes(page, a), "填完仍选中")
    tap(page, a)
    check("sel" not in cell_classes(page, a), "再点同一格取消选中")
    key(page, d)
    held_fill(d, cells, "取消选中后")
    shot(page, "10-deselect-held")

    # 路径 2：选格填数 → 点题面格 → 点数字直接拿起，连续填两格
    d, cells = digit_with_two()
    a = next(c for c in empty_cells(page) if c not in cells)
    tap(page, a)
    key(page, int(sol[a]))
    given = page.evaluate(
        "() => Number(document.querySelector('#board .cell.given').dataset.cell)"
    )
    tap(page, given)
    check("sel" in cell_classes(page, given), "选中题面格")
    key(page, d)
    held_fill(d, cells, "选中题面格后")
    check(page.locator("#hearts").text_content().count("❤") == 5, "全程没填错")
    shot(page, "10-given-held")
    page.context.close()


def c8_console(ctx):
    """控制台无报错（汇总前面所有页面）。"""
    check(not ERRORS, "控制台报错：\n" + "\n".join(ERRORS))


CHECKS = [
    ("1", c1_home),
    ("2", c2_fill),
    ("3", c3_hint),
    ("4", c4_locked),
    ("5", c5_win),
    ("6", c6_free),
    ("7", c7_phone),
    ("9", c9_keyboard),
    ("10", c10_reselect),
    ("8", c8_console),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="逗号分隔的检查编号")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()
    only = set(args.only.split(",")) if args.only else None
    proc, base = start_server()
    failed = 0
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=not args.headed)
            ctx = Ctx(browser, base)
            for num, fn in CHECKS:
                if only and num not in only:
                    continue
                t0 = time.time()
                try:
                    fn(ctx)
                    print(f"PASS {num} {fn.__doc__.strip()} ({time.time() - t0:.1f}s)")
                except Exception:
                    failed += 1
                    print(f"FAIL {num} {fn.__doc__.strip()}")
                    traceback.print_exc()
            browser.close()
    finally:
        proc.kill()
    print(f"截图目录：{SHOTS}")
    print("ALL PASS" if not failed else f"{failed} FAILED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
