// Все звуки синтезируются через WebAudio: не нужны файлы и лицензии.
export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
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
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  spatial(x, z) {
    if (x === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listener.x;
    const dz = z - this.listener.z;
    const dist = Math.hypot(dx, dz);
    const ang = Math.atan2(-dx, -dz) - this.listener.yaw;
    return { gain: 1 / (1 + dist * 0.07), pan: Math.max(-1, Math.min(1, -Math.sin(ang))) * Math.min(1, dist / 3) };
  }

  out(gain, pan) {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
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
    const d = this.out(0.35, 0);
    const t = this.ctx.currentTime;
    this.tone(d, t, { f0: head ? 1800 : 1200, f1: head ? 2400 : 1000, dur: 0.07, type: 'triangle', gain: 0.6 });
  }

  kill() {
    if (!this.ctx) return;
    const d = this.out(0.35, 0);
    const t = this.ctx.currentTime;
    this.tone(d, t, { f0: 880, dur: 0.12, type: 'triangle' });
    this.tone(d, t + 0.1, { f0: 1320, dur: 0.2, type: 'triangle' });
  }

  hurt() {
    if (!this.ctx) return;
    const d = this.out(0.6, 0);
    const t = this.ctx.currentTime;
    this.tone(d, t, { f0: 160, f1: 60, dur: 0.18, gain: 0.8 });
    this.burst(d, t, { dur: 0.1, freq: 400, gain: 0.5 });
  }

  pickup() {
    if (!this.ctx) return;
    const d = this.out(0.3, 0);
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
