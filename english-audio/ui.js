const KIND_ICON = {
    starter: '🚀',
    task: '✅',
    words: '🔤',
    song: '🎵',
    rhyme: '📜',
    chant: '🥁',
    talking: '💬',
    story: '📖',
    wordbank: '📚'
};

class UI {
    constructor() {
        this.unitsEl = document.getElementById('units');
        this.tracksEl = document.getElementById('tracks');
        this.statusEl = document.getElementById('status');
        this.unitHandler = null;
        this.trackHandler = null;

        this.unitsEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.unit-btn');
            if (btn && this.unitHandler) this.unitHandler(btn.dataset.id);
        });
        this.tracksEl.addEventListener('click', (e) => {
            const btn = e.target.closest('.track');
            if (btn && this.trackHandler) this.trackHandler(Number(btn.dataset.no));
        });
    }

    static formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) return '0:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return m + ':' + String(s).padStart(2, '0');
    }

    onUnitClick(fn) { this.unitHandler = fn; }
    onTrackClick(fn) { this.trackHandler = fn; }

    renderUnits(units, activeId) {
        this.unitsEl.innerHTML = units.map((u) => {
            const on = u.id === activeId ? ' is-on' : '';
            const label = u.id === 'wordbank' ? '📚 单词表' : u.title;
            return `<button class="unit-btn${on}" data-id="${u.id}">${label}</button>`;
        }).join('');
    }

    renderTracks(unit, activeNo) {
        const rows = unit.tracks.map((t) => {
            const on = t.no === activeNo ? ' is-on' : '';
            const dur = t.duration ? UI.formatTime(t.duration) : '';
            return `<button class="track${on}" data-no="${t.no}">
                <span class="track-icon">${KIND_ICON[t.kind] || '🎧'}</span>
                <span class="track-text">
                    <span class="track-title">${t.title}</span>
                    <span class="track-sub">${t.subtitle}</span>
                </span>
                <span class="track-dur">${dur}</span>
            </button>`;
        }).join('');
        const sub = unit.subtitle ? ` <small>${unit.subtitle}</small>` : '';
        this.tracksEl.innerHTML = `<h2>${unit.title}${sub}</h2>` + rows;
    }

    setStatus(html) {
        if (!html) {
            this.statusEl.hidden = true;
            this.statusEl.innerHTML = '';
            return;
        }
        this.statusEl.hidden = false;
        this.statusEl.innerHTML = html;
    }
}
