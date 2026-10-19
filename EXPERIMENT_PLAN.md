# Dice Interface Lab — Experiment Plan

This document is the decision contract for the study. Change it before recruiting participants,
not after looking at results.

## Decision this study supports

Choose the control architecture for a virtual-tabletop dice roller. The winning interface must help
players construct the intended roll quickly and confidently without increasing mistakes or breaking
attention away from the game.

## Jobs to Be Done

**Struggling moment:** combat or a skill check interrupts play and a player has to translate an
in-game intent into the correct dice, mode, and modifier.

- **Functional job:** construct and initiate the correct roll with minimal effort.
- **Emotional job:** feel confident that the roll is correct and fair.
- **Social job:** keep the table moving and appear fluent rather than holding up the session.

The hidden alternatives are physical dice, typed dice notation, a macro, asking the game master to
roll, and avoiding optional modifiers because the interface is too slow.

## Falsifiable hypothesis

If the control architecture changes, at least one alternative interface will reduce median
time-to-first-valid-roll by at least 15% relative to Interface A, because it lowers either the number
of interactions or the amount of dice-notation knowledge required.

An alternative is not a winner if task completion falls by more than 5 percentage points or invalid
attempts materially increase. The 15% threshold is the initial minimum meaningful effect; revise it,
if needed, before recruitment begins.

## Study design

- Between subjects: each participant tests one randomly assigned interface.
- Balance assignment across Interface A, B, and C, then randomize among the least represented options.
- Treat the browser-local completed session as the visitor's single test; an anonymous study cannot
  guarantee uniqueness across different browsers or devices without adding identity collection.
- Use neutral participant-facing names: Interface A, B, and C. Descriptive names remain internal.
- Interface A is the additive click tray, Interface B uses explicit per-die steppers, and Interface
  C arranges the original controls in a horizontal bottom toolbar.
- Give one unscored practice task before scored tasks begin.
- Run three scored tasks for the assigned interface: compound roll, advantage roll, and repeat/recovery action.
- Give every interface the same task pack so comparisons remain equivalent across participants.
- Set the target participant count and end condition before launch. Do not stop early because one
  interface appears to be winning.

## Controlled conditions

Hold these constant across interfaces:

- Task wording and difficulty
- 3D dice scene, models, camera, materials, animation duration, and sound
- Result presentation and roll history
- Roboto typography and sentence-case labels
- Available numeric modifier range and starting value
- Practice instructions and help availability
- Device requirements and viewport guidance

Do not preselect dice, modes, or modifiers unless the same default is deliberately tested in every
interface. Do not expose variant-specific hints during scored tasks. Choice architecture is itself a
causal variable and must not leak into unrelated differences.

## Timing contract

The primary timer starts when the task instruction and a ready interface are both visible. It ends
when the participant initiates the correct roll. The 3D animation is excluded because device and
rendering performance are not the interaction being compared.

Record animation completion separately as a technical diagnostic. Pause or discard a trial when the
interface or 3D assets were not ready when timing began.

## Metrics and decision protocol

Keep the dashboard to metrics that change a decision:

| Metric | Type | Initial threshold | Action |
| --- | --- | --- | --- |
| Median time to first valid roll | Primary outcome | 15% faster than A | Consider as winner if guardrails hold |
| Task completion | Guardrail | Below 90% | Diagnose blocking interaction before comparison |
| Invalid attempts | Leading friction | More than 0.5 per task | Review controls and error recovery |
| Help use | Leading friction | More than 25% of trials | Instructions or discoverability need revision |
| Confidence rating | Outcome guardrail | Median below 4/5 | Do not recommend despite speed |
| Order effect | Reliability | Later positions over 15% faster overall | Treat learning as a confound and analyze by position |
| Technical failure rate | Reliability | Above 2% | Pause the study and fix instrumentation or rendering |

For a small classroom sample, report effect sizes, within-participant differences, and uncertainty.
Do not label a directional result statistically conclusive without an appropriate sample-size plan.

## Minimum event contract

Collect only the events needed to reproduce the metrics:

- `interface_ready`
- `task_presented`
- `first_interaction`
- `invalid_roll`
- `valid_roll_initiated`
- `animation_completed`
- `help_opened`
- `trial_rating_submitted`
- `viewport_resized`
- `study_completed`

Each event needs an anonymous participant id, assigned sequence, interface, position, task pack,
task id, timestamp, and current CSS viewport dimensions. The session context also records screen
dimensions and device pixel ratio. Resize events retain both the previous and resulting viewport.
Do not collect names or email addresses.

## Behavior-first research prompts

Avoid asking only whether participants liked an interface. Use prompts that reconstruct behavior:

- “What did you expect to happen before your first action?”
- “Where did you hesitate or change course?”
- “What almost made you give up on this roll?”
- “Tell us about the last time rolling dice in a VTT slowed down the game.”
- “Which interface would you choose for that situation, and what would you use instead?”

After the study, write an Insight Brief that separates stated preference from observed performance,
calls out contradictions, and names the product decision each pattern supports.

## Reliability checklist

Before interpreting results, check:

- **Sample bias:** Were participants representative of the intended VTT experience range?
- **Measurement artifacts:** Did loading, resizing, tracking, or browser behavior distort timing?
- **Confounders:** Did task difficulty, device type, help, or test order change with the interface?

Capture VTT frequency, dice-notation familiarity, input method, CSS viewport, screen dimensions,
and device pixel ratio as analysis segments, not as personally identifying information.

## AI execution boundary

- **Automate:** balanced assignment, event validation, metric calculation, and dashboard aggregation.
- **Augment:** task-pack drafting, anomaly summaries, and qualitative theme suggestions with human review.
- **Human-only:** hypotheses, participant treatment, interpretation of contradictions, and the final product decision.

## Next build acceptance criteria

The current development slice can create an anonymous session, assign and retain a balanced
sequence, advance through practice, scored tasks, and ratings for Interfaces A–C, record the
minimum event contract in D1, and resume safely after an accidental refresh. Interface A remains
the reference implementation.
