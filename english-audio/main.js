class App {
    constructor() {
        this.ui = new UI();
        this.player = new Player(document.getElementById('audio'));
        this.manifest = null;
        this.unit = null;
        this.track = null;

        this.playbar = document.getElementById('playbar');
        this.btnPlay = document.getElementById('btn-play');
        this.nowTitle = document.getElementById('now-title');
        this.seek = document.getElementById('seek');
        this.timeEl = document.getElementById('time');
        this.seeking = false;
    }

    async start() {
        const res = await fetch('data/g1a.json');
        this.manifest = await res.json();
        this.unit = this.manifest.units[0];

        this.ui.onUnitClick((id) => this.selectUnit(id));
        this.ui.onTrackClick((no) => this.playTrack(no, true));

        this.btnPlay.addEventListener('click', () => this.player.toggle());
        this.seek.addEventListener('input', () => { this.seeking = true; });
        this.seek.addEventListener('change', () => {
            this.seeking = false;
            const d = this.player.duration;
            if (isFinite(d)) this.player.seekTo((this.seek.value / 1000) * d);
        });

        this.player.onTime((t, d) => this.renderTime(t, d));
        this.player.onState((playing) => {
            this.btnPlay.textContent = playing ? '⏸' : '▶';
            this.btnPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
        });
        this.player.onEnded(() => this.playNext());

        this.ui.renderUnits(this.manifest.units, this.unit.id);
        this.ui.renderTracks(this.unit, null);
    }

    selectUnit(id) {
        this.unit = this.manifest.units.find((u) => u.id === id);
        this.ui.renderUnits(this.manifest.units, id);
        const activeNo = this.track && this.unitOf(this.track).id === id ? this.track.no : null;
        this.ui.renderTracks(this.unit, activeNo);
    }

    unitOf(track) {
        return this.manifest.units.find((u) => u.tracks.indexOf(track) !== -1);
    }

    playTrack(no, autoplay) {
        const track = this.unit.tracks.find((t) => t.no === no);
        if (!track) return;
        this.track = track;
        this.playbar.hidden = false;
        this.nowTitle.textContent = this.unit.title + ' · ' + track.title;
        this.ui.renderTracks(this.unit, no);
        this.player.load(this.manifest.baseUrl + track.key, { autoplay: autoplay });
    }

    playNext() {
        if (!this.track) return;
        const unit = this.unitOf(this.track);
        const i = unit.tracks.indexOf(this.track);
        if (i < 0 || i + 1 >= unit.tracks.length) return;
        if (unit.id !== this.unit.id) this.selectUnit(unit.id);
        this.playTrack(unit.tracks[i + 1].no, true);
    }

    renderTime(t, d) {
        if (!this.seeking && isFinite(d) && d > 0) {
            this.seek.value = Math.round((t / d) * 1000);
        }
        this.timeEl.textContent = UI.formatTime(t) + ' / ' + UI.formatTime(d);
    }
}

document.addEventListener('DOMContentLoaded', () => new App().start());
