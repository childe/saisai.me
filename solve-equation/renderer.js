class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
    }

    clearDisplay() {
        this.container.innerHTML = '';
    }

    // Add a step line. Non-blocking — animations run in the background.
    addStep(step) {
        const line = document.createElement('div');
        line.className = 'equation-line';

        if (step.isVerify) line.classList.add('verify-line');
        if (step.isFinal) line.classList.add('final-line');

        if (step.intermediateHtml) {
            this._animateTwoPhase(line, step.intermediateHtml, step.finalHtml);
        } else {
            this._animateFadeIn(line, step.finalHtml);
        }

        this.container.appendChild(line);
        this.container.scrollTop = this.container.scrollHeight;
    }

    // Simple: whole line fades in
    _animateFadeIn(line, html) {
        line.innerHTML = html;
        line.style.opacity = '0';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            line.style.transition = 'opacity 0.3s ease-out';
            line.style.opacity = '1';
        }));
    }

    // Two-phase:
    //   1. Line appears, then term-new items fade in
    //   2. After 800ms, line fades out → content swapped → fades back in
    _animateTwoPhase(line, intermediateHtml, finalHtml) {
        line.innerHTML = intermediateHtml;
        const newTerms = line.querySelectorAll('.term-new');
        newTerms.forEach(el => { el.style.opacity = '0'; });
        line.style.opacity = '0';

        requestAnimationFrame(() => requestAnimationFrame(() => {
            // Step 1: line fades in
            line.style.transition = 'opacity 0.3s ease-out';
            line.style.opacity = '1';

            // Step 2: new terms fade in (slightly delayed)
            setTimeout(() => {
                newTerms.forEach(el => {
                    el.style.transition = 'opacity 0.5s ease-in';
                    el.style.opacity = '1';
                });

                // Step 3: after new terms visible, fade line out, swap content, fade in
                setTimeout(() => {
                    line.style.transition = 'opacity 0.3s ease-in';
                    line.style.opacity = '0';
                    setTimeout(() => {
                        line.innerHTML = finalHtml;
                        requestAnimationFrame(() => requestAnimationFrame(() => {
                            line.style.transition = 'opacity 0.4s ease-out';
                            line.style.opacity = '1';
                        }));
                    }, 300);
                }, 600); // wait for new terms to finish fading in
            }, 150);
        }));
    }
}

