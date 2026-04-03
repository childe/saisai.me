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
            this._animateTwoPhase(line, step);
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
    //   2. Left cancel terms blink → new line shows simplified left side
    //   3. New line shows equals sign
    //   4. Right cancel terms blink → new line shows simplified right side
    _animateTwoPhase(line, step) {
        line.innerHTML = step.intermediateHtml;
        const newTerms = line.querySelectorAll('.term-new');
        newTerms.forEach(el => { el.style.opacity = '0'; });
        line.style.opacity = '0';

        // Prepare result line (hidden, built up incrementally)
        const resultLine = document.createElement('div');
        resultLine.className = 'equation-line';
        resultLine.style.opacity = '0';

        requestAnimationFrame(() => requestAnimationFrame(() => {
            // Step 1: line fades in
            line.style.transition = 'opacity 0.3s ease-out';
            line.style.opacity = '1';

            // Step 2: new terms fade in
            setTimeout(() => {
                newTerms.forEach(el => {
                    el.style.transition = 'opacity 0.5s ease-in';
                    el.style.opacity = '1';
                });

                setTimeout(() => {
                    // Split cancel terms into left/right by equals position
                    const equalsEl = line.querySelector('.equals');
                    const cancelTerms = line.querySelectorAll('.term-cancel');
                    const leftCancel = [], rightCancel = [];
                    cancelTerms.forEach(el => {
                        if (equalsEl && (equalsEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) {
                            rightCancel.push(el);
                        } else {
                            leftCancel.push(el);
                        }
                    });

                    // Insert result line (empty for now)
                    line.parentNode.insertBefore(resultLine, line.nextSibling);

                    // Step 3: blink left cancel terms
                    this._blinkTerms(leftCancel, () => {
                        // Show simplified left side
                        resultLine.innerHTML = step.finalLeftHtml;
                        resultLine.style.opacity = '1';
                        this.container.scrollTop = this.container.scrollHeight;

                        // Step 4: show equals sign
                        setTimeout(() => {
                            resultLine.innerHTML = step.finalLeftHtml + '<span class="equals"> = </span>';

                            // Step 5: blink right cancel terms
                            setTimeout(() => {
                                this._blinkTerms(rightCancel, () => {
                                    // Show simplified right side
                                    resultLine.innerHTML = step.finalHtml;
                                    this.container.scrollTop = this.container.scrollHeight;
                                });
                            }, 200);
                        }, 300);
                    });
                }, 600); // wait for new terms to finish fading in
            }, 150);
        }));
    }

    _blinkTerms(elements, onComplete) {
        if (elements.length === 0) {
            onComplete();
            return;
        }
        elements.forEach(el => {
            el.style.animation = 'blinkHighlight 0.8s ease-in-out';
        });
        setTimeout(onComplete, 850);
    }
}

