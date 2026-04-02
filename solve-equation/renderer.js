class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.equations = [];
        this.animationInProgress = false;
    }

    clearDisplay() {
        this.container.innerHTML = '';
        this.equations = [];
    }

    addEquationLine(equation, animationMeta = {}) {
        const line = document.createElement('div');
        line.className = 'equation-line';
        line.innerHTML = this.formatEquation(equation);

        this.container.appendChild(line);
        this.equations.push({
            element: line,
            equation: equation,
            meta: animationMeta
        });

        // Auto-scroll to bottom
        this.container.scrollTop = this.container.scrollHeight;

        return line;
    }

    formatEquation(equation) {
        // Tokenize character by character to avoid HTML contamination
        const parts = [];
        let i = 0;

        while (i < equation.length) {
            if (equation[i] === 'x') {
                parts.push('<span class="variable">x</span>');
                i++;
            } else if (/\d/.test(equation[i])) {
                let num = '';
                while (i < equation.length && /\d/.test(equation[i])) {
                    num += equation[i++];
                }
                if (i < equation.length && equation[i] === 'x') {
                    parts.push('<span class="coefficient">' + num + '</span><span class="variable">x</span>');
                    i++;
                } else {
                    parts.push('<span class="number">' + num + '</span>');
                }
            } else if (equation[i] === '=') {
                parts.push(' <span class="equals">=</span> ');
                i++;
            } else {
                parts.push(equation[i++]);
            }
        }

        return parts.join('');
    }

    getCurrentDisplay() {
        return this.equations.map(e => e.equation).join('\n');
    }

    async animateEquation(oldEquation, newEquation, animationMeta = {}) {
        return new Promise((resolve) => {
            // Create element with opacity:0 BEFORE adding to DOM
            const line = document.createElement('div');
            line.className = 'equation-line';
            line.innerHTML = this.formatEquation(newEquation);
            line.style.opacity = '0';

            this.container.appendChild(line);
            this.equations.push({ element: line, equation: newEquation, meta: animationMeta });
            this.container.scrollTop = this.container.scrollHeight;

            // requestAnimationFrame ensures browser processes opacity:0 before transitioning
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    line.style.transition = 'opacity 0.7s ease-in';
                    line.style.opacity = '1';
                });
            });

            setTimeout(() => resolve(), 800);
        });
    }

    extractTerms(equation) {
        const [left, right] = equation.split('=');
        return {
            left: left.trim().split(/(?=[+-])/).filter(t => t.trim()),
            right: right.trim().split(/(?=[+-])/).filter(t => t.trim())
        };
    }

    waitForClick() {
        return new Promise((resolve) => {
            const clickHandler = () => {
                document.removeEventListener('click', clickHandler);
                document.removeEventListener('keydown', keyHandler);
                resolve();
            };

            const keyHandler = (e) => {
                if (e.code === 'Space') {
                    e.preventDefault();
                    document.removeEventListener('click', clickHandler);
                    document.removeEventListener('keydown', keyHandler);
                    resolve();
                }
            };

            document.addEventListener('click', clickHandler);
            document.addEventListener('keydown', keyHandler);
        });
    }
}
