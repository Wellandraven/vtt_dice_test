import { DiceStage } from "../renderer/diceFx.js";
import { rerollSeed } from "../engine/dice.js";
import { DICE, allowsAdvantage, rollTray, total as trayTotal, type TrayRoll } from "../engine/tray.js";
import {
  DICE_SIZES,
  MODIFIER_STEPS,
  addModifier,
  addDie,
  emptyTray,
  modifierLabel,
  modifierStepSelected,
  modeAvailable,
  removeDie,
  resetTray,
  sizeLabel,
  toggleModifierSign,
  trayLine,
  type DiceTray,
} from "./diceTray.js";

// The dice roller, wired up.
//
// **This file is a lift from demo/main.ts in the VTT project, not a reimplementation.** Everything
// below — renderDicePanel, the shake pair, the tray sizing, every listener — is the app's own code
// with its own comments, moved across as literally as it would go. That is the point of the
// package: what a tester is reacting to has to be what the app does, and a tidied-up rewrite would
// be a different thing wearing the same clothes.
//
// The original wiring is preserved, with the study's explicit numeric modifier control replacing
// the character-sheet ability picker so participants can see and construct the tested value.
//
//  1. `state.dice` was one field of a large DemoState object. Here it is the module-level `tray`
//     below. It was already replaced immutably everywhere (`{ ...state.dice, ... }`), so this is
//     mechanical rather than a change of shape.
//  2. `syncDicePanel` gated on `showsMap(state.mode) && renderedYet()`, since a tray floating over
//     the app's character Forge would be sitting on a screen with no map under it. There is nothing
//     but the tray here, so the gate is gone.
//  3. The roll commit (then `stopShaking`) ended by calling `resolvePendingWish(roll)`. That is the jinn — a d20 the app
//     rolls on your behalf against a table of seventy-one wishes — reaching into the one place
//     every roll is committed. It is the only thing outside the dice that touched this path, it
//     only ever pointed inward, and it is gone.

// The two models, as demo/models.ts declares them. Copied as literals rather than by importing that
// file, which is 17 KB of tree, kit and miniature registries with these two lines in it.
const DICE_TRAY_URL = "/models/custom/dice_tray.glb";
const DICE_CUP_URL = "/models/custom/dice_cup.glb";

const diceOpenButton = document.querySelector<HTMLButtonElement>("#dice-open")!;
const diceResultEl = document.querySelector<HTMLElement>("#dice-result")!;
const dicePanelEl = document.querySelector<HTMLElement>("#dice-panel")!;
const diceCloseButton = document.querySelector<HTMLButtonElement>("#dice-close")!;
const diceSettingsButton = document.querySelector<HTMLButtonElement>("#dice-settings")!;
const diceSoundButton = document.querySelector<HTMLButtonElement>("#dice-sound")!;
const diceTypeBlock = document.querySelector<HTMLElement>("#dice-type-block")!;
const diceTypeRow = document.querySelector<HTMLElement>("#dice-type-row")!;
const diceStepperBlock = document.querySelector<HTMLElement>("#dice-stepper-block")!;
const diceStepperGrid = document.querySelector<HTMLElement>("#dice-stepper-grid")!;
const diceModeBlock = document.querySelector<HTMLElement>("#dice-mode-block")!;
const diceModeRow = document.querySelector<HTMLElement>("#dice-mode-row")!;
const diceModifierBlock = document.querySelector<HTMLElement>("#dice-modifier-block")!;
const diceModifierRow = document.querySelector<HTMLElement>("#dice-modifier-row")!;
const diceModifierValue = document.querySelector<HTMLElement>("#dice-modifier-value")!;
const diceSizeRow = document.querySelector<HTMLElement>("#dice-size-row")!;
const dicePanelLine = document.querySelector<HTMLElement>("#dice-panel-line")!;
const diceResetButton = document.querySelector<HTMLButtonElement>("#dice-reset")!;
const diceRollButton = document.querySelector<HTMLButtonElement>("#dice-roll")!;
const diceClearButton = document.querySelector<HTMLButtonElement>("#dice-clear")!;
const diceStageEl = document.querySelector<HTMLElement>("#dice-stage")!;
const diceStageCanvas = document.querySelector<HTMLCanvasElement>("#dice-stage-canvas")!;
const railCharacter = document.querySelector<HTMLElement>("#rail-character")!;
const rollResultToast = document.querySelector<HTMLElement>("#roll-result-toast")!;
const rollResultToastText = document.querySelector<HTMLElement>("#roll-result-toast-text")!;
const rollResultToastClose = document.querySelector<HTMLButtonElement>("#roll-result-toast-close")!;
const diceSettingsLayer = document.querySelector<HTMLElement>("#dice-settings-layer")!;
const diceSettingsModal = document.querySelector<HTMLElement>("#dice-settings-modal")!;
const diceSettingsClose = document.querySelector<HTMLButtonElement>("#dice-settings-close")!;

