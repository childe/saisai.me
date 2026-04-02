class Renderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.equations = [];
    }

    addEquationLine(equation, animationMeta) {
        // Will implement in Tasks 10-11
    }

    clearDisplay() {
        this.container.innerHTML = '';
        this.equations = [];
    }
}
