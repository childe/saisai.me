// Each step has an `html` string with optional `.term-new` spans for fade-in animation
class Solver {
    solve(equationObj) {
        this.steps = [];
        let { leftX, leftC, rightX, rightC } = equationObj.state;

        // Show expanded form if parentheses (hard difficulty)
        if (equationObj.hasParens) {
            this._push(leftX, leftC, rightX, rightC);
        }

        // Move x to left: add (-rightX)x to both sides
        if (rightX !== 0) {
            const dx = -rightX;
            this._push(leftX, leftC, rightX, rightC, dx, 0, dx, 0);
            leftX += dx;
            rightX = 0;
            this._push(leftX, leftC, rightX, rightC);
        }

        // Move constant to right: add (-leftC) to both sides
        if (leftC !== 0) {
            const dc = -leftC;
            this._push(leftX, leftC, rightX, rightC, 0, dc, 0, dc);
            leftC = 0;
            rightC += dc;
            this._push(leftX, leftC, rightX, rightC);
        }

        // Divide by x coefficient
        if (leftX !== 1) {
            rightC = rightC / leftX;
            leftX = 1;
            this._push(leftX, leftC, rightX, rightC);
        }

        // Verification
        this._verify(equationObj.original, rightC);

        return this.steps;
    }

    // Push a step: current state (leftX, leftC, rightX, rightC) plus optional new terms
    // newLX/newLC = new term added to left side (x coeff / constant)
    // newRX/newRC = new term added to right side
    _push(lx, lc, rx, rc, newLX = 0, newLC = 0, newRX = 0, newRC = 0) {
        const leftHtml = this._sideHtml(lx, lc, newLX, newLC);
        const rightHtml = this._sideHtml(rx, rc, newRX, newRC);
        this.steps.push({
            html: `${leftHtml}<span class="equals"> = </span>${rightHtml}`
        });
    }

    _sideHtml(x, c, newX, newC) {
        const parts = [];
        let first = true;

        if (x !== 0) {
            parts.push(this._span(this._xStr(x, first), 'normal'));
            first = false;
        }
        if (c !== 0) {
            parts.push(this._span(this._cStr(c, first), 'normal'));
            first = false;
        }
        if (newX !== 0) {
            parts.push(this._span(this._xStr(newX, first), 'new'));
            first = false;
        }
        if (newC !== 0) {
            parts.push(this._span(this._cStr(newC, first), 'new'));
        }

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

        // Step 1: substitute x
        const leftSub = left.replace(/x/g, `(${xStr})`);
        const rightSub = right.replace(/x/g, `(${xStr})`);
        this.steps.push({
            html: `<span class="term verify">${leftSub}</span><span class="equals"> = </span><span class="term verify">${rightSub}</span>`,
            isVerify: true
        });

        // Step 2: both sides equal
        const lv = this._eval(left, xVal);
        const rv = this._eval(right, xVal);
        const lvStr = Number.isInteger(lv) ? String(lv) : lv.toFixed(2);
        const rvStr = Number.isInteger(rv) ? String(rv) : rv.toFixed(2);
        this.steps.push({
            html: `<span class="term verify-ok">${lvStr}</span><span class="equals"> = </span><span class="term verify-ok">${rvStr}</span> <span class="checkmark">✓</span>`,
            isVerify: true,
            isFinal: true
        });
    }

    _eval(expr, x) {
        try { return Function(`"use strict";const x=${x};return(${expr});`)(); }
        catch (e) { return NaN; }
    }
}