function emitStudyEvent(name: string, detail: Record<string, unknown> = {}): void {
  window.dispatchEvent(new CustomEvent(`dice-lab:${name}`, { detail }));
}

function noteInteraction(control: string): void {
  emitStudyEvent("interaction", { control });
}

/**
 * What is in the tray, how it will be thrown, and what it last showed.
 *
 * Seeded from the clock, as the app seeds it from the map's seed: a session that always opened on
 * the same first roll would be a session where the first thing a tester saw was not a roll.
 */
let tray: DiceTray = emptyTray(Date.now());
type RuntimeInterfaceId = "A" | "B" | "C";
let activeInterface: RuntimeInterfaceId = "A";

function setActiveInterface(interfaceId: unknown): void {
  if (interfaceId !== "A" && interfaceId !== "B" && interfaceId !== "C") return;
  activeInterface = interfaceId;
  dicePanelEl.dataset.interface = interfaceId;
  if (interfaceId === "B") {
    railCharacter.textContent = "Use the − and + controls beneath each die to change its count.";
  } else if (interfaceId === "C") {
    railCharacter.textContent = "The dice controls open as a horizontal toolbar from the bottom of the table.";
  } else {
    railCharacter.textContent =
      "The first modifier button selects positive or negative. The numbered buttons add their displayed amount.";
  }
  renderDicePanel();
}

/**
 * The dice panel, and the rail line under it.
 *
 * **Built once and then only re-marked.** Rebuilding the buttons on every render would drop focus
 * out of whichever one you had just clicked.
 */
