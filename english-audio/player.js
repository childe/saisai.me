class Player {
    constructor(audioEl) {
        this.audio = audioEl;
        this.timeHandler = null;
        this.endedHandler = null;
        this.stateHandler = null;

        this.audio.addEventListener('timeupdate', () => this.emitTime());
        this.audio.addEventListener('loadedmetadata', () => this.emitTime());
        this.audio.addEventListener('play', () => this.emitState());
        this.audio.addEventListener('pause', () => this.emitState());
        this.audio.addEventListener('ended', () => {
            if (this.endedHandler) this.endedHandler();
        });
    }

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
        this.audio.src = url;
        this.audio.load();
        if (opts.startAt) {
            this.audio.addEventListener('loadedmetadata', () => {
                this.audio.currentTime = opts.startAt;
            }, { once: true });
        }
        if (opts.autoplay) return this.audio.play();
        return Promise.resolve();
    }

    toggle() {
        if (this.playing) {
            this.audio.pause();
            return Promise.resolve();
        }
        return this.audio.play();
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
