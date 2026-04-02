class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
    }

    clearDisplay() {
        this.container.innerHTML = '';
    }

    // Add a step line. Returns a promise that resolves when animation finishes.
    async addStep(step) {
        const line = document.createElement('div');
        line.className = 'equation-line';
        line.innerHTML = step.html;

        if (step.isVerify) line.classList.add('verify-line');
        if (step.isFinal) line.classList.add('final-line');

        // Make all .term-new elements invisible before inserting
        const newTerms = line.querySelectorAll('.term-new');
        newTerms.forEach(el => { el.style.opacity = '0'; });

        // Whole line starts invisible
        line.style.opacity = '0';

        this.container.appendChild(line);
        this.container.scrollTop = this.container.scrollHeight;

        // Two rAF calls so browser paints the opacity:0 state before transitioning
        await raf();
        await raf();

        // Fade the line in quickly
        line.style.transition = 'opacity 0.3s ease-out';
        line.style.opacity = '1';
        await wait(350);

        // Then fade in the new terms (highlights)
        if (newTerms.length > 0) {
            newTerms.forEach(el => {
                el.style.transition = 'opacity 0.6s ease-in';
                el.style.opacity = '1';
            });
            await wait(700);
        }
    }
}

function raf() { return new Promise(r => requestAnimationFrame(r)); }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
