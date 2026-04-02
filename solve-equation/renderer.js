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
        // Format equation with highlighted terms
        let formatted = equation;

        // Replace numbers followed by 'x' with styled coefficients
        formatted = formatted.replace(/(\d+)x/g, '<span class="coefficient">$1</span><span class="variable">x</span>');

        // Replace standalone 'x' (not preceded by a digit)
        formatted = formatted.replace(/([^0-9])x/g, '$1<span class="variable">x</span>');
        // Also handle 'x' at the beginning
        if (formatted.match(/^x/)) {
            formatted = formatted.replace(/^x/, '<span class="variable">x</span>');
        }

        // Replace equals sign
        formatted = formatted.replace(/=/g, ' <span class="equals">=</span> ');

        return formatted;
    }

    getCurrentDisplay() {
        return this.equations.map(e => e.equation).join('\n');
    }

    async animateEquation(oldEquation, newEquation, animationMeta = {}) {
        return new Promise((resolve) => {
            const line = this.addEquationLine(newEquation, animationMeta);

            // Detect which terms are new vs old
            const oldTerms = this.extractTerms(oldEquation);
            const newTerms = this.extractTerms(newEquation);

            // Simple animation: fade in the line
            line.style.opacity = '0';
            line.style.transition = 'opacity 0.5s ease-in';

            setTimeout(() => {
                line.style.opacity = '1';
            }, 10);

            // Resolve after animation completes
            setTimeout(() => {
                resolve();
            }, 600);
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
