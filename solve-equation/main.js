let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new App();
});

class App {
    constructor() {
        this.generator = new EquationGenerator();
        this.solver = new Solver();
        this.renderer = new Renderer('equationsDisplay');

        this.currentEquation = null;
        this.steps = [];
        this.currentStep = 0;
        this.difficulty = 'medium';
        this.showingSolution = false;

        this.setupEventListeners();
        this.startNewEquation();
    }

    setupEventListeners() {
        // Click on equations display
        document.getElementById('equationsDisplay').addEventListener('click', () => {
            this.showNextStep();
        });

        // Spacebar
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !this.showingSolution) {
                e.preventDefault();
                this.showNextStep();
            }
        });

        // Difficulty buttons
        document.querySelectorAll('.diff-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newDifficulty = e.target.dataset.difficulty;
                if (newDifficulty === 'easier') {
                    const levels = ['easy', 'medium', 'hard'];
                    const idx = levels.indexOf(this.difficulty);
                    this.difficulty = idx > 0 ? levels[idx - 1] : 'easy';
                } else if (newDifficulty === 'harder') {
                    const levels = ['easy', 'medium', 'hard'];
                    const idx = levels.indexOf(this.difficulty);
                    this.difficulty = idx < 2 ? levels[idx + 1] : 'hard';
                }
                // 'same' keeps current difficulty
                this.startNewEquation();
            });
        });
    }

    startNewEquation() {
        this.currentEquation = this.generator.generate(this.difficulty);
        this.steps = this.solver.solve(this.currentEquation);
        this.currentStep = 0;
        this.showingSolution = false;

        this.renderer.clearDisplay();

        // Show initial equation
        this.renderer.addEquationLine(this.currentEquation.original);

        // Hide verification info and difficulty selector, show step button
        document.getElementById('verificationInfo').style.display = 'none';
        document.getElementById('difficultySelector').style.display = 'none';
        document.getElementById('stepBtn').style.display = 'block';
    }

    async showNextStep() {
        if (this.currentStep < this.steps.length) {
            const step = this.steps[this.currentStep];

            // Animate the new equation
            await this.renderer.animateEquation(
                this.currentStep === 0 ? this.currentEquation.original : this.steps[this.currentStep - 1].full,
                step.full,
                step.animationMeta
            );

            this.currentStep++;

            if (this.currentStep >= this.steps.length) {
                this.showSolutionPrompt();
            }
        }
    }

    showSolutionPrompt() {
        this.showingSolution = true;
        document.getElementById('stepBtn').style.display = 'none';
        document.getElementById('verificationInfo').style.display = 'block';
        document.getElementById('difficultySelector').style.display = 'flex';
    }
}
