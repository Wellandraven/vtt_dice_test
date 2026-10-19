# Sound effects — attribution

**SFX Pack - Rolling Dice** by the *Halfwits & Failed Crits* podcast, recorded by Jonathan Swenson on
a Neumann TLM103.

- <https://www.ko-fi.com/halfwitsfailedcrits> — the pack is pay-what-you-want, and its Read Me asks
  that anyone who found it elsewhere consider paying for it there.
- <https://www.HalfwitPodcasts.com>

The Read Me also asks to be told when the sounds make it into someone's content. That is a request
rather than a licence term, and it is recorded here because it is the sort of thing that gets lost
the moment the source folder is not on the same machine.

## What was vendored, and what was not

`dice/impact-d4.wav` … `dice/impact-d20.wav` — **eighty milliseconds each**, cut from the head of the
pack's six `Roll 1d<kind>.wav` takes. One die hitting a table, six times over.

**Nothing is played back as a roll.** `renderer/diceAudio.ts` fires one of these for every contact
the baked throw actually has, at the moment it has it, so the clatter of a handful is assembled from
this app's own dice — around thirty impacts for ten dice, each scaled by how fast that die was
falling. The six are taken in turn, which is what they are six of: at this volume a d8 landing is not
identifiable as a d8, so the kinds are variation rather than accuracy.

**Downsampled to 22.05 kHz mono 16-bit** by `npm run vendor:dice-sfx` — see `tools/diceSfx.ts` for
the filter and why it is not an average of adjacent samples. 25.2 MB in, 21 KB out.

**Eighty milliseconds is set by the pack, not by taste.** A die bounces, and the gap from a take's
first hit to its second is 88 ms in the closest of the six. Anything longer would carry a bounce the
microphone heard, on top of the bounce this app is already going to play at a moment of its own.

### The ten multi-dice takes, and why they are gone

`roll-1.wav` … `roll-10.wav` used to be vendored whole — the d20 set, one file per handful, chosen by
the count. They were fired at the moment the first die touched the felt.

**Every one of them opens with the dice being shaken in a hand**: six tenths of a second of it on
`Roll 2d20`, nine tenths on `Roll 4d20`. So the shake played *after* our dice had already landed, and
over the top of the rattle this app generates for the cup — which is what it sounded like, a second
shake arriving once the dice were down. Only `roll-1` was ever right, because a one-die take has
nothing in front of the throw.

`trim` in `tools/diceSfx.ts` was written to prevent exactly this and could not. It cuts at the first
sample above 3% of a clip's own peak, and in a room recording of dice being shaken the first thing
over that line is the shake. The note that used to sit here — that every clip now opened six
milliseconds in, where the worst had been eighty-three — was true, and was measuring the wrong event.
There is no threshold that separates *shaken in a hand* from *landed on a table* across all ten,
which is what makes the one-shot the fix rather than a better number.

The five other kinds and all sixty files remain in the source folder.

The rattle while the cup is shaking is **not** from this pack. It is generated at runtime — see
`renderer/diceAudio.ts` — because it has to follow the cup's own motion, which is a different length
on every roll.
