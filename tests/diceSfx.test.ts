import { describe, expect, it } from "vitest";
import { KINDS, OUTPUT_RATE, decimateHalf, halfBandKernel, impact, readWav, trim, writeWav16 } from "../tools/diceSfx.js";
import { IMPACT_KINDS } from "../renderer/diceAudio.js";

// The dice recordings, on their way in.
//
// **The filter is the reason this file exists.** Everything else here is bookkeeping that would fail
// loudly; a bad decimation fails quietly, and it fails as *the recording sounding worse* rather than
// as anything anyone would attribute to a tool. So it is checked as the property it actually has: a
// tone above the new Nyquist frequency must not come out as a tone below it.
//
// `renderer/diceAudio.ts` is imported for `IMPACT_KINDS` alone. Nothing in it touches an
// `AudioContext` until the class is built, which nothing here does.

const INPUT_RATE = OUTPUT_RATE * 2;

/** A pure tone, as samples. */
function tone(hz: number, seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  for (let i = 0; i < out.length; i += 1) out[i] = Math.sin((2 * Math.PI * hz * i) / rate);
  return out;
}

/**
 * How much of a given frequency a signal holds, as a share of full scale.
 *
 * One bin of a discrete Fourier transform, worked out directly. A whole FFT for three questions
 * would be a library, and the answer wanted is "is there anything at all at this pitch".
 */
function energyAt(samples: Float32Array, hz: number, rate: number): number {
  let real = 0;
  let imaginary = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const angle = (2 * Math.PI * hz * i) / rate;
    real += samples[i]! * Math.cos(angle);
    imaginary += samples[i]! * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / samples.length;
}

describe("the decimating filter", () => {
  it("does not fold high frequencies back into the audible band", () => {
    // **The whole point.** 15 kHz is above the 11 kHz the output can carry, so it has to be removed.
    // Kept, it does not disappear — it comes back mirrored about the new Nyquist, at 22050 - 15000 =
    // 7050 Hz, in the middle of everything. Averaging adjacent samples, which is the obvious way to
    // halve a rate, leaves most of it there.
    const out = decimateHalf(tone(15000, 0.2, INPUT_RATE));
    expect(energyAt(out, 7050, OUTPUT_RATE)).toBeLessThan(0.01);
  });

  it("is not the two-tap average that would have been written instead", () => {
    // The comparison, so the test above is known to be checking something a naive implementation
    // fails rather than something any implementation passes.
    const input = tone(15000, 0.2, INPUT_RATE);
    const averaged = new Float32Array(Math.floor(input.length / 2));
    for (let i = 0; i < averaged.length; i += 1) averaged[i] = (input[i * 2]! + input[i * 2 + 1]!) / 2;
    expect(energyAt(averaged, 7050, OUTPUT_RATE)).toBeGreaterThan(0.3);
  });

  it("leaves what is meant to survive alone", () => {
    // A filter that removes the aliasing by removing everything would pass the test above.
    for (const hz of [200, 1000, 4000, 8000]) {
      const out = decimateHalf(tone(hz, 0.2, INPUT_RATE));
      expect(energyAt(out, hz, OUTPUT_RATE), `${hz} Hz`).toBeGreaterThan(0.8);
    }
  });

  it("keeps the level, so a clip does not come back quieter than it went in", () => {
    const kernel = halfBandKernel();
    expect(kernel.reduce((sum, tap) => sum + tap, 0)).toBeCloseTo(1, 12);
  });

  it("halves the length", () => {
    expect(decimateHalf(tone(440, 1, INPUT_RATE)).length).toBe(OUTPUT_RATE);
  });

  it("does not open with a click", () => {
    // The ends are held rather than zeroed, so a clip that starts loud is not preceded by a step
    // from silence — the one artefact nobody would put down to the filter.
    const loud = new Float32Array(2000).fill(0.9);
    const out = decimateHalf(loud);
    expect(out[0]).toBeCloseTo(0.9, 6);
  });
});

describe("reading and writing", () => {
  it("round-trips a signal through a 16-bit mono WAV", () => {
    const samples = tone(440, 0.05, OUTPUT_RATE);
    const back = readWav(writeWav16(samples, OUTPUT_RATE));
    expect(back.rate).toBe(OUTPUT_RATE);
    expect(back.samples.length).toBe(samples.length);
    for (let i = 0; i < samples.length; i += 1) expect(back.samples[i]!).toBeCloseTo(samples[i]!, 4);
  });

  it("clips rather than wrapping", () => {
    // A sample pushed a fraction past full scale by the filter's overshoot, written into an Int16
    // that wraps, is a loud crack in the middle of a quiet passage.
    const back = readWav(writeWav16(Float32Array.from([1.4, -1.4]), OUTPUT_RATE));
    expect(back.samples[0]!).toBeGreaterThan(0.99);
    expect(back.samples[1]!).toBeLessThan(-0.99);
  });

  it("walks the chunks rather than assuming where they are", () => {
    // The pack was cut in a DAW and several of its files carry chunks between `fmt ` and `data`.
    // An odd-length one has a pad byte that is not counted in its length, which is in the spec and
    // is exactly the sort of thing a hand-written reader gets away with until the one file with one.
    const plain = writeWav16(tone(300, 0.02, OUTPUT_RATE), OUTPUT_RATE);
    const extra = Buffer.alloc(8 + 5);
    extra.write("LIST", 0, "ascii");
    extra.writeUInt32LE(5, 4);
    const spliced = Buffer.concat([plain.subarray(0, 36), extra, Buffer.alloc(1), plain.subarray(36)]);
    spliced.writeUInt32LE(spliced.length - 8, 4);
    expect(readWav(spliced).samples.length).toBe(readWav(plain).samples.length);
  });

  it("mixes both channels down rather than taking one", () => {
    // Hand-built stereo: full scale left, silence right. Taking a channel gives 1 or 0; mixing
    // gives a half, and only one of those survives a recording where the dice are panned.
    const header = writeWav16(Float32Array.from([0, 0]), OUTPUT_RATE);
    header.writeUInt16LE(2, 22);
    header.writeUInt32LE(OUTPUT_RATE * 4, 28);
    header.writeUInt16LE(4, 32);
    header.writeInt16LE(32767, 44);
    header.writeInt16LE(0, 46);
    const back = readWav(header);
    expect(back.samples.length).toBe(1);
    expect(back.samples[0]!).toBeCloseTo(0.5, 3);
  });
});

