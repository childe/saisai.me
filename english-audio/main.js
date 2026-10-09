const PREFS_KEY = 'english-audio:g1a';

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

        this.btnBack = document.getElementById('btn-back');
        this.btnFwd = document.getElementById('btn-fwd');
        this.btnLoop = document.getElementById('btn-loop');
        this.rateBtns = Array.from(document.querySelectorAll('.rate'));
        this.rate = 1;
        this.loop = false;
        // 恢复上次状态完成前不许写 localStorage，否则会把上次的曲目覆盖成空
        this.ready = false;
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

        this.btnBack.addEventListener('click', () => this.player.nudge(-5));
        this.btnFwd.addEventListener('click', () => this.player.nudge(5));
        this.btnLoop.addEventListener('click', () => this.setLoop(!this.loop));
        this.rateBtns.forEach((b) => {
            b.addEventListener('click', () => this.setRate(Number(b.dataset.rate)));
        });

        this.player.onTime((t, d) => this.renderTime(t, d));
        this.player.onState((playing) => {
            this.btnPlay.textContent = playing ? '⏸' : '▶';
            this.btnPlay.setAttribute('aria-label', playing ? '暂停' : '播放');
        });
        this.player.onEnded(() => this.playNext());

        const prefs = this.loadPrefs();
        this.setRate(prefs.rate || 1);
        this.setLoop(Boolean(prefs.loop));

        const saved = prefs.unitId && this.manifest.units.find((u) => u.id === prefs.unitId);
        if (saved) this.unit = saved;

        this.ui.renderUnits(this.manifest.units, this.unit.id);
        this.ui.renderTracks(this.unit, null);

        if (saved && prefs.no) {
            this.playTrack(prefs.no, false, prefs.time || 0);
        }

        this.ready = true;
        setInterval(() => this.savePrefs(), 3000);
        window.addEventListener('pagehide', () => this.savePrefs());
    }

    loadPrefs() {
        try {
            return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    savePrefs() {
        if (!this.ready) return;
        const p = {
            unitId: this.unit ? this.unit.id : null,
            no: this.track ? this.track.no : null,
            time: this.player.currentTime,
            rate: this.rate,
            loop: this.loop
        };
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(p));
        } catch (e) {
            // 隐私模式下 localStorage 写入会抛异常，忽略即可
        }
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

    playTrack(no, autoplay, startAt) {
        const track = this.unit.tracks.find((t) => t.no === no);
        if (!track) return;
        this.track = track;
        this.playbar.hidden = false;
        this.nowTitle.textContent = this.unit.title + ' · ' + track.title;
        this.ui.renderTracks(this.unit, no);
        this.player.load(this.manifest.baseUrl + track.key, {
            autoplay: autoplay,
            startAt: startAt || 0
        });
        this.player.setRate(this.rate);
        this.updateMediaSession();
    }

    playNext() {
        if (!this.track) return;
        const unit = this.unitOf(this.track);
        const i = unit.tracks.indexOf(this.track);
        if (i < 0 || i + 1 >= unit.tracks.length) return;
        if (unit.id !== this.unit.id) this.selectUnit(unit.id);
        this.playTrack(unit.tracks[i + 1].no, true);
    }

    setRate(rate) {
        this.rate = rate;
        this.player.setRate(rate);
        this.rateBtns.forEach((b) => {
            b.classList.toggle('is-on', Number(b.dataset.rate) === rate);
        });
        this.savePrefs();
    }

    setLoop(on) {
        this.loop = on;
        this.player.setLoop(on);
        this.btnLoop.classList.toggle('is-on', on);
        this.savePrefs();
    }

    updateMediaSession() {
        if (!('mediaSession' in navigator) || !this.track) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: this.track.title,
            artist: this.unit.title,
            album: this.manifest.title
        });
        navigator.mediaSession.setActionHandler('play', () => this.player.toggle());
        navigator.mediaSession.setActionHandler('pause', () => this.player.toggle());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
        navigator.mediaSession.setActionHandler('seekbackward', () => this.player.nudge(-5));
        navigator.mediaSession.setActionHandler('seekforward', () => this.player.nudge(5));
    }

    renderTime(t, d) {
        if (!this.seeking && isFinite(d) && d > 0) {
            this.seek.value = Math.round((t / d) * 1000);
        }
        this.timeEl.textContent = UI.formatTime(t) + ' / ' + UI.formatTime(d);
    }
}

document.addEventListener('DOMContentLoaded', () => new App().start());
