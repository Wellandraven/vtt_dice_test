# Dice Lab

The dice roller from a virtual-tabletop map project, extracted so it can be user-tested on its own.

Pick dice, hold the Roll button to shake them in a cup, let go to tip them into a felt tray, and
read what they landed on. That is the whole app.

```
npm install
npm run dev      # http://localhost:3000
npm test         # 218 unit tests
npm run typecheck
npm run build    # Next.js production build (webpack)
```

The app is a Next.js App Router project hosted on Netlify, with study data in Netlify Database
(managed Postgres). The tables are defined in `db/schema.ts`; migrations live in
`netlify/database/migrations` and are applied automatically on each deploy (regenerate them with
`npm run db:generate -- --name <change>` after a schema change). Use `netlify dev` locally to get a
development database. On Netlify, set `DASHBOARD_PASSWORD` and a separate long
`DASHBOARD_SESSION_SECRET` under Site configuration → Environment variables. Every push to `main`
redeploys.

The results dashboard is available at `/dashboard`. Dashboard sessions expire after eight hours;
the admin actions (launch, clear QA data) require the signed HTTP-only cookie.

The current build presents the original additive tray as **Interface A**, explicit per-die
steppers as **Interface B**, and a horizontal bottom toolbar as **Interface C**. It creates
anonymous sessions, balances random assignment across A/B/C, and gives each browser one interface
with one practice and three scored tasks. It stores the event contract and rating in the database and resumes
at the first incomplete task after a refresh.

This is a versioned, single-interface data phase. Earlier three-interface records remain stored in
their prior phase and are not mixed with the current results.

The pre-registered research and measurement contract lives in `EXPERIMENT_PLAN.md`.

Needs a browser with WebGL and, for sound, a real user gesture (which the Roll button is).

---

## How the interaction actually works

**Most of this is not guessable from looking at it**, so it is worth reading before you put it in
front of anybody.

- **Roll is press-and-hold, not click.** Pressing puts the dice in a cup; holding shakes it;
  releasing tips them out. A quick tap is just a very short hold — there is a floor (`MIN_SHAKE`)
  so a click cannot produce dice that were never in motion.
- **The button fills while you hold it.** That is the ten-second limit (`SHAKE_LIMIT`) becoming
  visible. Reach the end and it pours for you.
- **The roll is decided the instant you press**, before a single shake step runs. Nothing about how
  long or how hard you hold can change it, and the panel prints the total on release — before the
  dice have physically landed. That is deliberate: the roll is a fact from the moment of the press,
  and holding the number back until the felt agreed would be pretending the animation decided
  something. Testers often assume the opposite, and it is worth watching whether they do.
- **In Interface A, right-click a die button to take one away.** There is no minus button — fourteen controls in a
  232px panel was judged a worse trade than an affordance that has to be discovered. Reset is
  always there for anyone who does not find it. **This is a good thing to watch in testing.**
- **Click the dimmed area (or the felt) to sweep the dice.** The Clear dice button does the same.
- **Reset and Clear dice undo different things.** Reset empties the dice you are *about* to throw;
  Clear sweeps the ones already on the felt.
- **Advantage greys out** rather than disappearing when the handful is not one it applies to, so
  the control says what it is waiting for. Try a single d20 to see it enable.
- **Size (1×/2×/3×) cannot change a roll.** With dice on the felt, picking a size re-throws *the
  same seed*, so the faces and total are identical and only the size and bounce differ. With
  nothing thrown yet it throws a sample handful and deliberately does not record it as a result.
- **Keyboard works the same way**: Tab to Roll, then hold Enter or Space.

## The Modifier row

Interface A uses a visible numeric accumulator. The first button switches between positive and
negative; the `1`, `2`, and `3` buttons add their displayed amount in that direction. The current
signed value is always printed above the buttons, and Reset returns it to `+0`. This matches the
additive mental model of the dice row and removes the need to infer a number from an ability name.

## Interface B: explicit dice steppers

Interface B keeps every die visible but places dedicated `−` and `+` controls beneath it, with the
current count beside the die name. It removes Interface A's right-click dependency and makes adding
and undoing dice equally explicit on mouse, keyboard, and touch. Modifier, Advantage, dice size,
sound, the hold-to-roll gesture, physics, and result presentation are unchanged.

## Interface C: horizontal bottom toolbar

Interface C keeps Interface A's click-to-add dice behavior but moves the complete control surface
into a wide toolbar that slides up from the bottom of the tabletop. Its groups read horizontally—
dice, mode, modifier, size, result, and roll actions—while the shared renderer shifts the tray above
the bar so the dice do not land underneath it.

## What is a copy and what was written for this package