function renderDicePanel(): void {
  if (diceTypeRow.childElementCount === 0) {
    // From `DICE` rather than typed into the markup: a list in the HTML is a list wired to
    // nothing, and this one has to agree with what engine/tray.ts will actually roll.
    diceTypeRow.replaceChildren(
      ...DICE.map((sides) => {
        const button = rowButton(`d${sides}`, () => {
          tray = addDie(tray, sides);
          renderDicePanel();
        });
        // Right-click takes one back off. Not a second button per die: fourteen controls in a
        // 232px panel would be a worse trade than an affordance that has to be discovered, and
        // Reset is always there for anyone who does not find it.
        button.title = `Add a d${sides}. Right-click to take one back.`;
        button.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          noteInteraction(`remove-d${sides}`);
          tray = removeDie(tray, sides);
          renderDicePanel();
        });
        return button;
      }),
    );
    diceStepperGrid.replaceChildren(
      ...DICE.map((sides) => {
        const card = document.createElement("div");
        card.className = "dice-stepper-card";

        const heading = document.createElement("span");
        heading.className = "dice-stepper-heading";
        const name = document.createElement("strong");
        name.textContent = `d${sides}`;
        const count = document.createElement("output");
        count.className = "dice-stepper-count";
        count.setAttribute("aria-label", `d${sides} count`);
        heading.appendChild(name);
        heading.appendChild(count);

        const controls = document.createElement("div");
        controls.className = "dice-stepper-controls";
        const remove = rowButton("−", () => {
          tray = removeDie(tray, sides);
          renderDicePanel();
        }, `remove-d${sides}`);
        remove.setAttribute("aria-label", `Remove one d${sides}`);
        const add = rowButton("+", () => {
          tray = addDie(tray, sides);
          renderDicePanel();
        }, `add-d${sides}`);
        add.setAttribute("aria-label", `Add one d${sides}`);
        controls.appendChild(remove);
        controls.appendChild(add);
        card.appendChild(heading);
        card.appendChild(controls);
        return card;
      }),
    );
    diceModeRow.replaceChildren(
      ...(
        [
          ["Disadvantage", "disadvantage"],
          ["Flat", "flat"],
          ["Advantage", "advantage"],
        ] as const
      ).map(([label, mode]) =>
        rowButton(label, () => {
          tray = { ...tray, mode };
          renderDicePanel();
        }),
      ),
    );
    diceModifierRow.replaceChildren(
      rowButton("+", () => {
        tray = toggleModifierSign(tray);
        renderDicePanel();
      }),
      ...MODIFIER_STEPS.map((step) =>
        rowButton(`+${step}`, () => {
          tray = addModifier(tray, step);
          renderDicePanel();
        }),
      ),
    );
    diceSizeRow.replaceChildren(
      ...DICE_SIZES.map((size) =>
        rowButton(sizeLabel(size), () => {
          tray = { ...tray, size };
          renderDicePanel();
          showSize();
        }),
      ),
    );
  }

  const usesSteppers = activeInterface === "B";
  diceTypeBlock.hidden = usesSteppers;
  diceStepperBlock.hidden = !usesSteppers;
  diceModifierBlock.hidden = false;

  const buttons = Array.from(diceTypeRow.querySelectorAll("button"));
  DICE.forEach((sides, i) => {
    const count = tray.picks[sides] ?? 0;
    const button = buttons[i]!;
    // The count on the face of the button rather than in a badge beside it: the rail is narrow and
    // "d6 ×3" is as readable as anything a badge would manage in twenty pixels.
    button.textContent = count > 0 ? `d${sides} ×${count}` : `d${sides}`;
    button.classList.toggle("active", count > 0);

    const stepper = diceStepperGrid.children[i] as HTMLElement;
    stepper.classList.toggle("active", count > 0);
    const output = stepper.querySelector<HTMLOutputElement>(".dice-stepper-count")!;
    output.value = String(count);
    const [remove, add] = Array.from(stepper.querySelectorAll<HTMLButtonElement>("button"));
    remove!.disabled = count <= 0;
    add!.disabled = count >= 100;
  });

  // **Greyed rather than hidden**: a control that vanishes leaves you wondering whether Advantage
  // exists here at all; one that is dim says "yes, and this is not a roll it applies to".
  const advantage = allowsAdvantage(tray.picks);
  diceModeBlock.classList.toggle("is-off", !advantage);
  Array.from(diceModeRow.querySelectorAll("button")).forEach((button, i) => {
    const mode = ["disadvantage", "flat", "advantage"][i] as DiceTray["mode"];
    button.disabled = !modeAvailable(tray.picks, mode);
    button.classList.toggle("active", mode === tray.mode);
  });

  const modifierButtons = Array.from(diceModifierRow.querySelectorAll("button"));
  const signButton = modifierButtons[0]!;
  signButton.textContent = tray.modifierNegative ? "−" : "+";
  signButton.classList.toggle("active", tray.modifierNegative);
  signButton.setAttribute("aria-pressed", tray.modifierNegative ? "true" : "false");
  signButton.title = tray.modifierNegative ? "Change the modifier to positive" : "Change the modifier to negative";
  signButton.setAttribute("aria-label", signButton.title);
  MODIFIER_STEPS.forEach((step, i) => {
    const button = modifierButtons[i + 1]!;
    button.textContent = `${tray.modifierNegative ? "−" : "+"}${step}`;
    button.title = `Add ${step} to the modifier magnitude`;
    button.classList.toggle("active", modifierStepSelected(tray, step));
  });
  diceModifierValue.textContent = `Current modifier ${modifierLabel(tray)}`;

  Array.from(diceSizeRow.querySelectorAll("button")).forEach((button, i) => {
    button.classList.toggle("active", DICE_SIZES[i] === tray.size);
  });

  diceSoundButton.setAttribute("aria-pressed", tray.muted ? "false" : "true");
  diceSoundButton.title = tray.muted ? "Sound off" : "Sound on";
  diceRollButton.disabled = trayTotal(tray.picks) === 0 || Boolean(pendingRoll);
  renderDiceSection();
}

/** One button in a dice row. */
function rowButton(label: string, onClick: () => void, control = label): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    noteInteraction(control);
    onClick();
  });
  return button;
}

