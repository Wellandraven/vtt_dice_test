// The only sound this app makes.
//
// **A file of its own, like diceFx, and for the same reason.** Everything here needs an
// `AudioContext`, so none of it can be tested — which is the argument for keeping it small and
// keeping every decision somewhere else. What is left is three cues and the plumbing to reach them.
//
// **Two cues, and only one of them is a recording.** The clatter of dice landing is built out of a
// real sound recorded by real people (`demo/public/sfx/ATTRIBUTION.md`) and there is no synthesising
// it. The rattle is generated, because it has to follow the cup's own motion — a different length on
// every roll, stopping the instant a finger lifts.
//
// **The clatter is assembled here rather than played back.** It used to be one recording of a real
// person throwing N dice, fired when the first of ours landed. That can never be in time with
// anything: the recording has its own impacts at its own spacing, and — because every multi-dice
// take in the pack opens with the dice being shaken in a hand — it also played most of a second of
// shake *after* our dice had already hit. What plays now is one short recording of a single die
// hitting a table, once for each contact the baked throw actually has, at the moment it has it.
// In time by construction, because it is made of the same data as the picture.
//
// There was a third, a thud for the cup landing on the table. The tap it belonged to is gone.

/** Where the vendored one-shots live. See `tools/vendorDiceSfx.ts` for how they got there. */
const CLIP_URL = (kind: number) => `/sfx/dice/impact-d${kind}.wav`;

/**
 * The one-shots, in the order they are taken.
 *
 * Six recordings of the same event — one die hitting a table — one per die kind. **Taken in turn
 * rather than chosen by the kind that is rolling**, because at this volume a d8 landing is not
 * identifiable as a d8, and what six of them are actually for is keeping forty contacts in a row
 * from being the same eighty milliseconds forty times.
 *
 * `KINDS` in `tools/diceSfx.ts` writes these files and this list reads them. A renderer may not
 * import from `tools`, so the two are checked against each other in `tests/diceSfx.test.ts`.
 */
export const IMPACT_KINDS = [4, 6, 8, 10, 12, 20] as const;

/** How loud each cue is. The impacts are the event; the rattle sits under it. */
const ROLL_GAIN = 0.9;
const RATTLE_GAIN = 0.5;

/**
 * The impact speed that plays at full level, in tray units per second.
 *
 * A die let go at the cup's mouth reaches the felt at about this — `sqrt(2 * GRAVITY * 0.3)` with
 * the tray's gravity of 9. **An absolute reference rather than the loudest contact in the handful**,
 * which would be the same thing as normalising every throw to full scale and would make a nudge as
 * loud as a hard throw.
 */
const FULL_SPEED = 2.3;

/** Below this a contact is not scheduled at all: it is inaudible, and it still costs three nodes. */
const QUIET_SPEED = 0.05;

/** The rattle: a few short bursts of filtered noise, which is what a die against wood is. */
const RATTLE_BURSTS = 3;
const RATTLE_SECONDS = 0.045;
const RATTLE_LOW = 1600;
const RATTLE_HIGH = 3400;
const RATTLE_Q = 5;
/** How far apart the bursts of one rattle are thrown, at most. A cup does not hit all at once. */
const RATTLE_STAGGER = 0.03;

/**
 * The dice tray's sound.
 *
 * **Built on the first press and not before.** An `AudioContext` created at load starts suspended
 * under every browser's autoplay policy and has to be resumed from a gesture anyway; building it at
 * the gesture means there is no suspended-context state to carry around and no session that never
 * rolls paying for an audio graph. The recordings are fetched at the same moment — 0.7 MB, once.
 */