**Copied byte-for-byte from the parent project. Treat these as upstream code.**

```
renderer/diceFx.ts     the three.js half: the tray, the cup, the dice, the render loop
renderer/diceMath.ts   the brain — throw simulation, settling, face-landing, packing. No three.js.
renderer/cupMath.ts    lift, shake, tip and pour
renderer/diceAudio.ts  the clatter and the synthesized rattle
engine/dice.ts         seeded rolls
engine/tray.ts         what a handful of dice comes to. Knows nothing about a panel.
schema/noise.ts        the integer hash every seeded thing here draws from
app/diceTray.ts        the panel's state, DOM-free (was demo/diceTray.ts)
tools/diceSfx.ts       build-time wav vendoring
```

They carry a lot of hard-won tuning constants and long comments explaining decisions that look
arbitrary until you know why. **Resist tidying them.** If you change the maths, `npm test` is your
safety net — 218 cases, and `diceMath`/`cupMath` are where nearly all the behaviour lives precisely
so it can be tested without a browser.

**Written for this package:**

```
app/index.html          markup and CSS lifted from the app's much larger page, shell removed
app/main.ts             the wiring, lifted from a 7,000-line demo/main.ts
app/sampleCharacter.ts  the legacy character fixture retained from the ability-picker baseline
schema/character.ts     a deliberate ~50-line SHIM — see below
```

`app/main.ts` documents the four things that changed during the lift, at the top of the file.

### `schema/character.ts` is a shim, on purpose

The real file is 238 lines and imports `schema/item.ts`, which imports the project's entire map data
model — walls, terrain, lights, the lot. The dice path reads exactly one thing from a character:
`character?.sheet?.abilities?.modifier?.[ability]`. So the file here carries that and nothing else.

**If you need a field it does not have, add it here.** Do not go and fetch the original; it will
bring the map with it.

## Layout

```
app/        the Next.js pages, API routes, client study runner, and dice wiring
engine/     seeded rolling
renderer/   the tray, cup, dice and sound
schema/     the noise hash, and the character shim
public/     models and sounds served at the web root
tests/      218 unit tests, all DOM-free, run in node
study/      balanced sequences, task packs, and exact valid-roll rules
db/         Database adapter (D1-style API on libSQL), schema, and idempotent local/runtime schema bootstrap
drizzle/    generated, reviewable SQLite migration history
tools/      build-time asset vendoring
```

The folder depth mirrors the original project so every copied file's `../renderer/diceMath.js`-style
import resolves unchanged. That is what let the files above be copied rather than rewritten — worth
preserving if you move things around.

Next.js serves `public/` at `/`. `renderer/diceAudio.ts` hard-codes
`/sfx/dice/impact-d{n}.wav` with no injection point, so that layout is load-bearing.

## Assets and credits

- `public/models/custom/dice_tray.glb` and `dice_cup.glb` (~1.4 MB together) are custom models
  from the parent VTT project.
- `public/sfx/dice/impact-d{4,6,8,10,12,20}.wav` are from **"SFX Pack — Rolling Dice"** by the
  *Halfwits & Failed Crits* podcast, recorded by Jonathan Swenson, pay-what-you-want. The pack's
  read-me asks to be told when the sounds ship. **See `public/sfx/ATTRIBUTION.md`, which must
  stay with the package.** The originals were 25 MB; they are cut to 80 ms and downsampled to
  22.05 kHz mono here.
- Die faces, numbers and materials are entirely procedural — there are no texture files. A tray or
  cup that fails to load costs only the tray or cup; the dice still throw.

## Study data boundary

- The browser keeps only the anonymous session id in local storage; the database is authoritative.
- `study_sessions` retains consent time, sequence, phase, and non-identifying analysis segments.
- `study_trials` is the metric-ready summary, including elapsed time, invalid attempts, help, and ratings.
- `study_events` is the append-only event trail used to audit those summaries.
- Optional post-study contact choices live in `study_contact_opt_ins`, outside the study-response
  tables. Newsletter-only email addresses are not linked to a session; a session link is retained
  only when the participant explicitly requests a follow-up about their session.
- Initial CSS viewport and screen dimensions are captured automatically; debounced resize events
  retain both the previous and resulting viewport dimensions.
- Practice trials are explicitly marked and excluded from the primary metric.
- The primary timer ends at correct roll initiation; animation completion is a separate diagnostic.

## Known gaps versus the real app

- There is no roll history. The rail keeps the last throw only, which is what the app does too.
- The tray is fixed to the right of the panel and centred in what is left; in the app it centres in
  the map area beside a sidebar. Same code, different amount of room.
- Dice preferences and the last visual roll are session-only. Study progress and measurement data persist.
