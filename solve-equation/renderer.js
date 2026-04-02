class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
    }

    clearDisplay() {
        this.container.innerHTML = '';
    }

    // Add a step line. Starts animation and returns immediately (non-blocking).
    addStep(step) {
        const line = document.createElement('div');
        line.className = 'equation-line';
        line.innerHTML = step.html;

        if (step.isVerify) line.classList.add('verify-line');
        if (step.isFinal) line.classList.add('final-line');

        // Make .term-new elements invisible before inserting
        const newTerms = line.querySelectorAll('.term-new');
        newTerms.forEach(el => { el.style.opacity = '0'; });

        // Whole line starts invisible
        line.style.opacity = '0';

        this.container.appendChild(line);
        this.container.scrollTop = this.container.scrollHeight;

        // Trigger line fade-in after two frames
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                line.style.transition = 'opacity 0.3s ease-out';
                line.style.opacity = '1';

                // Fade in new terms after line appears
                if (newTerms.length > 0) {
                    setTimeout(() => {
                        newTerms.forEach(el => {
                            el.style.transition = 'opacity 0.6s ease-in';
                            el.style.opacity = '1';
                        });
                    }, 200);
                }
            });
        });
    }
}

