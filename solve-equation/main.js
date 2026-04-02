class App {
    constructor() {
        this.generator = new EquationGenerator();
        this.solver = new Solver();
        this.renderer = new Renderer('equationsDisplay');

        this.steps = [];
        this.currentStep = 0;
        this.difficulty = 'medium';

        this._bindEvents();
        this._newEquation();
    }

    _bindEvents() {
        // Step button (was missing!)
        document.getElementById('stepBtn').addEventListener('click', () => {
            console.log('[stepBtn] clicked');
            this._advance();
        });

        // Click on the equations area
        document.getElementById('equationsDisplay').addEventListener('click', () => {
            console.log('[equationsDisplay] clicked');
            this._advance();
        });

        // Spacebar
        document.addEventListener('keydown', e => {
            if (e.code === 'Space') {
                e.preventDefault();
                console.log('[keydown] Space');
                this._advance();
            }
        });

        // Difficulty buttons
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation(); // prevent bubbling to equationsDisplay
                const levels = ['easy', 'medium', 'hard'];
                const action = e.target.dataset.difficulty;
                const idx = levels.indexOf(this.difficulty);
                if (action === 'easier') this.difficulty = levels[Math.max(0, idx - 1)];
                else if (action === 'harder') this.difficulty = levels[Math.min(2, idx + 1)];
                console.log('[difficulty] changed to', this.difficulty);
                this._newEquation();
            });
        });
    }

    _newEquation() {
        const eq = this.generator.generate(this.difficulty);
        console.log('[newEquation]', eq.original, '| solution:', eq.solution, '| steps:', this.solver.solve(eq).length);
        this.steps = this.solver.solve(eq);
        this.currentStep = 0;
        this.renderer.clearDisplay();

        // Show original equation immediately (no animation for first line)
        const firstLine = document.createElement('div');
        firstLine.className = 'equation-line first-line';
        firstLine.innerHTML = this._makeOriginalHtml(eq.original);
        document.getElementById('equationsDisplay').appendChild(firstLine);

        // Reset UI
        document.getElementById('verificationInfo').style.display = 'none';
        document.getElementById('difficultySelector').style.display = 'none';
        document.getElementById('stepBtn').style.display = 'block';
    }

    _makeOriginalHtml(original) {
        // Simple tokenizer: number, x, operator, equals
        const parts = [];
        let i = 0;
        while (i < original.length) {
            if (original[i] === 'x') {
                parts.push(`<span class="term"><span class="variable">x</span></span>`);
                i++;
            } else if (/\d/.test(original[i])) {
                let num = '';
                while (i < original.length && /\d/.test(original[i])) num += original[i++];
                if (i < original.length && original[i] === 'x') {
                    parts.push(`<span class="term"><span class="coefficient">${num}</span><span class="variable">x</span></span>`);
                    i++;
                } else {
                    parts.push(`<span class="term">${num}</span>`);
                }
            } else if (original[i] === '=') {
                parts.push(`<span class="equals"> = </span>`);
                i++;
            } else {
                parts.push(original[i++]);
            }
        }
        return parts.join('');
    }

    _advance() {
        console.log('[advance] step', this.currentStep, '/', this.steps.length);
        if (this.currentStep >= this.steps.length) {
            console.log('[advance] already at end');
            return;
        }

        const step = this.steps[this.currentStep];
        const preview = (step.intermediateHtml || step.finalHtml || '').replace(/<[^>]+>/g, '');
        console.log('[advance] step', this.currentStep, ':', preview);
        this.renderer.addStep(step);
        this.currentStep++;

        if (this.currentStep >= this.steps.length) {
            this._showComplete();
        }
    }

    _showComplete() {
        document.getElementById('stepBtn').style.display = 'none';
        document.getElementById('verificationInfo').style.display = 'block';
        document.getElementById('difficultySelector').style.display = 'flex';
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
