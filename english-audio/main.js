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

        this.btnPrev = document.getElementById('btn-prev');
        this.btnNext = document.getElementById('btn-next');
        this.btnBack = document.getElementById('btn-back');
        this.btnFwd = document.getElementById('btn-fwd');
        this.btnLoop = document.getElementById('btn-loop');
        this.rateBtns = Array.from(document.querySelectorAll('.rate'));
        this.rate = 1;
        this.loop = false;
        // 恢复上次状态完成前不许写 localStorage，否则会把上次的曲目覆盖成空
        this.ready = false;
        this.statusClick = null;
    }

    async start() {
        try {
            const res = await fetch('data/g1a.json');
            if (!res.ok) throw new Error(res.status);
            this.manifest = await res.json();
        } catch (e) {
            this.showStatus('😟 没有加载到内容，点我重试', () => location.reload());
            return;
        }
        this.unit = this.manifest.units[0];

        this.ui.onUnitClick((id) => this.selectUnit(id));
        this.ui.onTrackClick((no) => this.playTrack(no, true));

        this.btnPlay.addEventListener('click', () => {
            this.player.toggle().catch((e) => this.handlePlayRejection(e));
        });
        this.btnPrev.addEventListener('click', () => this.playPrev());
        this.btnNext.addEventListener('click', () => this.playNext());
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
        this.player.onError(() => {
            this.showStatus('😟 没连上网络，点我重试', () => {
                this.ui.setStatus('');
                if (this.track) this.playTrack(this.track.no, true);
            });
        });

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

        this.watchPlaybarHeight();

        this.ready = true;
        setInterval(() => this.savePrefs(), 3000);
        window.addEventListener('pagehide', () => this.savePrefs());
    }

    // 播放条高度随屏宽变化（窄屏时工具行会换行），实测后写回 --bar-h，
    // 否则最后一张卡片会被压在播放条底下点不到。
    watchPlaybarHeight() {
        const apply = () => {
            const h = this.playbar.hidden
                ? 0
                : this.playbar.getBoundingClientRect().height;
            document.documentElement.style.setProperty('--bar-h', Math.ceil(h) + 'px');
        };
        if (typeof ResizeObserver === 'function') {
            new ResizeObserver(apply).observe(this.playbar);
        }
        window.addEventListener('resize', apply);
        apply();
    }

    showStatus(text, onClick) {
        this.ui.setStatus(text);
        const el = document.getElementById('status');
        // 每次只挂一个一次性处理器，避免反复报错时叠加出多份点击逻辑
        if (this.statusClick) el.removeEventListener('click', this.statusClick);
        this.statusClick = () => {
            el.removeEventListener('click', this.statusClick);
            this.statusClick = null;
            onClick();
        };
        el.addEventListener('click', this.statusClick);
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
        // 单元必须取「正在播的那一条所属的单元」。取 this.unit（小朋友正在
        // 翻看的单元）会存成 {unit07, no:18} 这种解不开的组合，下次打开
        // 找不到曲目，续播直接失效。
        const playingUnit = this.track ? this.unitOf(this.track) : this.unit;
        const p = {
            unitId: playingUnit ? playingUnit.id : null,
            no: this.track ? this.track.no : null,
            time: this.player.resumeTime,
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
        this.ui.setStatus('');
        this.track = track;
        this.playbar.hidden = false;
        this.nowTitle.textContent = this.unit.title + ' · ' + track.title;
        this.ui.renderTracks(this.unit, no);
        this.player.load(this.manifest.baseUrl + track.key, {
            autoplay: autoplay,
            startAt: startAt || 0
        }).catch((err) => this.handlePlayRejection(err));
        this.player.setRate(this.rate);
        this.updateMediaSession();
        this.renderTime(0, NaN);
    }

    // play() 被浏览器拒绝时不会触发 audio 的 error 事件：不处理的话
    // 小朋友点了卡片，图标不变、没声音、也没有任何提示。
    handlePlayRejection(err) {
        // 连点两张卡片时上一条的 play() 会被 abort，这是正常的，不要吓唬人
        if (err && err.name === 'AbortError') return;
        this.showStatus('👆 点我开始播放', () => {
            this.ui.setStatus('');
            this.player.play().catch((e) => this.handlePlayRejection(e));
        });
    }

    playPrev() {
        if (!this.track) return;
        const unit = this.unitOf(this.track);
        const i = unit.tracks.indexOf(this.track);
        if (i <= 0) return;
        if (unit.id !== this.unit.id) this.selectUnit(unit.id);
        this.playTrack(unit.tracks[i - 1].no, true);
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
        // play / pause 必须各做各的：都用 toggle 的话，系统在中断（来电、
        // 通知）后补发一个 play，反而会把正在响的音频暂停掉。
        navigator.mediaSession.setActionHandler('play', () => {
            this.player.play().catch((e) => this.handlePlayRejection(e));
        });
        navigator.mediaSession.setActionHandler('pause', () => this.player.pause());
        navigator.mediaSession.setActionHandler('nexttrack', () => this.playNext());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.playPrev());
        navigator.mediaSession.setActionHandler('seekbackward', () => this.player.nudge(-5));
        navigator.mediaSession.setActionHandler('seekforward', () => this.player.nudge(5));
    }

    renderTime(t, d) {
        // 元数据还没到时，用 manifest 里的时长先顶上，别让播放条干巴巴
        // 显示 0:00 / 0:00
        const total = isFinite(d) && d > 0 ? d : (this.track && this.track.duration) || 0;
        const at = t || this.player.pendingSeek || 0;
        if (!this.seeking && total > 0) {
            this.seek.value = Math.round((at / total) * 1000);
        }
        this.timeEl.textContent = UI.formatTime(at) + ' / ' + UI.formatTime(total);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // 挂到 window 上，便于在浏览器里直接检查与验证状态
    window.app = new App();
    window.app.start();
});
