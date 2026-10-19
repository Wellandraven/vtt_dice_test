/**
 * Turning the dice-roll recordings into the files the browser loads.
 *
 * Run through `tools/vendorDiceSfx.ts` — `npm run vendor:dice-sfx`. **The split is the same one
 * `renderer/diceMath.ts` and `renderer/diceFx.ts` make**: everything that could be *wrong* is here
 * and is covered by `tests/diceSfx.test.ts`, and what is left over there is reading a command line.
 *
 * The pack ships six die kinds by ten counts — sixty files, 25 MB of 44.1 kHz stereo 24-bit, which
 * is a studio master of a sound that plays for a second and a half over a browser's speakers.
 *
 * **Six of those sixty are vendored, and only the first eighty milliseconds of each.** What is
 * wanted is one die hitting a table, not a recording of somebody's throw: `renderer/diceAudio.ts`
 * fires one of these for every contact the baked throw actually has, at the moment it has it, so the
 * clatter is assembled from this app's own dice rather than played back from someone else's.
 *
 * **The ten multi-dice takes used to be vendored whole, and that was the defect.** Each one opens
 * with the dice being shaken in a hand — six tenths of a second of it on `Roll 2d20`, nine on
 * `Roll 4d20` — and the clip was fired at the moment the first die landed, so the shake played
 * *after* the dice had already hit, over the top of the rattle this app generates for the cup. The
 * `trim` below was meant to prevent exactly that and could not: at 3% of a clip's own peak the first
 * thing over the threshold in a room recording of dice being shaken is the shake. There is no
 * threshold that separates the two across all ten, which is what makes the one-shot the fix rather
 * than a better number.
 *
 * **Not part of the build.** The vendored WAVs are committed; this runs when the pack changes.
 *
 * **The one thing here that could be quietly wrong is the filter**, which is why it is a function of
 * its own with a test. 44.1 kHz to 22.05 is exactly two to one, so the obvious implementation is to
 * average adjacent samples and be done. Averaging is a two-tap low-pass and a bad one: everything
 * above 11 kHz folds back down rather than being removed, and dice clatter is mostly up there. The
 * result does not sound broken, it sounds like a worse recording — which is the failure mode you
 * would blame on the microphone rather than on the tool.
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What comes out: half the rate, one channel, sixteen bits. A sixth of what went in. */
export const OUTPUT_RATE = 22050;

/**
 * How many taps the decimating filter gets.
 *
 * A Blackman window's transition band is about `5.5 / taps` in cycles per sample, and the cutoff has
 * to sit at a quarter of the input rate with the stopband reached well before the content that would
 * alias into the band a dice roll lives in. Thirty-one taps only just manage it; this is the next
 * power of two up and costs nothing — the whole pack is a few tens of millions of multiply-adds.
 */
const TAPS = 63;

/**
 * What counts as the recording having started, as a share of its own loudest moment.
 *
 * **Relative to the clip, not an absolute level, and that distinction is the whole of the setting.**
 * A fixed threshold near the noise floor answers "when does the file stop being digital silence",
 * which for a room mic on a quiet stage is *immediately* — measured, one of these clips did not reach
 * a fifth of its peak until eight tenths of a second in, and trimmed to silence it kept every bit of
 * that. What is wanted is the first audible tap, which is a small fraction of the loudest bounce and
 * is nowhere near the noise floor.
 *
 * Low enough to catch a die landing softly first, which several of these open with.
 */
const ONSET = 0.03;
/** How much of the quiet before the first hit to keep, in seconds, so it does not start clipped. */
const PRE_ROLL = 0.006;

interface Decoded {
  rate: number;
  /** Mixed to one channel. These play as a small sound over a map; stereo is bytes for nothing. */
  samples: Float32Array;
}

/**
 * Read a PCM WAV.
 *
 * Chunks are walked rather than assumed to be `fmt ` then `data` at fixed offsets: the pack was cut
 * in a DAW and several of its files carry extra chunks, and one of them sits between the two this
 * needs. Odd-length chunks are padded to even, which is in the spec and is exactly the sort of thing
 * a hand-written reader gets away with until the one file that has one.
 */