/** The rail's line, which is what is left once the panel is dismissed. */
function renderDiceSection(): void {
  const rolling = Boolean(pendingRoll);
  const line = rolling ? "Rolling…" : trayLine(tray.last);
  dicePanelLine.textContent = line;
  diceResultEl.textContent = line;
  dicePanelLine.setAttribute("aria-busy", rolling ? "true" : "false");
  diceResultEl.setAttribute("aria-busy", rolling ? "true" : "false");
}

/**
 * Whether the tray is on screen.
 *
 * The app gated this on there being a map to throw dice over. There is nothing here but the tray,
 * so all that is left is the switch itself.
 */
function syncDicePanel(): void {
  dicePanelEl.hidden = !tray.open;
  if (!tray.open) closeDiceSettings(false);
  // The tray is centred in whatever the panel leaves it, so closing the panel with its × while
  // dice are still on the felt should hand that room back rather than leave the tray sitting off
  // to one side of an empty gutter. Only while it is up: a hidden wrapper measures zero.
  if (!diceStageEl.hidden) showTray();
}

let diceSettingsReturnFocus: HTMLElement | null = null;

function openDiceSettings(): void {
  if (!diceSettingsLayer.hidden) return;
  diceSettingsReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : diceSettingsButton;
  diceSettingsLayer.hidden = false;
  diceSettingsButton.setAttribute("aria-expanded", "true");
  diceSettingsModal.focus();
}

function closeDiceSettings(restoreFocus = true): void {
  if (diceSettingsLayer.hidden) return;
  diceSettingsLayer.hidden = true;
  diceSettingsButton.setAttribute("aria-expanded", "false");
  if (restoreFocus && !dicePanelEl.hidden && diceSettingsReturnFocus?.isConnected) diceSettingsReturnFocus.focus();
  diceSettingsReturnFocus = null;
}

function announcePanelVisibility(): void {
  emitStudyEvent("panel-visibility", { open: tray.open });
}

/**
 * The roll that has already happened, while its dice are still tumbling.
 *
 * **The number is decided the moment Roll is clicked**, before the dice leave anybody's hand, and
 * nothing about the animation can reach it — the same rule engine/dice.ts opens with. It stays out
 * of `tray.last` until the dice settle, so the panel does not print a total for dice that are still
 * moving.
 */
let pendingRoll: TrayRoll | undefined;

function hideRollResultToast(): void {
  rollResultToast.hidden = true;
}

function showRollResultToast(roll: TrayRoll): void {
  rollResultToast.hidden = false;
  rollResultToastText.textContent = trayLine(roll);
}

/**
 * Click: roll it now, then throw dice that already know what they are going to say.
 *
 * The click is also the gesture the sound needs to wake up in — a browser will not start an audio
 * context outside one — which `DiceStage.throwDice` does before anything else.
 */
function rollDice(): void {
  if (trayTotal(tray.picks) === 0 || pendingRoll) return;
  const seed = rerollSeed(tray.seed);
  const modifier = tray.modifier;
  const roll = rollTray(tray.picks, seed, { modifier, mode: tray.mode });
  pendingRoll = roll;
  tray = { ...tray, seed };
  hideRollResultToast();
  renderDicePanel();
  noteInteraction("roll");
  emitStudyEvent("roll-initiated", {
    picks: { ...tray.picks },
    mode: tray.mode,
    modifier,
  });
  showTray();
  // The first throw waits on the tray models, so the stage is not busy yet when this returns.
  // Watching only once the throw has actually started keeps the result from appearing early. A throw
  // that fails to start still settles the roll, so the button can never stay stuck on "Rolling…".
  const generation = ++animationGeneration;
  void diceStage()
    .throwDice(roll.dice, seed, tray.size)
    .catch(() => undefined)
    .then(() => watchAnimationCompletion(generation));
}

let animationGeneration = 0;

function watchAnimationCompletion(generation: number): void {
  const frame = () => {
    if (generation !== animationGeneration) return;
    if (diceStage().busy) {
      requestAnimationFrame(frame);
      return;
    }
    const completedRoll = pendingRoll;
    if (completedRoll) {
      pendingRoll = undefined;
      tray = { ...tray, last: completedRoll };
      renderDicePanel();
      showRollResultToast(completedRoll);
    }
    emitStudyEvent("animation-completed");
  };
  requestAnimationFrame(frame);
}

