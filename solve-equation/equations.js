class EquationGenerator {
    constructor() {
        this.lastDifficulty = 'medium';
    }

    generate(difficulty = 'medium') {
        this.lastDifficulty = difficulty;
        if (difficulty === 'easy') return this._easy();
        if (difficulty === 'hard') return this._hard();
        return this._medium();
    }

    // ax + b = c  (only left has x, integer solution)
    _easy() {
        const a = this._r(2, 5);
        const b = this._r(1, 9);
        const xVal = this._r(1, 8);
        const c = a * xVal + b;
        return {
            original: this._fmt(a, b, 0, c),
            state: { leftX: a, leftC: b, rightX: 0, rightC: c },
            solution: xVal,
            difficulty: 'easy'
        };
    }

    // ax + b = cx + d  (both sides have x, integer solution)
    _medium() {
        let a, c, b, d, xVal;
        let tries = 0;
        do {
            a = this._r(2, 5);
            c = this._r(1, 3);
            b = this._r(1, 9);
            xVal = this._r(1, 6);
            d = (a - c) * xVal + b;
            tries++;
        } while ((a === c || d <= 0 || d > 30) && tries < 100);

        return {
            original: this._fmt(a, b, c, d),
            state: { leftX: a, leftC: b, rightX: c, rightC: d },
            solution: xVal,
            difficulty: 'medium'
        };
    }

    // a(bx + c) = dx + e  (parentheses, integer solution)
    _hard() {
        let a, b, c, d, e, xVal;
        let tries = 0;
        do {
            a = this._r(2, 3);
            b = this._r(2, 4);
            c = this._r(1, 5);
            d = this._r(1, 3);
            xVal = this._r(1, 5);
            e = (a * b - d) * xVal + a * c;
            tries++;
        } while ((a * b === d || e <= 0 || e > 40) && tries < 100);

        return {
            original: `${a}(${b}x+${c})=${d}x+${e}`,
            state: { leftX: a * b, leftC: a * c, rightX: d, rightC: e },
            hasParens: { a, b, c },
            solution: xVal,
            difficulty: 'hard'
        };
    }

    // Format: leftX*x + leftC = rightX*x + rightC as a readable string
    _fmt(lx, lc, rx, rc) {
        const left = this._xStr(lx, true) + this._cStr(lc, lx === 0);
        const right = rx === 0
            ? this._cStr(rc, true)
            : this._xStr(rx, true) + this._cStr(rc, false);
        return `${left}=${right}`;
    }

    _xStr(coeff, isFirst) {
        if (coeff === 0) return '';
        if (coeff === 1) return isFirst ? 'x' : '+x';
        if (coeff === -1) return '-x';
        return (coeff > 0 && !isFirst ? '+' : '') + coeff + 'x';
    }

    _cStr(n, isFirst) {
        if (n === 0) return '';
        return (n > 0 && !isFirst ? '+' : '') + n;
    }

    _r(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
}