export function readWav(bytes: Buffer): Decoded {
  if (bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let format: { channels: number; rate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = bytes.subarray(at, at + 4).toString("ascii");
    const length = bytes.readUInt32LE(at + 4);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (id === "fmt ") {
      format = { channels: body.readUInt16LE(2), rate: body.readUInt32LE(4), bits: body.readUInt16LE(14) };
    }
    if (id === "data") data = body;
    at += 8 + length + (length % 2);
  }
  if (!format) throw new Error("no fmt chunk");
  if (!data) throw new Error("no data chunk");

  const { channels, bits, rate } = format;
  const width = bits / 8;
  const frames = Math.floor(data.length / (width * channels));
  const samples = new Float32Array(frames);
  // Signed little-endian PCM at 8, 16, 24 or 32 bits, mixed down. 24 is the one that has to be
  // assembled by hand — there is no `readInt24LE` — and the sign extension is the whole of it.
  const full = 2 ** (bits - 1);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const offset = (frame * channels + channel) * width;
      let value: number;
      if (width === 1) value = data.readUInt8(offset) - 128;
      else if (width === 2) value = data.readInt16LE(offset);
      else if (width === 3) value = (data.readUInt8(offset) | (data.readUInt8(offset + 1) << 8) | (data.readInt8(offset + 2) << 16));
      else value = data.readInt32LE(offset);
      sum += value / full;
    }
    samples[frame] = sum / channels;
  }
  return { rate, samples };
}

/**
 * A windowed-sinc low-pass, cut at a quarter of the sample rate.
 *
 * A quarter, because that is the Nyquist frequency of what comes out: anything above it has nowhere
 * to go after the decimation but back down into the audible band, mirrored. Blackman-windowed for
 * its stopband rather than its transition width — an alias is a tone that was not played, which is
 * far more noticeable than a little softness at the very top of the band.
 */
export function halfBandKernel(taps: number = TAPS): Float64Array {
  const kernel = new Float64Array(taps);
  const middle = (taps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < taps; i += 1) {
    const x = i - middle;
    // sinc(x/2), the ideal low-pass at a quarter of the rate. The limit at zero is written out
    // because the ratio is 0/0 there.
    const sinc = x === 0 ? 0.5 : Math.sin(Math.PI * x * 0.5) / (Math.PI * x);
    const window = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / (taps - 1)) + 0.08 * Math.cos((4 * Math.PI * i) / (taps - 1));
    kernel[i] = sinc * window;
    sum += kernel[i]!;
  }
  // Normalised so a constant passes through unchanged — without it the whole clip's level depends
  // on how many taps it happened to be given.
  for (let i = 0; i < taps; i += 1) kernel[i]! /= sum;
  return kernel;
}

/** Filter, then keep every other sample. The order matters and is the entire point. */
export function decimateHalf(input: Float32Array, kernel: Float64Array = halfBandKernel()): Float32Array {
  const middle = (kernel.length - 1) / 2;
  const out = new Float32Array(Math.floor(input.length / 2));
  for (let i = 0; i < out.length; i += 1) {
    const centre = i * 2;
    let sum = 0;
    for (let k = 0; k < kernel.length; k += 1) {
      const at = centre + k - middle;
      // Held at the ends rather than wrapped or zeroed: a clip that starts loud would otherwise open
      // with a click, which is the one artefact nobody would put down to the filter.
      sum += kernel[k]! * (input[at < 0 ? 0 : at >= input.length ? input.length - 1 : at] ?? 0);
    }
    out[i] = sum;
  }
  return out;
}

/**
 * Cut everything before the first hit, and the tail after the last.
 *
 * **The head is the half that matters.** `renderer/diceAudio.ts` fires these at the exact moment the
 * first die touches the felt, worked out from the baked throw — a cue that is only as good as the
 * file agreeing that its own first hit is at its start. Anything in front of it is the clatter
 * arriving that much after the dice it belongs to.
 */
export function trim(samples: Float32Array, rate: number): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 0) return samples;
  const floor = peak * ONSET;
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]!) < floor) first += 1;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]!) < floor) last -= 1;
  if (first >= last) return samples;
  const start = Math.max(0, first - Math.round(PRE_ROLL * rate));
  return samples.slice(start, last + 1);
}

