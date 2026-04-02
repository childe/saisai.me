class App {
    constructor() {
        this.generator = new EquationGenerator();
        this.solver = new Solver();
        this.renderer = new Renderer('equationsDisplay');

        this.steps = [];
        this.currentStep = 0;
        this.difficulty = 'medium';
        this.busy = false;  // Prevents double-triggering during animation

        this._bindEvents();
        this._newEquation();
    }

    _bindEvents() {
        // Click on the equations area
        document.getElementById('equationsDisplay').addEventListener('click', () => this._advance());

        // Spacebar
        document.addEventListener('keydown', e => {
            if (e.code === 'Space') { e.preventDefault(); this._advance(); }
        });

        // Difficulty buttons
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                const levels = ['easy', 'medium', 'hard'];
                const action = e.target.dataset.difficulty;
                const idx = levels.indexOf(this.difficulty);
                if (action === 'easier') this.difficulty = levels[Math.max(0, idx - 1)];
                else if (action === 'harder') this.difficulty = levels[Math.min(2, idx + 1)];
                this._newEquation();
            });
        });
    }

    _newEquation() {
        const eq = this.generator.generate(this.difficulty);
        this.steps = this.solver.solve(eq);
        this.currentStep = 0;
        this.busy = false;

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

    async _advance() {
        if (this.busy) return;
        if (this.currentStep >= this.steps.length) return;

        this.busy = true;
        const step = this.steps[this.currentStep];
        await this.renderer.addStep(step);
        this.currentStep++;

        if (this.currentStep >= this.steps.length) {
            this._showComplete();
        }

        this.busy = false;
    }

    _showComplete() {
        document.getElementById('stepBtn').style.display = 'none';
        document.getElementById('verificationInfo').style.display = 'block';
        document.getElementById('difficultySelector').style.display = 'flex';
    }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new App(); });
