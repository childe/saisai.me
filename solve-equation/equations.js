class EquationGenerator {
    constructor() {
        this.lastDifficulty = 'medium';
    }

    generate(difficulty = 'medium') {
        this.lastDifficulty = difficulty;

        let equation;
        if (difficulty === 'easy') {
            equation = this.generateEasy();
        } else if (difficulty === 'medium') {
            equation = this.generateMedium();
        } else if (difficulty === 'hard') {
            equation = this.generateHard();
        }

        return equation;
    }

    generateEasy() {
        // Easy: 2x + 3 = 7  or  3(x + 1) = 9
        const rand = Math.random();

        if (rand < 0.5) {
            // Simple linear: ax + b = c
            const a = this.randomInt(1, 5);
            const b = this.randomInt(1, 10);
            const c = this.randomInt(5, 30);
            const x = (c - b) / a;

            return {
                original: `${a}x + ${b} = ${c}`,
                solution: x,
                difficulty: 'easy',
                terms: this.parseEasy(a, b, c)
            };
        } else {
            // Distributive: a(x + b) = c
            const a = this.randomInt(2, 5);
            const b = this.randomInt(1, 8);
            const c = a * (this.randomInt(1, 10) + b);
            const x = (c / a) - b;

            return {
                original: `${a}(x + ${b}) = ${c}`,
                solution: x,
                difficulty: 'easy',
                terms: { left: { constant: b, coeff: a }, right: { constant: 0, coeff: 0 }, constant: c }
            };
        }
    }

    generateMedium() {
        // Medium: 2*(3+2x)=6-3x
        const a = this.randomInt(2, 4);
        const b = this.randomInt(1, 5);
        const c = this.randomInt(1, 5);
        const d = this.randomInt(1, 10);
        const e = this.randomInt(1, 5);
        const f = this.randomInt(1, 30);

        const x = (f - a * b) / (a * c + e);

        return {
            original: `${a}*(${b}+${c}x)=${f}-${e}x`,
            solution: x,
            difficulty: 'medium'
        };
    }

    generateHard() {
        // Hard: (3+x)/2=(2x-1)/3
        // General form: (a+x)/b=(cx-d)/e
        const a = this.randomInt(2, 6);
        const b = this.randomInt(2, 4);
        const c = this.randomInt(2, 4);
        const d = this.randomInt(1, 3);
        const e = this.randomInt(2, 4);

        const x = (a * e + d * b) / (c * b - e);

        return {
            original: `(${a}+x)/${b}=(${c}x-${d})/${e}`,
            solution: x,
            difficulty: 'hard'
        };
    }

    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    parseEasy(a, b, c) {
        return {
            left: { x: a, constant: b },
            right: { constant: c }
        };
    }
}