/**
 * How much of a single-die take is kept: one hit, and none of the next one.
 *
 * **Set by the pack rather than by taste.** A die dropped on a table bounces, and the gap from the
 * first hit to the second is 88 ms in the closest of the six recordings (`d10`) and 164 ms in the
 * furthest (`d4`). Anything longer than the shortest gap would carry that file's second bounce
 * inside the one-shot — and this app supplies its own second bounce, from `contactsIn`, at a time
 * that has nothing to do with when the microphone heard one. Two bounces would then arrive for every
 * one that happened.
 */
const IMPACT_SECONDS = 0.08;
/**
 * How much of the end is faded out.
 *
 * Eighty milliseconds is a cut mid-ring, and a waveform that stops partway up is a click — the same
 * artefact `decimateHalf` holds its ends to avoid, arriving from the other direction.
 */
const IMPACT_FADE = 0.015;

/**
 * One die hitting a table, cut out of a recording of one being thrown.
 *
 * `trim` first, and it is reliable here in the way it is not on the multi-dice takes: a single-die
 * throw has no shake in front of it, so the first thing above the threshold is the landing. Measured
 * across the six, the first sample over 3% of peak *is* the peak in every one of them — which is
 * the same fact, and the reason `roll-1.wav` was the one clip that always played on time.
 */
export function impact(samples: Float32Array, rate: number): Float32Array {
  const hit = trim(samples, rate);
  const out = hit.slice(0, Math.min(hit.length, Math.round(IMPACT_SECONDS * rate)));
  const fade = Math.min(out.length, Math.round(IMPACT_FADE * rate));
  for (let i = 0; i < fade; i += 1) {
    // Raised cosine, which reaches exactly zero at the last sample — a linear ramp on a decaying
    // tail is audible as a change of pace, and a clip that ends a fraction above zero still ticks.
    out[out.length - fade + i]! *= 0.5 * (1 + Math.cos((Math.PI * (i + 1)) / fade));
  }
  return out;
}

/** Sixteen-bit mono PCM, the smallest thing every browser decodes without a codec. */
export function writeWav16(samples: Float32Array, rate: number): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    // Clamped before rounding: the filter's overshoot can push a sample that was at full scale a
    // fraction past it, and an Int16 that wraps is a loud crack rather than a quiet clip.
    const value = Math.max(-1, Math.min(1, samples[i]!));
    data.writeInt16LE(Math.round(value * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // bytes per second
  header.writeUInt16LE(2, 32); // bytes per frame
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/**
 * The kinds the pack has a folder for, and the order their one-shots are numbered in.
 *
 * **All six are vendored, where the clatter used one.** Not for accuracy — a d8 landing is not
 * identifiable as a d8 at the volume this plays, which is exactly why the old mapping picked by
 * count and ignored the kind. It is for variation: six recordings of the same event, taken in turn,
 * is what keeps forty contacts in a row from being the same eighty milliseconds forty times.
 */
export const KINDS = [4, 6, 8, 10, 12, 20] as const;

/**
 * Cut one one-shot per kind from that kind's single-die take.
 *
 * `source` is the pack's root — the folder holding `d4` … `d20`, not one of them. All six are read,
 * so a missing folder is an error rather than a set that quietly comes out short.
 */
export function vendor(source: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const kernel = halfBandKernel();
  let bytes = 0;
  for (const kind of KINDS) {
    // Only the one-die take is ever read, so the pack's other spelling — `Roll10d20.wav`, without
    // the space the other nine have — never comes up. It cost a regex when ten files were wanted.
    const from = join(source, `d${kind}`, `Roll 1d${kind}.wav`);
    const { rate, samples } = readWav(readFileSync(from));
    if (rate !== OUTPUT_RATE * 2) throw new Error(`${from} is ${rate} Hz; this decimates ${OUTPUT_RATE * 2} Hz by two`);
    const out = writeWav16(impact(decimateHalf(samples, kernel), OUTPUT_RATE), OUTPUT_RATE);
    writeFileSync(join(dest, `impact-d${kind}.wav`), out);
    bytes += out.length;
    const ms = Math.round(((out.length - 44) / 2 / OUTPUT_RATE) * 1000);
    console.log(`  d${String(kind).padEnd(2)} -> impact-d${kind}.wav  ${ms} ms  ${Math.round(out.length / 1024)} KB`);
  }
  console.log(`  ${KINDS.length} files, ${Math.round(bytes / 1024)} KB\n`);
}