describe("trimming", () => {
  it("takes the silence off the front, because that is where the cue is", () => {
    // The clips are fired at the moment the first die touches the felt. A tenth of a second of room
    // tone in front would put every clatter that far behind its own dice.
    const quiet = new Float32Array(Math.round(0.1 * OUTPUT_RATE));
    const loud = tone(800, 0.05, OUTPUT_RATE);
    const joined = new Float32Array(quiet.length + loud.length);
    joined.set(loud, quiet.length);
    const trimmed = trim(joined, OUTPUT_RATE);
    expect(trimmed.length).toBeLessThan(joined.length);
    // A few milliseconds of pre-roll are kept, so it does not start clipped.
    expect(trimmed.length).toBeGreaterThan(loud.length);
    expect(trimmed.length).toBeLessThan(loud.length + 0.02 * OUTPUT_RATE);
  });

  it("leaves a clip that is silence alone rather than emptying it", () => {
    const quiet = new Float32Array(500);
    expect(trim(quiet, OUTPUT_RATE).length).toBe(500);
  });
});

describe("cutting a one-shot", () => {
  /** A burst of tone, as one bounce would be. */
  function burst(seconds: number, level = 1): Float32Array {
    const out = new Float32Array(Math.round(seconds * OUTPUT_RATE));
    for (let i = 0; i < out.length; i += 1) out[i] = level * Math.sin((2 * Math.PI * 900 * i) / OUTPUT_RATE);
    return out;
  }

  it("is short enough that the recording's own second bounce cannot be in it", () => {
    // **The measurement the length is set from, as a test.** A die bounces, and in the pack's six
    // single-die takes the gap from the first hit to the second is 88 ms at the closest (`d10`).
    // A one-shot longer than that carries a bounce the microphone heard — and this app already
    // supplies the second bounce itself, from `contactsIn`, at a moment that has nothing to do with
    // when that one happened. Two would then sound for every one that occurred.
    expect(impact(burst(1), OUTPUT_RATE).length / OUTPUT_RATE).toBeLessThan(0.088);
  });

  it("is the same length whatever it was given", () => {
    const long = impact(burst(1), OUTPUT_RATE).length;
    const longer = impact(burst(3), OUTPUT_RATE).length;
    expect(long).toBe(longer);
  });

  it("ends at silence rather than partway up a waveform", () => {
    // A cut mid-ring is a click, which is the one artefact nobody would put down to the tool — the
    // same reason `decimateHalf` holds its ends rather than zeroing them.
    const out = impact(burst(1), OUTPUT_RATE);
    // `Math.abs` because the last sample of a fade applied to a negative one is `-0`, which is
    // silence to every ear and to `writeWav16`, and is not `0` to `Object.is`.
    expect(Math.abs(out[out.length - 1]!)).toBe(0);
  });

  it("fades a clip shorter than the window rather than padding it out", () => {
    const short = burst(0.03);
    const out = impact(short, OUTPUT_RATE);
    expect(out.length).toBeLessThan(Math.round(0.08 * OUTPUT_RATE));
    expect(Math.abs(out[out.length - 1]!)).toBe(0);
  });

  it("takes the head of the hit, not the head of the file", () => {
    // `trim` runs first, so silence in front does not eat into the eighty milliseconds. Cutting a
    // fixed window from sample zero instead would give a one-shot that was mostly room tone.
    const quiet = new Float32Array(Math.round(0.2 * OUTPUT_RATE));
    const joined = new Float32Array(quiet.length + Math.round(0.5 * OUTPUT_RATE));
    joined.set(burst(0.5), quiet.length);
    const out = impact(joined, OUTPUT_RATE);
    let loudest = 0;
    for (const sample of out) loudest = Math.max(loudest, Math.abs(sample));
    expect(loudest).toBeGreaterThan(0.5);
  });
});

describe("the one-shots the renderer asks for", () => {
  it("are the ones the tool writes", () => {
    // `tools/diceSfx.ts` names the files and `renderer/diceAudio.ts` fetches them, and a renderer
    // may not import from `tools` — so the two lists are written twice and agreed here. Out of step,
    // every roll would 404 its way to silence with nothing failing.
    expect([...IMPACT_KINDS]).toEqual([...KINDS]);
  });
});
