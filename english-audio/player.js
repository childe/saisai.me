class Player {
    constructor(audioEl) {
        this.audio = audioEl;
        this.timeHandler = null;
        this.endedHandler = null;
        this.stateHandler = null;

        // 待定的起播位置。用一个常驻处理器消费它，而不是每次 load 挂一个
        // once 监听器 —— 那种写法在 metadata 永不到达时（preload="none"
        // 或加载失败）会残留下来，等下一条曲目的 metadata 一到就把它拖到
        // 上一条的位置。
        this.pendingSeek = 0;

        this.audio.addEventListener('timeupdate', () => this.emitTime());
        this.audio.addEventListener('loadedmetadata', () => {
            if (this.pendingSeek) {
                this.audio.currentTime = this.pendingSeek;
                this.pendingSeek = 0;
            }
            this.emitTime();
        });
        this.audio.addEventListener('play', () => this.emitState());
        this.audio.addEventListener('pause', () => this.emitState());
        this.audio.addEventListener('ended', () => {
            if (this.endedHandler) this.endedHandler();
        });

        this.errorHandler = null;
        this.stallTimer = null;
        this.audio.addEventListener('error', () => this.reportError());
        // stalled/waiting 在普通缓冲时也会触发，立刻报错会误伤；
        // 卡住超过 STALL_GRACE_MS 且仍然没有可播数据，才当作失败。
        this.audio.addEventListener('stalled', () => this.armStallTimer());
        this.audio.addEventListener('waiting', () => this.armStallTimer());
        ['playing', 'canplay', 'loadeddata'].forEach((n) => {
            this.audio.addEventListener(n, () => this.clearStallTimer());
        });
    }

    armStallTimer() {
        if (this.stallTimer) return;
        this.stallTimer = setTimeout(() => {
            this.stallTimer = null;
            if (this.audio.readyState < 2) this.reportError();
        }, Player.STALL_GRACE_MS);
    }

    clearStallTimer() {
        if (this.stallTimer) {
            clearTimeout(this.stallTimer);
            this.stallTimer = null;
        }
    }

    reportError() {
        this.clearStallTimer();
        if (this.errorHandler) this.errorHandler();
    }

    onError(fn) { this.errorHandler = fn; }

    get playing() { return !this.audio.paused; }
    get currentTime() { return this.audio.currentTime; }
    get duration() { return this.audio.duration; }

    onTime(fn) { this.timeHandler = fn; }
    onEnded(fn) { this.endedHandler = fn; }
    onState(fn) { this.stateHandler = fn; }

    emitTime() {
        if (this.timeHandler) this.timeHandler(this.audio.currentTime, this.audio.duration);
    }

    emitState() {
        if (this.stateHandler) this.stateHandler(this.playing);
    }

    load(url, options) {
        const opts = options || {};
        this.clearStallTimer();
        this.pendingSeek = opts.startAt || 0;
        this.audio.src = url;
        this.audio.load();
        if (opts.autoplay) return this.play();
        return Promise.resolve();
    }

    // 恢复进度时元数据还没到，此时 currentTime 仍是 0，
    // 真正的续播位置在 pendingSeek 里。
    get resumeTime() {
        return this.pendingSeek || this.audio.currentTime;
    }

    play() {
        const p = this.audio.play();
        return p && p.catch ? p : Promise.resolve();
    }

    pause() {
        this.audio.pause();
        return Promise.resolve();
    }

    toggle() {
        return this.playing ? this.pause() : this.play();
    }

    seekTo(seconds) {
        if (isFinite(seconds)) this.audio.currentTime = seconds;
    }

    nudge(delta) {
        this.seekTo(Math.max(0, Math.min(this.audio.duration || 0, this.audio.currentTime + delta)));
    }

    setRate(rate) {
        this.audio.playbackRate = rate;
        this.audio.preservesPitch = true;
        this.audio.mozPreservesPitch = true;
        this.audio.webkitPreservesPitch = true;
    }

    setLoop(on) { this.audio.loop = on; }
}

Player.STALL_GRACE_MS = 8000;