export class DiceAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private noise?: AudioBuffer;
  private readonly clips = new Map<number, AudioBuffer>();
  private loading?: Promise<void>;
  private failed = false;
  /** Off is off: nothing is fetched, nothing is built, and nothing is decoded. */
  private silent = false;

  /**
   * Wake up, from inside a gesture.
   *
   * Safe to call on every press. The context is built once; `resume` is not, because a browser may
   * suspend it again when the tab goes to the background and the next roll has to bring it back.
   */
  start(): void {
    if (this.silent) return;
    try {
      this.context ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (!this.master) {
        this.master = this.context.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") void this.context.resume();
      void this.load();
    } catch (error: unknown) {
      // No audio is a thing this app can do without. It should not be a thing it stops for.
      this.failed = true;
      console.error("Dice audio unavailable", error);
    }
  }

  /** Whether sound is switched off. The panel owns the setting; this owns the consequence. */
  get muted(): boolean {
    return this.silent;
  }

  set muted(value: boolean) {
    this.silent = value;
    if (value && this.master) this.master.gain.value = 0;
    else if (this.master) this.master.gain.value = 1;
  }

  /** Fetch and decode the six one-shots. Called from `start`, so it is already inside a gesture. */
  private load(): Promise<void> {
    this.loading ??= (async () => {
      const context = this.context;
      if (!context) return;
      await Promise.all(
        IMPACT_KINDS.map(async (kind) => {
          try {
            const response = await fetch(CLIP_URL(kind));
            if (!response.ok) throw new Error(`${response.status}`);
            this.clips.set(kind, await context.decodeAudioData(await response.arrayBuffer()));
          } catch (error: unknown) {
            // One missing one-shot costs the set some of its variety, not the feature: `fire` takes
            // the next one that did arrive rather than dropping the contact.
            console.error(`Dice impact sound failed to load from ${CLIP_URL(kind)}`, error);
          }
        }),
      );
    })();
    return this.loading;
  }

  /**
   * A second of white noise, made once and replayed at different offsets.
   *
   * An `AudioBufferSourceNode` needs a buffer, and generating a fresh 45 ms of noise for every one
   * of the several hundred rattles a ten-second shake produces would be several hundred allocations
   * for a sound nobody could tell from a slice of the same second.
   */
  private noiseBuffer(context: AudioContext): AudioBuffer {
    if (!this.noise) {
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
      this.noise = buffer;
    }
    return this.noise;
  }

  /** The graph, or nothing if there isn't one. Every cue below opens with this. */
  private live(): { context: AudioContext; master: GainNode } | undefined {
    if (this.silent || this.failed || !this.context || !this.master) return undefined;
    return { context: this.context, master: this.master };
  }

  /**
   * Dice knocking about inside a shaken cup.
   *
   * `energy` is how hard it is being shaken, 0 to 1 — see `shakeEnergy`. It scales the level rather
   * than gating the cue, so the rattle comes up with the shake instead of switching on.
   */
  rattle(energy: number): void {
    const live = this.live();
    if (!live) return;
    const { context, master } = live;
    const level = Math.max(0, Math.min(1, energy)) * RATTLE_GAIN;
    if (level <= 0) return;
    const noise = this.noiseBuffer(context);
    for (let i = 0; i < RATTLE_BURSTS; i += 1) {
      const at = context.currentTime + Math.random() * RATTLE_STAGGER;
      const source = context.createBufferSource();
      source.buffer = noise;
      // A different slice each time, so repeated bursts are not the same 45 ms over and over.
      const offset = Math.random() * (noise.duration - RATTLE_SECONDS);
      const band = context.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = RATTLE_LOW + Math.random() * (RATTLE_HIGH - RATTLE_LOW);
      band.Q.value = RATTLE_Q;
      const gain = context.createGain();
      // An exponential ramp, because a linear fade on a click reads as a chirp — and because zero
      // is not a legal target for one, it is stopped a little above it and cut.
      gain.gain.setValueAtTime(level * (0.6 + Math.random() * 0.4), at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + RATTLE_SECONDS);
      source.connect(band).connect(gain).connect(master);
      source.start(at, offset, RATTLE_SECONDS);
      source.stop(at + RATTLE_SECONDS);
    }
  }

  /**
   * Dice landing — one one-shot for every time one of them touches the felt.
   *
   * Each contact carries how long from now it happens and how fast the die was coming down, both
   * read off the baked throw by `contactsIn` in `renderer/diceMath.ts`. **Scheduled against the
   * audio clock rather than waited for**, so every impact lands on the frame its die does rather
   * than on the frame a timer happened to fire.
   *
   * **The argument is a shape rather than an imported type, and that is deliberate.** Nothing else
   * in this file imports anything; keeping it that way means the module that owns the
   * `AudioContext` — the one part of this app no test can construct — depends on nothing that could
   * drag it into a test. `Contact` from `renderer/diceMath.ts` satisfies this.
   *
   * **A one-shot that has not finished decoding when its moment arrives is dropped**, where the old
   * clip was started partway in. Eighty milliseconds late by eighty milliseconds is silence with a
   * click on the end; there is nothing left of an impact to join halfway.
   */
  clatter(contacts: readonly { seconds: number; speed: number }[]): void {
    const live = this.live();
    if (!live) return;
    // Fixed before anything is awaited, so a slow decode moves what is dropped and never what is
    // scheduled: every contact keeps the offset from the throw it was baked with.
    const origin = live.context.currentTime;
    if (this.clips.size > 0) {
      this.fire(contacts, origin);
      return;
    }
    void this.load().then(() => this.fire(contacts, origin));
  }

  /** Every contact that is still ahead of us, as a one-shot apiece. */
  private fire(contacts: readonly { seconds: number; speed: number }[], origin: number): void {
    const live = this.live();
    if (!live) return;
    const { context } = live;
    const arrived = IMPACT_KINDS.filter((kind) => this.clips.has(kind));
    if (arrived.length === 0) return;
    let taken = 0;
    for (const contact of contacts) {
      if (!(contact.speed > QUIET_SPEED)) continue;
      const at = origin + contact.seconds;
      if (at < context.currentTime) continue;
      // Round-robin over whichever ones loaded, so a fetch that lost one clip thins the variety
      // rather than punching holes in the clatter.
      const clip = this.clips.get(arrived[taken % arrived.length]!);
      taken += 1;
      if (!clip) continue;
      const hardness = Math.min(1, contact.speed / FULL_SPEED);
      // **Square-rooted, not linear.** A die keeps 0.42 of its speed per bounce, so its fourth is
      // at 7% of its first and would be inaudible scaled straight — where real dice stay audible
      // the whole way down to resting.
      const level = ROLL_GAIN * Math.sqrt(hardness);
      // A lighter touch rings higher, and a few per cent of scatter on top so that two contacts on
      // the same step are not one louder contact.
      const rate = 1.12 - 0.18 * hardness + (Math.random() - 0.5) * 0.06;
      this.sound(clip, at, level, rate);
    }
  }

  /** One clip, at a moment on the audio clock, at a level and a pitch. */
  private sound(clip: AudioBuffer, at: number, level: number, rate: number): void {
    const live = this.live();
    if (!live) return;
    const { context, master } = live;
    const source = context.createBufferSource();
    source.buffer = clip;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    gain.gain.value = level;
    source.connect(gain).connect(master);
    source.start(Math.max(context.currentTime, at));
  }

  /** Everything scheduled, cancelled. A tray swept mid-pour should go quiet, not finish its clatter. */
  stop(): void {
    if (!this.context || !this.master) return;
    this.master.disconnect();
    this.master = this.context.createGain();
    this.master.gain.value = this.silent ? 0 : 1;
    this.master.connect(this.context.destination);
  }

  /**
   * Give the context up.
   *
   * **The same distinction `dispose` draws about a WebGL context.** The app builds one stage and
   * keeps it, so this never comes up there — but `demo/dice-angles.html` builds a new one every time
   * you change the angle, and a browser allows only a handful of live audio contexts too.
   */
  close(): void {
    this.stop();
    void this.context?.close().catch(() => undefined);
    this.context = undefined;
    this.master = undefined;
    this.loading = undefined;
    this.clips.clear();
  }
}
