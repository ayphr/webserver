/**
 * Warm, quiet procedural lofi background engine.
 *
 * Everything is synthesised locally with the Web Audio API — no network requests,
 * no media files, and no extra CSP permissions. The engine is owned by a provider
 * that lives above the router, so it keeps playing while the dashboard changes tabs.
 */

export const RADIO_STYLES = ['gentle', 'jazzy', 'rainy'] as const;
export type RadioStyle = (typeof RADIO_STYLES)[number];

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

type Chord = { root: number; notes: number[] };

type StylePreset = {
  bpm: number;
  swing: number;
  progressions: Chord[][];
  melodyPool: number[];
  melodyChance: number;
  melodyToneHz: number;
  brushVelocity: number;
  brushHz: number;
  percussionLevel: number;
  kickSteps: number[];
  brushSteps: number[];
  ghostBrushSteps: number[];
  bassAccentSteps: number[];
  chordStabSteps: number[];
  chordAttack: number;
  chordToneHz: number;
  tapeDrift: number;
  filterHz: number;
  reverbWet: number;
  delayFeedback: number;
  delayToneHz: number;
  ambienceLevel: number;
  ambienceFilterHz: number;
};

// Curated warm Neo-Soul / lofi progressions in a low-mid register.
const GENTLE_PROGRESSIONS: Chord[][] = [
  [
    { root: 41, notes: [53, 57, 60, 64, 67] }, // Fmaj9
    { root: 40, notes: [52, 55, 59, 62, 67] }, // Em7
    { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
    { root: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
  ],
  [
    { root: 45, notes: [52, 57, 60, 64, 67] }, // Am9
    { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
    { root: 43, notes: [50, 53, 59, 64, 69] }, // G13
    { root: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
  ],
  [
    { root: 39, notes: [51, 55, 58, 62, 65] }, // Ebmaj9
    { root: 36, notes: [48, 51, 55, 58, 65] }, // Cm11
    { root: 44, notes: [51, 56, 60, 63, 67] }, // Abmaj9
    { root: 46, notes: [50, 56, 60, 65, 67] }, // Bb13
  ],
];

const JAZZY_PROGRESSIONS: Chord[][] = [
  [
    { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
    { root: 43, notes: [50, 55, 59, 64, 69] }, // G13
    { root: 36, notes: [48, 52, 55, 59, 62] }, // Cmaj9
    { root: 45, notes: [52, 55, 61, 64, 68] }, // A7b9
  ],
  [
    { root: 41, notes: [53, 57, 60, 64, 67] }, // Fmaj9
    { root: 44, notes: [51, 56, 60, 63, 67] }, // Abmaj9
    { root: 38, notes: [50, 53, 57, 60, 64] }, // Dm9
    { root: 43, notes: [50, 55, 59, 64, 69] }, // G13
  ],
];

const RAINY_PROGRESSIONS: Chord[][] = [
  [
    { root: 45, notes: [57, 60, 64, 67] }, // Am7
    { root: 41, notes: [53, 57, 60, 64] }, // Fmaj7
    { root: 36, notes: [48, 52, 55, 59] }, // Cmaj7
    { root: 43, notes: [50, 55, 57, 62] }, // Gsus
  ],
  [
    { root: 44, notes: [56, 60, 63, 67] }, // Abmaj7
    { root: 39, notes: [51, 55, 58, 65] }, // Ebmaj7
    { root: 46, notes: [58, 62, 65, 69] }, // Bbmaj7
    { root: 43, notes: [50, 55, 59, 62] }, // G7sus
  ],
];

const STYLE_PRESETS: Record<RadioStyle, StylePreset> = {
  // Soft, spacious, and sparse: slow pads, a heartbeat kick, and a distant bed.
  gentle: {
    bpm: 64,
    swing: 0.2,
    progressions: GENTLE_PROGRESSIONS,
    melodyPool: [64, 67, 69, 72, 74, 76],
    melodyChance: 0.18,
    melodyToneHz: 1250,
    brushVelocity: 0.55,
    brushHz: 720,
    percussionLevel: 0.7,
    kickSteps: [0, 10],
    brushSteps: [4, 12],
    ghostBrushSteps: [2, 6, 8, 14],
    bassAccentSteps: [10],
    chordStabSteps: [],
    chordAttack: 0.6,
    chordToneHz: 820,
    tapeDrift: 0.0035,
    filterHz: 1700,
    reverbWet: 0.5,
    delayFeedback: 0.2,
    delayToneHz: 850,
    ambienceLevel: 0.1,
    ambienceFilterHz: 850,
  },
  // Bright and syncopated: brushed ride pattern, chord stabs, and blue notes.
  jazzy: {
    bpm: 88,
    swing: 0.36,
    progressions: JAZZY_PROGRESSIONS,
    melodyPool: [65, 67, 69, 71, 72, 74, 76, 77, 79, 81],
    melodyChance: 0.55,
    melodyToneHz: 2600,
    brushVelocity: 1.1,
    brushHz: 2400,
    percussionLevel: 1,
    kickSteps: [0, 8, 14],
    brushSteps: [2, 4, 6, 10, 12, 14],
    ghostBrushSteps: [0, 8],
    bassAccentSteps: [6, 10, 14],
    chordStabSteps: [6, 14],
    chordAttack: 0.02,
    chordToneHz: 1500,
    tapeDrift: 0.0015,
    filterHz: 3800,
    reverbWet: 0.24,
    delayFeedback: 0.34,
    delayToneHz: 1800,
    ambienceLevel: 0.05,
    ambienceFilterHz: 1500,
  },
  // Slow and washed out: no kick, wide rain texture, and low, rare melody notes.
  rainy: {
    bpm: 54,
    swing: 0.08,
    progressions: RAINY_PROGRESSIONS,
    melodyPool: [60, 62, 63, 67, 69],
    melodyChance: 0.1,
    melodyToneHz: 900,
    brushVelocity: 0.75,
    brushHz: 1100,
    percussionLevel: 0.65,
    kickSteps: [],
    brushSteps: [2, 6, 10, 14],
    ghostBrushSteps: [0, 4, 8, 12],
    bassAccentSteps: [10],
    chordStabSteps: [],
    chordAttack: 0.9,
    chordToneHz: 640,
    tapeDrift: 0.006,
    filterHz: 1200,
    reverbWet: 0.62,
    delayFeedback: 0.24,
    delayToneHz: 700,
    ambienceLevel: 0.38,
    ambienceFilterHz: 3000,
  },
};

const MASTER_PEAK = 0.24;
const MIN_GAIN = 0.0001;
const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 1.2;
const VOLUME_RAMP_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 40;
const SCHEDULER_LOOKAHEAD_SECONDS = 0.35;

export class GentleLofiEngine {
  ctx!: AudioContext;
  masterGain!: GainNode;
  masterFilter!: BiquadFilterNode;
  compressor!: DynamicsCompressorNode;
  reverb!: ConvolverNode;
  reverbWet!: GainNode;
  delayL!: DelayNode;
  delayR!: DelayNode;
  delayFeedback!: GainNode;
  delayTone!: BiquadFilterNode;
  instrumentBus!: GainNode;

  private isInitialized = false;
  private isPlaying = false;
  private volume: number;
  private style: RadioStyle;
  private step = 0;
  private nextNoteTime = 0;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private progressionIndex = 0;
  private barCounter = 0;
  private ambienceSource: AudioBufferSourceNode | null = null;
  private ambienceGain: GainNode | null = null;
  private ambienceFilter: BiquadFilterNode | null = null;

  constructor(volume: number, style: RadioStyle = 'gentle') {
    this.volume = clampVolume(volume);
    this.style = style;
  }

  private get preset(): StylePreset {
    return STYLE_PRESETS[this.style];
  }

  private targetGain(): number {
    return Math.max(MIN_GAIN, MASTER_PEAK * this.volume);
  }

  private init(): void {
    if (this.isInitialized) return;

    const AudioCtx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
    this.ctx = new AudioCtx();

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = MIN_GAIN;

    this.masterFilter = this.ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = this.preset.filterHz;
    this.masterFilter.Q.value = 0.5;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 24;
    this.compressor.ratio.value = 3;
    this.compressor.attack.value = 0.025;
    this.compressor.release.value = 0.35;

    this.reverb = this.ctx.createConvolver();
    this.reverb.buffer = this.createDarkReverbImpulse(3.4, 3.2);
    this.reverbWet = this.ctx.createGain();
    this.reverbWet.gain.value = this.preset.reverbWet;

    this.delayL = this.ctx.createDelay(1.5);
    this.delayR = this.ctx.createDelay(1.5);
    this.delayL.delayTime.value = 0.43;
    this.delayR.delayTime.value = 0.65;
    this.delayFeedback = this.ctx.createGain();
    this.delayFeedback.gain.value = this.preset.delayFeedback;
    this.delayTone = this.ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = this.preset.delayToneHz;

    const merger = this.ctx.createChannelMerger(2);
    this.delayL.connect(this.delayTone);
    this.delayTone.connect(this.delayR);
    this.delayR.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayL);
    this.delayL.connect(merger, 0, 0);
    this.delayR.connect(merger, 0, 1);
    merger.connect(this.reverb);
    merger.connect(this.masterFilter);

    this.instrumentBus = this.ctx.createGain();
    this.instrumentBus.gain.value = 0.85;
    this.instrumentBus.connect(this.masterFilter);
    this.instrumentBus.connect(this.reverb);
    this.reverb.connect(this.reverbWet);
    this.reverbWet.connect(this.masterFilter);

    this.masterFilter.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.startWhisperAmbience();
    this.isInitialized = true;
  }

  private createDarkReverbImpulse(duration: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * duration);
    const buffer = this.ctx.createBuffer(2, length, rate);

    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        last = 0.78 * last + 0.22 * white;
        data[i] = last * Math.pow(1 - i / length, decay);
      }
    }

    return buffer;
  }

  /** Very faint warm rain / vinyl texture bed. */
  private startWhisperAmbience(): void {
    const sr = this.ctx.sampleRate;
    const len = sr * 10;
    const buf = this.ctx.createBuffer(2, len, sr);

    for (let ch = 0; ch < 2; ch++) {
      const out = buf.getChannelData(ch);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;

      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.997 * b0 + white * 0.029;
        b1 = 0.985 * b1 + white * 0.032;
        b2 = 0.95 * b2 + white * 0.048;
        const sample = (b0 + b1 + b2) * 0.16;

        if (Math.random() < 0.00022) {
          const pop = (0.12 + Math.random() * 0.22) * (Math.random() > 0.5 ? 1 : -1);
          for (let p = 0; p < 14 && i + p < len; p++) {
            out[i + p] += pop * Math.exp(-p * 0.4);
          }
        }

        out[i] += sample;
      }
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.preset.ambienceFilterHz;

    const bedGain = this.ctx.createGain();
    bedGain.gain.value = this.preset.ambienceLevel;

    src.connect(lp);
    lp.connect(bedGain);
    bedGain.connect(this.masterFilter);
    src.start();
    this.ambienceSource = src;
    this.ambienceGain = bedGain;
    this.ambienceFilter = lp;
  }

  /** Style-dependent tape pitch drift. */
  private getTapeDrift(time: number): number {
    const wow = Math.sin(time * Math.PI * 2 * 0.42) * this.preset.tapeDrift;
    const flutter = Math.sin(time * Math.PI * 2 * 3.1) * this.preset.tapeDrift * 0.23;
    return 1 + wow + flutter;
  }

  /** Lush pad chord, or a short bright stab when the preset calls for one. */
  private playChord(
    notes: number[],
    time: number,
    duration: number,
    levelScale = 1,
    attack = this.preset.chordAttack,
  ): void {
    const drift = this.getTapeDrift(time);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;
    filter.frequency.setValueAtTime(this.preset.chordToneHz, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(320, this.preset.chordToneHz * 0.55),
      time + duration * 0.85,
    );

    const env = this.ctx.createGain();
    const level = (0.16 * levelScale) / Math.sqrt(notes.length);
    const attackEnd = time + Math.max(0.02, attack);
    const sustainAt = time + Math.max(attack + 0.05, duration * 0.55);
    const releaseAt = Math.max(sustainAt + 0.05, time + duration);
    const tail = attack > 0.1 ? 1.4 : 0.35;
    env.gain.setValueAtTime(MIN_GAIN, time);
    env.gain.linearRampToValueAtTime(level, attackEnd);
    env.gain.setValueAtTime(level * 0.85, sustainAt);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, releaseAt + tail);

    filter.connect(env);
    env.connect(this.instrumentBus);

    notes.forEach((midi, i) => {
      const t = time + i * 0.025;
      const freq = midiToFreq(midi) * drift;

      const osc1 = this.ctx.createOscillator();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, t);
      osc1.detune.value = -4;

      const osc2 = this.ctx.createOscillator();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freq, t);
      osc2.detune.value = 4;

      osc1.connect(filter);
      osc2.connect(filter);

      const end = releaseAt + tail + 0.1;
      osc1.start(t);
      osc2.start(t);
      osc1.stop(end);
      osc2.stop(end);
    });
  }

  /** Soft, round sine sub bass. */
  private playBass(midi: number, time: number, duration: number): void {
    const freq = midiToFreq(midi) * this.getTapeDrift(time);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 210;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(MIN_GAIN, time);
    env.gain.linearRampToValueAtTime(0.24, time + 0.14);
    env.gain.setValueAtTime(0.2, time + duration * 0.7);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, time + duration + 0.4);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this.instrumentBus);

    osc.start(time);
    osc.stop(time + duration + 0.5);
  }

  /** Sparse, delicate felt-piano / soft bell note. */
  private playFeltNote(midi: number, time: number, duration: number, velocity = 0.6): void {
    const freq = midiToFreq(midi) * this.getTapeDrift(time);

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);

    const overtone = this.ctx.createOscillator();
    overtone.type = 'triangle';
    overtone.frequency.setValueAtTime(freq * 2, time);

    const overGain = this.ctx.createGain();
    overGain.gain.setValueAtTime(0.06 * velocity, time);
    overGain.gain.exponentialRampToValueAtTime(MIN_GAIN, time + 0.35);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = this.preset.melodyToneHz;

    const env = this.ctx.createGain();
    const peak = 0.11 * velocity;
    env.gain.setValueAtTime(MIN_GAIN, time);
    env.gain.linearRampToValueAtTime(peak, time + 0.045);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, time + duration + 1.2);

    osc.connect(lp);
    overtone.connect(overGain);
    overGain.connect(lp);
    lp.connect(env);
    env.connect(this.instrumentBus);
    env.connect(this.delayL);

    const end = time + duration + 1.3;
    osc.start(time);
    overtone.start(time);
    osc.stop(end);
    overtone.stop(end);
  }

  /** Ultra-soft, muted heartbeat-like kick (zero click). */
  private playSoftKick(time: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(88, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);

    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(MIN_GAIN, time);
    env.gain.linearRampToValueAtTime(0.26 * this.preset.percussionLevel, time + 0.018);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, time + 0.36);

    osc.connect(lp);
    lp.connect(env);
    env.connect(this.instrumentBus);

    osc.start(time);
    osc.stop(time + 0.38);
  }

  /** Whisper-quiet brushed rim / shaker pulse. */
  private playSoftBrush(time: number, velocity = 0.5): void {
    const dur = 0.14;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);

    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buf;

    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = this.preset.brushHz;
    bp.Q.value = 1.2;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(MIN_GAIN, time);
    env.gain.linearRampToValueAtTime(0.065 * velocity * this.preset.percussionLevel, time + 0.015);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, time + dur);

    src.connect(bp);
    bp.connect(env);
    env.connect(this.instrumentBus);
    src.start(time);
  }

  private scheduleStep(stepIdx: number, baseTime: number): void {
    const preset = this.preset;
    const sixteenth = 60 / preset.bpm / 4;
    const swingOffset = stepIdx % 2 === 1 ? preset.swing * sixteenth : 0;
    const t = baseTime + swingOffset;

    const barInProg = Math.floor(stepIdx / 16) % 4;
    const stepInBar = stepIdx % 16;

    if (stepIdx === 0 && this.barCounter > 0 && this.barCounter % 8 === 0) {
      this.progressionIndex = (this.progressionIndex + 1) % preset.progressions.length;
    }
    if (stepInBar === 0) {
      this.barCounter++;
    }

    const chord = preset.progressions[this.progressionIndex % preset.progressions.length][barInProg];

    if (stepInBar === 0) {
      this.playChord(chord.notes, t, sixteenth * 15);
      this.playBass(chord.root, t, sixteenth * 11);
    }

    if (preset.kickSteps.includes(stepInBar)) {
      this.playSoftKick(t);
    }

    if (preset.bassAccentSteps.includes(stepInBar) && Math.random() > 0.35) {
      this.playBass(chord.root + 7, t, sixteenth * 5);
    }

    if (preset.chordStabSteps.includes(stepInBar)) {
      this.playChord(chord.notes, t, sixteenth * 2, 0.55);
    }

    if (preset.brushSteps.includes(stepInBar)) {
      this.playSoftBrush(t, preset.brushVelocity);
    } else if (preset.ghostBrushSteps.includes(stepInBar) && Math.random() > 0.45) {
      this.playSoftBrush(t, preset.brushVelocity * 0.3);
    }

    if (stepInBar % 2 === 0 && Math.random() < preset.melodyChance) {
      const note = preset.melodyPool[Math.floor(Math.random() * preset.melodyPool.length)];
      const dur = sixteenth * (4 + Math.floor(Math.random() * 5));
      this.playFeltNote(note, t, dur, 0.45 + Math.random() * 0.35);
    }
  }

  private scheduler(): void {
    const sixteenth = 60 / this.preset.bpm / 4;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULER_LOOKAHEAD_SECONDS) {
      this.scheduleStep(this.step, this.nextNoteTime);
      this.nextNoteTime += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  }

  private rampGain(target: number, seconds: number, now: number): void {
    const gain = this.masterGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, MIN_GAIN), now);
    gain.linearRampToValueAtTime(Math.max(target, MIN_GAIN), now + seconds);
  }

  /** Update the listener-facing volume. Safe to call at any time. */
  setVolume(value: number): void {
    this.volume = clampVolume(value);
    if (!this.isInitialized || !this.isPlaying) return;
    this.rampGain(this.targetGain(), VOLUME_RAMP_SECONDS, this.ctx.currentTime);
  }

  /** Switch the progression, tempo, and texture. Safe to call while playing. */
  setStyle(style: RadioStyle): void {
    this.style = style;
    if (!this.isInitialized) return;

    const now = this.ctx.currentTime;
    this.masterFilter.frequency.cancelScheduledValues(now);
    this.masterFilter.frequency.setTargetAtTime(this.preset.filterHz, now, 0.25);
    this.reverbWet.gain.cancelScheduledValues(now);
    this.reverbWet.gain.setTargetAtTime(this.preset.reverbWet, now, 0.25);
    this.delayFeedback.gain.cancelScheduledValues(now);
    this.delayFeedback.gain.setTargetAtTime(this.preset.delayFeedback, now, 0.25);
    this.delayTone.frequency.cancelScheduledValues(now);
    this.delayTone.frequency.setTargetAtTime(this.preset.delayToneHz, now, 0.25);

    if (this.ambienceGain) {
      this.ambienceGain.gain.cancelScheduledValues(now);
      this.ambienceGain.gain.setTargetAtTime(this.preset.ambienceLevel, now, 0.25);
    }
    if (this.ambienceFilter) {
      this.ambienceFilter.frequency.cancelScheduledValues(now);
      this.ambienceFilter.frequency.setTargetAtTime(this.preset.ambienceFilterHz, now, 0.25);
    }
  }

  async toggle(): Promise<boolean> {
    if (!this.isInitialized) {
      this.init();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const now = this.ctx.currentTime;

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.rampGain(this.targetGain(), FADE_IN_SECONDS, now);

      this.nextNoteTime = now + 0.08;
      this.scheduler();
      this.schedulerTimer = setInterval(() => this.scheduler(), SCHEDULER_INTERVAL_MS);
    } else {
      this.isPlaying = false;
      this.rampGain(MIN_GAIN, FADE_OUT_SECONDS, now);

      if (this.schedulerTimer) {
        clearInterval(this.schedulerTimer);
        this.schedulerTimer = null;
      }
    }

    return this.isPlaying;
  }

  dispose(): void {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.isPlaying = false;

    if (!this.isInitialized) return;

    try {
      this.ambienceSource?.stop();
    } catch {
      // The source may already have stopped.
    }
    void this.ctx.close().catch(() => undefined);
  }
}