/**
 * Abandon a roll in flight — the panel keeps saying whatever it said before.
 *
 * **The felt is swept as well as the intent dropped.** `clear` stops the throw, and it is safe when
 * nothing was rolling: sweeping an empty tray is what Clear dice does anyway.
 */
function abandonRoll(): void {
  animationGeneration += 1;
  const wasRolling = Boolean(pendingRoll);
  pendingRoll = undefined;
  diceStageFx?.clear();
  hideRollResultToast();
  if (wasRolling) renderDicePanel();
}

/** A handful thrown only to show off a size, when there is no real roll to re-throw. */
const SAMPLE_PICKS = { 20: 1, 6: 2 } as const;
const SAMPLE_SEED = 606;

/**
 * Show what the chosen size looks like.
 *
 * **The roll cannot change, and that is the point.** With dice on the felt they are thrown again
 * from *their own seed*, so `rollTray` gives back the same faces and the same total — only the size
 * and the bounce differ. A setting that could quietly turn a 17 into a 4 would be the one thing
 * this whole feature is arranged to make impossible.
 *
 * With nothing thrown yet, a sample handful goes in instead so the choice is not invisible. It
 * deliberately does **not** write `tray.last`, so the panel keeps saying nothing was thrown and no
 * total appears next to dice that were never rolled.
 */
function showSize(): void {
  showTray();
  if (tray.last) void diceStage().throwDice(tray.last.dice, tray.seed, tray.size);
  else void diceStage().throwDice(rollTray(SAMPLE_PICKS, SAMPLE_SEED).dice, SAMPLE_SEED, tray.size);
}

/**
 * The tray, built the first time somebody rolls.
 *
 * Lazily: it is a WebGL context and a 1.5 MB pair of models, and a session that never rolls should
 * pay for neither.
 */
let diceStageFx: DiceStage | undefined;

function diceStage(): DiceStage {
  if (!diceStageFx) {
    diceStageFx = new DiceStage(diceStageCanvas, DICE_TRAY_URL, { cupUrl: DICE_CUP_URL });
    // The stage is built on the first roll, by which point the setting may already have been
    // changed — the panel is usable before anything has been thrown.
    diceStageFx.muted = tray.muted;
  }
  return diceStageFx;
}

/**
 * The room the Roll Dice panel needs on the right, in CSS pixels.
 *
 * The panel is fixed to the window's right edge and sits above the tray, so a tray centred in the
 * whole area would simply be drawn over. Reserved rather than overlapped: the wrapper is padded by
 * this much, so the flex centring lands in the space that is actually free. Zero when the panel is
 * closed, which it can be while dice are still on the felt.
 */
function trayGutter(): number {
  if (dicePanelEl.hidden || activeInterface === "C") return 0;
  const breathingRoom = activeInterface === "B" ? 72 : 32;
  return Math.ceil(dicePanelEl.getBoundingClientRect().width) + breathingRoom;
}

function trayBottomGutter(): number {
  return dicePanelEl.hidden || activeInterface !== "C" ? 0 : Math.ceil(dicePanelEl.getBoundingClientRect().height) + 32;
}

/**
 * How wide the tray is drawn, in CSS pixels.
 *
 * A share of the shorter side of the space it has, so it scales with the window, clamped so it is
 * neither a postage stamp on a laptop nor absurd on a large monitor.
 */
function trayPixels(rightGutter: number, bottomGutter: number): number {
  const rect = diceStageEl.getBoundingClientRect();
  const free = Math.min(Math.max(0, rect.width - rightGutter), Math.max(0, rect.height - bottomGutter));
  return Math.round(Math.max(320, Math.min(720, free * 0.8)));
}

/** Put the tray up and size it to the window it is standing in. */
function showTray(): void {
  diceStageEl.hidden = false;
  // After un-hiding, because a `display: none` wrapper measures zero.
  const gutter = trayGutter();
  const bottomGutter = trayBottomGutter();
  diceStageEl.style.setProperty("--tray-gutter", `${gutter}px`);
  diceStageEl.style.setProperty("--tray-bottom-gutter", `${bottomGutter}px`);
  const size = trayPixels(gutter, bottomGutter);
  diceStageCanvas.style.width = `${size}px`;
  diceStageCanvas.style.height = `${size}px`;
  diceStage().resize(size);
}

