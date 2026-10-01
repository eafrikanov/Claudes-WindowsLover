// Все звуки синтезируются через WebAudio: не нужны файлы и лицензии.
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.fxVolume = 1;
    this.uiVolume = 1;
    this.listener = { x: 0, z: 0, yaw: 0 };
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      this.fx = this.ctx.createGain();
      this.fx.gain.value = this.fxVolume;
      this.fx.connect(this.master);
      this.ui = this.ctx.createGain();
      this.ui.gain.value = this.uiVolume;
      this.ui.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // fx — звуки мира, ui — сигналы попаданий, убийств, аптечек и урона.
  setVolume(v, fx = this.fxVolume, ui = this.uiVolume) {
    this.volume = v;
    this.fxVolume = fx;
    this.uiVolume = ui;
    if (!this.master) return;
    this.master.gain.value = v;
    this.fx.gain.value = fx;
    this.ui.gain.value = ui;
  }

  spatial(x, z) {
    if (x === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(-dx, -dz) - this.listener.yaw;
    return { gain: 1 / (1 + dist * 0.07), pan: Math.max(-1, Math.min(1, -Math.sin(ang))) * Math.min(1, dist / 3) };
  }

  out(gain, pan, bus = this.fx) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(bus);
    } else {
      g.connect(bus);
    }
    return g;
  }

  burst(dest, t, { dur, freq, q = 0.7, gain = 1, type = 'lowpass' }) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone(dest, t, { f0, f1 = f0, dur, gain = 0.5, type = 'sine' }) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(def, x, z) {
    if (!this.ctx) return;
    const s = def.sound;
    const sp = this.spatial(x, z);
    const dest = this.out(s.gain * sp.gain, sp.pan);
    const t = this.ctx.currentTime;
    this.burst(dest, t, { dur: s.decay, freq: s.freq * (1 - (1 - sp.gain) * 0.6), gain: 1 });
    this.burst(dest, t, { dur: 0.03, freq: 4000, type: 'highpass', gain: 0.5 * sp.gain });
    this.tone(dest, t, { f0: s.body * 2, f1: s.body * 0.5, dur: s.decay * 0.8, gain: 0.8 });
    this.burst(dest, t + 0.02, { dur: s.decay * 2.5, freq: 600, gain: 0.15 });
  }

  boom(x, z) {
    if (!this.ctx) return;
    const sp = this.spatial(x, z);
    const near = Math.max(sp.gain, 0.25);
    const dest = this.out(1.1 * near, sp.pan * 0.6);
    const t = this.ctx.currentTime;
    this.tone(dest, t, { f0: 120, f1: 28, dur: 0.9, gain: 1 });
    this.tone(dest, t, { f0: 60, f1: 22, dur: 1.4, gain: 0.8, type: 'triangle' });
    this.burst(dest, t, { dur: 1.2, freq: 900 * near + 200, gain: 1 });
    this.burst(dest, t, { dur: 0.25, freq: 3500, type: 'highpass', gain: 0.5 });
    for (let i = 0; i < 6; i++) this.burst(dest, t + 0.08 + Math.random() * 0.5, { dur: 0.06, freq: 1500 + Math.random() * 2000, type: 'bandpass', q: 2, gain: 0.35 });
  }

  launch(x, z) {
    if (!this.ctx) return;
    const sp = this.spatial(x, z);
    const dest = this.out(0.8 * sp.gain, sp.pan);
    const t = this.ctx.currentTime;
    this.tone(dest, t, { f0: 90, f1: 40, dur: 0.3, gain: 0.9 });
    this.burst(dest, t, { dur: 0.6, freq: 1800, type: 'bandpass', q: 0.8, gain: 1 });
    this.burst(dest, t + 0.05, { dur: 0.9, freq: 500, gain: 0.5 });
  }

  zap(x, z) {
    if (!this.ctx) return;
    const sp = this.spatial(x, z);
    const dest = this.out(0.25 * sp.gain, sp.pan);
    const t = this.ctx.currentTime;
    this.tone(dest, t, { f0: 2200, f1: 300, dur: 0.14, type: 'sawtooth', gain: 0.5 });
    this.tone(dest, t, { f0: 1100, f1: 160, dur: 0.12, type: 'square', gain: 0.25 });
  }

  swish(x, z) {
    if (!this.ctx) return;
    const sp = this.spatial(x, z);
    this.burst(this.out(0.5 * sp.gain, sp.pan), this.ctx.currentTime, { dur: 0.16, freq: 2500, type: 'bandpass', q: 1.5 });
  }

  throwSound(x, z) {
    if (!this.ctx) return;
    const sp = this.spatial(x, z);
    const dest = this.out(0.35 * sp.gain, sp.pan);
    this.click(0.03, 3500, 0.3);
    this.burst(dest, this.ctx.currentTime + 0.05, { dur: 0.2, freq: 1200, type: 'bandpass', q: 1 });
  }

  click(dur = 0.02, freq = 3000, gain = 0.3, delay = 0) {
    if (!this.ctx) return;
    this.burst(this.out(gain, 0), this.ctx.currentTime + delay, { dur, freq, type: 'bandpass', q: 3 });
  }

  reload(duration, pump) {
    if (!this.ctx) return;
    if (pump) {
      const n = 4;
      for (let i = 0; i < n; i++) this.click(0.05, 1800, 0.35, duration * (0.25 + (i / n) * 0.55));
      this.click(0.08, 900, 0.5, duration * 0.85);
      this.click(0.06, 1400, 0.5, duration * 0.93);
    } else {
      this.click(0.04, 1500, 0.4, duration * 0.2);
      this.click(0.06, 900, 0.3, duration * 0.35);
      this.click(0.05, 2000, 0.45, duration * 0.62);
      this.click(0.07, 1100, 0.55, duration * 0.85);
    }
  }

  pump(delay) {
    this.click(0.07, 1000, 0.45, delay);
    this.click(0.06, 1500, 0.45, delay + 0.15);
  }

  empty() {
    this.click(0.03, 2500, 0.4);
  }

  hit(head) {
    if (!this.ctx) return;
    const d = this.out(0.35, 0, this.ui);
    const t = this.ctx.currentTime;
    this.tone(d, t, { f0: head ? 1800 : 1200, f1: head ? 2400 : 1000, dur: 0.07, type: 'triangle', gain: 0.6 });
  }

  kill() {
    if (!this.ctx) return;
    const d = this.out(0.35, 0, this.ui);
    const t = this.ctx.currentTime;
    this.tone(d, t, { f0: 880, dur: 0.12, type: 'triangle' });
    this.tone(d, t + 0.1, { f0: 1320, dur: 0.2, type: 'triangle' });
  }

  hurt() {
    if (!this.ctx) return;
    const d = this.out(0.6, 0, this.ui);
    const t = this.ctx.currentTime;
    this.tone(d, t, { f0: 160, f1: 60, dur: 0.18, gain: 0.8 });
    this.burst(d, t, { dur: 0.1, freq: 400, gain: 0.5 });
  }

  pickup() {
    if (!this.ctx) return;
    const d = this.out(0.3, 0, this.ui);
    const t = this.ctx.currentTime;
    [660, 880, 1100].forEach((f, i) => this.tone(d, t + i * 0.07, { f0: f, dur: 0.15, type: 'triangle' }));
  }

  step(gain = 0.12) {
    if (!this.ctx) return;
    this.burst(this.out(gain, (Math.random() - 0.5) * 0.3), this.ctx.currentTime, { dur: 0.08, freq: 500 + Math.random() * 300 });
  }

  impact(x, z) {
    if (!this.ctx) return;
    const sp = this.spatial(x, z);
    if (sp.gain < 0.1) return;
    this.burst(this.out(0.2 * sp.gain, sp.pan), this.ctx.currentTime, { dur: 0.05, freq: 2500, type: 'bandpass', q: 2 });
  }
}
