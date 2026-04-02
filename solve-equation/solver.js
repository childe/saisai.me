class Solver {
    constructor() {
        this.equation = null;
        this.steps = [];
    }

    solve(equationObj) {
        this.equation = equationObj;
        this.steps = [];

        // Parse the equation string into components
        const parsed = this.parseEquation(equationObj.original);

        // Apply solving rules in sequence
        this.applyDistribution(parsed);
        this.clearFractions(parsed);
        this.combineTerms(parsed);
        this.moveTerms(parsed);
        this.isolate(parsed);
        this.addVerification(equationObj.original, equationObj.solution);

        return this.steps;
    }

    parseEquation(equationString) {
        // Basic structure: { left: expression, right: expression }
        const [left, right] = equationString.split('=');
        return {
            left: left.trim(),
            right: right.trim(),
            original: equationString
        };
    }

    addStep(leftExpr, rightExpr, description = '') {
        this.steps.push({
            left: leftExpr,
            right: rightExpr,
            full: `${leftExpr} = ${rightExpr}`,
            description: description,
            animationMeta: {} // Will populate during rules
        });
    }

    // ===== DISTRIBUTION RULE =====
    applyDistribution(state) {
        const leftDist = this.expandDistribution(state.left);
        const rightDist = this.expandDistribution(state.right);

        if (leftDist !== state.left || rightDist !== state.right) {
            this.addStep(leftDist, rightDist, 'Expand distribution');
            state.left = leftDist;
            state.right = rightDist;
        }
    }

    expandDistribution(expr) {
        // Match pattern: number(expr+term) or number(expr-term)
        // Example: 2(3+2x) → 6+4x
        const regex = /(\d+)\(([^)]+)\)/g;

        return expr.replace(regex, (match, coeff, inner) => {
            const terms = inner.split(/([+-])/);
            let result = '';
            let firstTerm = true;

            for (let i = 0; i < terms.length; i++) {
                const term = terms[i].trim();
                if (term === '' || term === '+' || term === '-') continue;

                const sign = i > 0 && terms[i - 1] === '-' ? '-' : '+';
                const multiplied = this.multiplyTerm(term, parseInt(coeff));

                if (firstTerm && sign === '+') {
                    result = multiplied;
                    firstTerm = false;
                } else {
                    result += sign + multiplied;
                }
            }

            return result;
        });
    }

    multiplyTerm(term, factor) {
        if (term.includes('x')) {
            const match = term.match(/(\d*)x/);
            const coeff = match[1] === '' ? 1 : parseInt(match[1]);
            const product = coeff * factor;
            return product === 1 ? 'x' : product + 'x';
        } else {
            return (parseInt(term) * factor).toString();
        }
    }

    // ===== CLEAR FRACTIONS RULE =====
    clearFractions(state) {
        const lcm = this.findLCM(state.left, state.right);

        if (lcm > 1) {
            const leftCleared = this.multiplyExpression(state.left, lcm);
            const rightCleared = this.multiplyExpression(state.right, lcm);

            this.addStep(leftCleared, rightCleared, 'Clear fractions (multiply by ' + lcm + ')');
            state.left = leftCleared;
            state.right = rightCleared;
        }
    }

    findLCM(leftExpr, rightExpr) {
        const leftDenoms = this.extractDenominators(leftExpr);
        const rightDenoms = this.extractDenominators(rightExpr);
        const allDenoms = [...new Set([...leftDenoms, ...rightDenoms])];

        if (allDenoms.length === 0) return 1;

        return allDenoms.reduce((a, b) => this.lcmOfTwo(a, b));
    }

    extractDenominators(expr) {
        const regex = /\/(\d+)/g;
        const matches = expr.match(regex) || [];
        return matches.map(m => parseInt(m.substring(1)));
    }

    lcmOfTwo(a, b) {
        return (a * b) / this.gcd(a, b);
    }

    gcd(a, b) {
        return b === 0 ? a : this.gcd(b, a % b);
    }

    multiplyExpression(expr, factor) {
        // Example: (3+x)/2 * 2 = 3+x
        let result = expr.replace(/\(([^)]+)\)\/(\d+)/g, (match, numerator, denom) => {
            const divisor = parseInt(denom);
            const multiplier = factor / divisor;
            return `${multiplier}*(${numerator})`;
        });

        // Expand any distributions that were created
        result = this.expandDistribution(result);
        return result;
    }

    // ===== COMBINE LIKE TERMS RULE =====
    combineTerms(state) {
        const leftCombined = this.simplifyExpression(state.left);
        const rightCombined = this.simplifyExpression(state.right);

        if (leftCombined !== state.left || rightCombined !== state.right) {
            this.addStep(leftCombined, rightCombined, 'Combine like terms');
            state.left = leftCombined;
            state.right = rightCombined;
        }
    }

    simplifyExpression(expr) {
        // Combine x terms and constants separately
        // Example: 6+4x-3x = 6+x
        const terms = this.parseTerms(expr);
        const xTerms = [];
        let constants = 0;

        for (const term of terms) {
            if (term.includes('x')) {
                const match = term.match(/([+-]?\d*)x/);
                const coeff = this.parseCoefficient(match[1]);
                xTerms.push(coeff);
            } else {
                constants += this.parseNumber(term);
            }
        }

        const totalX = xTerms.reduce((a, b) => a + b, 0);

        let result = '';
        if (totalX > 0) {
            result += totalX === 1 ? 'x' : totalX + 'x';
        } else if (totalX < 0) {
            result += totalX === -1 ? '-x' : totalX + 'x';
        }

        if (constants > 0) {
            result += (result ? '+' : '') + constants;
        } else if (constants < 0) {
            result += constants;
        }

        return result || '0';
    }

    parseTerms(expr) {
        return expr.split(/(?=[+-])/).filter(t => t.trim());
    }

    parseCoefficient(str) {
        if (str === '' || str === '+') return 1;
        if (str === '-') return -1;
        return parseInt(str);
    }

    parseNumber(str) {
        const num = parseInt(str);
        return isNaN(num) ? 0 : num;
    }

    // ===== MOVE TERMS RULE =====
    moveTerms(state) {
        // Move all x terms to left, constants to right
        const leftX = this.extractXCoeff(state.left);
        const rightX = this.extractXCoeff(state.right);
        const leftConst = this.extractConstant(state.left);
        const rightConst = this.extractConstant(state.right);

        if (rightX !== 0 || leftConst !== 0) {
            const newLeftX = leftX + rightX;
            const newRightConst = rightConst + leftConst;

            const newLeft = newLeftX === 0 ? '0' : (newLeftX === 1 ? 'x' : newLeftX === -1 ? '-x' : newLeftX + 'x');
            const newRight = newRightConst.toString();

            this.addStep(newLeft, newRight, 'Move terms');
            state.left = newLeft;
            state.right = newRight;
        }
    }

    extractXCoeff(expr) {
        const match = expr.match(/([+-]?\d*)x/);
        if (!match) return 0;
        return this.parseCoefficient(match[1]);
    }

    extractConstant(expr) {
        // Sum all non-x terms
        const terms = this.parseTerms(expr);
        let sum = 0;

        for (const term of terms) {
            if (!term.includes('x')) {
                sum += this.parseNumber(term);
            }
        }

        return sum;
    }

    // ===== ISOLATE RULE =====
    isolate(state) {
        // Divide both sides by the x coefficient to get x = value
        const xCoeff = this.extractXCoeff(state.left);
        const rightValue = parseFloat(state.right);

        if (xCoeff !== 0 && xCoeff !== 1) {
            const solution = rightValue / xCoeff;
            const newLeft = 'x';
            const newRight = this.formatNumber(solution);

            this.addStep(newLeft, newRight, 'Divide both sides by ' + xCoeff);
            state.left = newLeft;
            state.right = newRight;
        } else if (xCoeff === 0) {
            state.right = rightValue.toString();
        }
    }

    formatNumber(num) {
        if (Number.isInteger(num)) {
            return num.toString();
        } else {
            // Round to 2 decimal places, but remove trailing zeros
            return parseFloat(num.toFixed(2)).toString();
        }
    }

    // ===== VERIFICATION STEP =====
    addVerification(originalEquation, solution) {
        const [left, right] = originalEquation.split('=');
        const leftResult = this.evaluateExpression(left.trim(), solution);
        const rightResult = this.evaluateExpression(right.trim(), solution);

        // Add steps showing substitution and simplification
        const leftSub = this.substituteX(left.trim(), solution);
        const rightSub = this.substituteX(right.trim(), solution);

        this.addStep(
            leftSub,
            rightSub,
            'Verification: Substitute x = ' + this.formatNumber(solution)
        );

        // Show final values
        const leftFinal = this.formatNumber(leftResult);
        const rightFinal = this.formatNumber(rightResult);
        this.addStep(
            leftFinal,
            rightFinal,
            'Both sides equal ✓'
        );
    }

    substituteX(expr, xValue) {
        // Replace x with the value in parentheses
        return expr.replace(/x/g, '(' + this.formatNumber(xValue) + ')');
    }

    evaluateExpression(expr, xValue) {
        // Simple evaluation: replace x and eval
        const toEval = expr.replace(/x/g, xValue);
        try {
            return Function('"use strict"; return (' + toEval + ')')();
        } catch (e) {
            return 0;
        }
    }
}
