class App {
    constructor() {
        this.ui = new UI();
        this.manifest = null;
        this.unit = null;
    }

    async start() {
        const res = await fetch('data/g1a.json');
        this.manifest = await res.json();
        this.unit = this.manifest.units[0];

        this.ui.onUnitClick((id) => this.selectUnit(id));
        this.ui.onTrackClick((no) => console.log('track', no));

        this.ui.renderUnits(this.manifest.units, this.unit.id);
        this.ui.renderTracks(this.unit, null);
    }

    selectUnit(id) {
        this.unit = this.manifest.units.find((u) => u.id === id);
        this.ui.renderUnits(this.manifest.units, id);
        this.ui.renderTracks(this.unit, null);
    }
}

document.addEventListener('DOMContentLoaded', () => new App().start());
