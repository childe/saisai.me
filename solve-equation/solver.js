// Each step has an `html` string with optional `.term-new` spans for fade-in animation
class Solver {
    solve(equationObj) {
        this.steps = [];
        let { leftX, leftC, rightX, rightC } = equationObj.state;

        // Show expanded form if parentheses (hard difficulty)
        if (equationObj.hasParens) {
            this._pushFinal(leftX, leftC, rightX, rightC);
        }

        // Move x to left: add (-rightX)x to both sides, then combine (2-phase animation)
        if (rightX !== 0) {
            const dx = -rightX;
            this._pushTwoPhase(
                leftX, leftC, rightX, rightC,   // current state
                dx, 0, dx, 0                     // what to add
            );
            leftX += dx;
            rightX = 0;
        }

        // Move constant to right: add (-leftC) to both sides, then combine
        if (leftC !== 0) {
            const dc = -leftC;
            this._pushTwoPhase(
                leftX, leftC, rightX, rightC,
                0, dc, 0, dc
            );
            leftC = 0;
            rightC += dc;
        }

        // Divide by x coefficient
        if (leftX !== 1) {
            rightC = rightC / leftX;
            leftX = 1;
            this._pushFinal(leftX, leftC, rightX, rightC);
        }

        // Verification
        this._verify(equationObj.original, rightC);

        return this.steps;
    }

    // Simple step: just show the final state (whole line fades in)
    _pushFinal(lx, lc, rx, rc) {
        const leftHtml = this._sideHtmlNormal(lx, lc);
        const rightHtml = this._sideHtmlNormal(rx, rc);
        this.steps.push({
            finalHtml: `${leftHtml}<span class="equals"> = </span>${rightHtml}`
        });
    }

    // Two-phase step:
    //   Phase 1 — show intermediate state (new terms fade in)
    //   Phase 2 — same line transitions to merged result
    _pushTwoPhase(lx, lc, rx, rc, newLX, newLC, newRX, newRC) {
        // Phase 1: current terms + new terms (term-new class)
        const leftInter = this._sideHtml(lx, lc, newLX, newLC);
        const rightInter = this._sideHtml(rx, rc, newRX, newRC);
        const intermediateHtml = `${leftInter}<span class="equals"> = </span>${rightInter}`;

        // Phase 2: merged result (plain)
        const finalLX = lx + newLX, finalLC = lc + newLC;
        const finalRX = rx + newRX, finalRC = rc + newRC;
        const leftFinal = this._sideHtmlNormal(finalLX, finalLC);
        const rightFinal = this._sideHtmlNormal(finalRX, finalRC);
        const finalHtml = `${leftFinal}<span class="equals"> = </span>${rightFinal}`;

        this.steps.push({ intermediateHtml, finalHtml });
    }

    // Side HTML with existing terms (normal) + new added terms (term-new)
    _sideHtml(x, c, newX, newC) {
        const parts = [];
        let first = true;

        if (x !== 0) { parts.push(this._span(this._xStr(x, first), 'normal')); first = false; }
        if (c !== 0) { parts.push(this._span(this._cStr(c, first), 'normal')); first = false; }
        if (newX !== 0) { parts.push(this._span(this._xStr(newX, first), 'new')); first = false; }
        if (newC !== 0) { parts.push(this._span(this._cStr(newC, first), 'new')); }

        return parts.length ? parts.join('') : this._span('0', 'normal');
    }

    // Side HTML with only existing terms (no animation markers)
    _sideHtmlNormal(x, c) {
        const parts = [];
        let first = true;
        if (x !== 0) { parts.push(this._span(this._xStr(x, first), 'normal')); first = false; }
        if (c !== 0) { parts.push(this._span(this._cStr(c, first), 'normal')); }
        return parts.length ? parts.join('') : this._span('0', 'normal');
    }

    _span(text, type) {
        return type === 'new'
            ? `<span class="term term-new">${text}</span>`
            : `<span class="term">${text}</span>`;
    }

    _xStr(coeff, isFirst) {
        if (coeff === 0) return '';
        if (coeff === 1) return isFirst ? 'x' : '+x';
        if (coeff === -1) return '-x';
        return (coeff > 0 && !isFirst ? '+' : '') + coeff + 'x';
    }

    _cStr(n, isFirst) {
        if (n === 0) return '';
        const str = Number.isInteger(n) ? String(n) : this._fracStr(n);
        return (n > 0 && !isFirst ? '+' : '') + str;
    }

    _fracStr(n) {
        for (let d = 2; d <= 20; d++) {
            const num = Math.round(n * d);
            if (Math.abs(num / d - n) < 1e-9) {
                const g = this._gcd(Math.abs(num), d);
                return `${num / g}/${d / g}`;
            }
        }
        return n.toFixed(2);
    }

    _gcd(a, b) { return b === 0 ? a : this._gcd(b, a % b); }

    _verify(original, xVal) {
        const [left, right] = original.split('=');
        const xStr = Number.isInteger(xVal) ? String(xVal) : this._fracStr(xVal);

        // Label step
        this.steps.push({
            finalHtml: `<span class="verify-label">── 验证：将 x = ${xStr} 代入原式 ──</span>`,
            isVerify: true
        });

        // Step 1: substitute x
        const leftSub = left.replace(/x/g, `(${xStr})`);
        const rightSub = right.replace(/x/g, `(${xStr})`);
        this.steps.push({
            finalHtml: `<span class="term verify">${leftSub}</span><span class="equals"> = </span><span class="term verify">${rightSub}</span>`,
            isVerify: true
        });

        // Step 2: both sides equal
        const lv = this._eval(left, xVal);
        const rv = this._eval(right, xVal);
        const lvStr = Number.isInteger(lv) ? String(lv) : parseFloat(lv.toFixed(4)).toString();
        const rvStr = Number.isInteger(rv) ? String(rv) : parseFloat(rv.toFixed(4)).toString();
        this.steps.push({
            finalHtml: `<span class="term verify-ok">${lvStr}</span><span class="equals"> = </span><span class="term verify-ok">${rvStr}</span> <span class="checkmark">✓</span>`,
            isVerify: true,
            isFinal: true
        });
    }

    _eval(expr, x) {
        // Convert implicit multiplication to explicit: "3x" → "3*x", "2(" → "2*("
        const jsExpr = expr.replace(/(\d)x/g, '$1*x').replace(/(\d)\(/g, '$1*(');
        try { return Function(`"use strict";const x=${x};return(${jsExpr});`)(); }
        catch (e) { console.error('[eval error]', jsExpr, e); return NaN; }
    }
}