/** Sweep the felt and put the tray away. Both the button and a click on the tray come here. */
function clearTray(): void {
  abandonRoll();
  diceStageFx?.clear();
  diceStageEl.hidden = true;
}

diceOpenButton.addEventListener("click", () => {
  noteInteraction("open");
  tray = { ...tray, open: true };
  renderDicePanel();
  syncDicePanel();
  announcePanelVisibility();
});
diceCloseButton.addEventListener("click", () => {
  noteInteraction("close");
  tray = { ...tray, open: false };
  syncDicePanel();
  announcePanelVisibility();
});
diceSettingsButton.addEventListener("click", () => {
  noteInteraction("open-dice-settings");
  openDiceSettings();
});
diceSettingsClose.addEventListener("click", () => {
  noteInteraction("close-dice-settings");
  closeDiceSettings();
});
diceSettingsLayer.addEventListener("click", (event) => {
  if (event.target !== diceSettingsLayer) return;
  noteInteraction("close-dice-settings");
  closeDiceSettings();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || diceSettingsLayer.hidden) return;
  event.preventDefault();
  noteInteraction("close-dice-settings");
  closeDiceSettings();
});
diceResetButton.addEventListener("click", () => {
  noteInteraction("reset");
  tray = resetTray(tray);
  renderDicePanel();
});
// **One click rolls.** A button's click already covers mouse, touch, Enter and Space, and a second
// click while the dice are still moving is ignored by `rollDice` itself.
diceRollButton.addEventListener("click", rollDice);
// **The setting is written whether or not the stage exists yet**, because the panel opens long
// before anything has been rolled and the stage is built lazily on the first one. `diceStage()`
// reads it back on the way up rather than this reaching in to create a WebGL context for a mute.
diceSoundButton.addEventListener("click", () => {
  noteInteraction("sound");
  tray = { ...tray, muted: !tray.muted };
  if (diceStageFx) diceStageFx.muted = tray.muted;
  renderDicePanel();
});
// The dice off the felt, not the tray you are about to throw. What the panel says stays: the roll
// happened, and sweeping the table does not un-happen it.
diceClearButton.addEventListener("click", () => {
  noteInteraction("clear");
  clearTray();
});
rollResultToastClose.addEventListener("click", () => {
  noteInteraction("dismiss-roll-result");
  hideRollResultToast();
});
// **And a click anywhere on the overlay does the same** — the felt, or the dimmed area around it.
// One listener on the wrapper rather than one on the canvas, because the canvas click bubbles to it
// anyway, and because the dimmed area is the larger target: a modal overlay that could only be
// dismissed from a panel would be one you can get stuck behind. The button stays for anyone who
// reaches for it instead.
diceStageEl.addEventListener("click", () => {
  noteInteraction("stage-clear");
  clearTray();
});

window.addEventListener("dice-lab:set-interface", (event) => {
  const detail = (event as CustomEvent<{ interfaceId?: unknown }>).detail;
  setActiveInterface(detail?.interfaceId);
});

window.addEventListener("dice-lab:prepare-task", (event) => {
  const detail = (event as CustomEvent<Partial<Pick<DiceTray, "picks" | "mode" | "modifier" | "open">> & { interfaceId?: unknown }>).detail ?? {};
  setActiveInterface(detail.interfaceId);
  abandonRoll();
  const picks = detail.picks ?? {};
  tray = {
    ...tray,
    picks: { ...picks },
    mode: detail.mode ?? "flat",
    modifier: detail.modifier ?? 0,
    modifierNegative: (detail.modifier ?? 0) < 0,
    last: undefined,
    open: detail.open ?? false,
  };
  diceStageEl.hidden = true;
  renderDicePanel();
  syncDicePanel();
  announcePanelVisibility();
});

window.addEventListener("dice-lab:open-panel", () => {
  noteInteraction("open");
  tray = { ...tray, open: true };
  renderDicePanel();
  syncDicePanel();
  announcePanelVisibility();
});

// A hidden wrapper measures zero, so only while it is up.
window.addEventListener("resize", () => {
  if (!diceStageEl.hidden) showTray();
});

renderDicePanel();
setActiveInterface("A");
emitStudyEvent("interface-ready");
