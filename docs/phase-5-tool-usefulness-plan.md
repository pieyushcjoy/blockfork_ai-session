# Phase 5 Tool Usefulness, Task Truth, and Agent Progress Reporting Plan

Date: 2026-05-16
Status: design-only

This document defines the next BlockFork product phase after the Persistent Execution Layer through Batch 6.

Phase 4 established durable execution truth. Phase 5 asks a different question:

- did the agent actually accomplish the user's task correctly?
- can BlockFork prove that claim with evidence?
- can BlockFork do that repeatedly on tool-heavy workflows without overstating success?
- can the agent keep progressing and communicate meaningful updates without the user having to chase it?

This plan is grounded in the current repository truth. It does not authorize implementation by itself.

## Scope anchors

This plan builds on the contracts and runtime primitives already present in the repo:

- durable execution identity and transition recording
- `recovery_required` semantics for ambiguous interruption
- workspace and artifact boundary enforcement
- artifact verification states and evidence checks
- execution capability facts
- execution budget facts
- context pressure and continuity tracking
- continuity recommendations

It also acknowledges one explicit current gap:

- there is no durable task-level truth model above execution rows yet
- there is no benchmark layer that measures usefulness end to end
- there is no formal task progress reporting contract
- there is no formal human-input escalation contract
- there is no truthful completion contract for tool-heavy work

## 1. Current capability baseline

BlockFork already has several foundations that partially enable tool usefulness.

### What Batch 1-6 already enable

#### Durable execution core

The runtime now owns durable execution identity and lifecycle state:

- `executions` stores a stable execution record
- `execution_events` stores append-only transition history
- request logs are correlated to execution rows
- `recovery_required` exists for ambiguous interruption

This means BlockFork can already answer:

- what execution ran
- what state it entered
- whether the execution was interrupted or recovered
- which request produced which runtime event

That is necessary for usefulness, but not sufficient.

#### Transition legality and recovery semantics

Execution state changes are constrained by the canonical transition model, and ambiguous interruption is not silently treated as success.

This matters for usefulness because tool-heavy work often fails in the middle of a workflow. The runtime can already distinguish:

- safe retry
- ambiguous interruption
- terminal failure
- recovery-required states

That gives Phase 5 a reliable attempt ledger instead of a vague success/failure log.

#### Workspace and artifact boundary enforcement

The runtime already has execution-linked workspace and artifact contracts:

- `workspaces`
- `execution_artifacts`
- workspace-relative evidence checks
- artifact verification states

This is the strongest current foundation for usefulness, because tool-heavy work usually creates a file, report, page, or change on disk. BlockFork can already require evidence rather than trusting the model's claim.

#### Capability and budget observability

The runtime records normalized provider/model capability facts and budget facts:

- resolved provider and model
- context window and max output
- retryability and timeout profile
- requested vs accepted budget
- context adaptation reason
- budget rejection reason

This means BlockFork can already explain some tool failures as:

- context too large
- output budget too small
- provider fit mismatch
- fallback posture change

That is important because usefulness depends on why a workflow failed, not just that it failed.

#### Context pressure and continuity tracking

The runtime now records:

- session pressure state
- continuity events
- continuity recommendations
- session lineage

This partially supports long-horizon usefulness by capturing when the session is under pressure and when the runtime recommends rollover, reset, or review.

#### Continuity recommendations

The runtime can persist durable recommendations such as:

- `monitor_pressure`
- `recommend_rollover`
- `recommend_compaction_candidate`
- `require_manual_reset`
- `recovery_review_required`

That is useful because a useful agent must know when it should stop pretending it can safely continue.

### What these batches do not yet provide

Even with all of the above, BlockFork still cannot fully answer:

- did the agent actually finish the user task
- did the generated artifact satisfy the request, not just exist
- did the agent truthfully report partial success
- did the workflow complete for the right reason
- did the tool sequence itself succeed end to end
- did the agent communicate progress without being chased

That missing layer is the Phase 5 problem.

## 2. Define Tool Usefulness precisely

### Phase 5 definition

Tool usefulness is the ability of a BlockFork-managed agent to:

- complete real tasks using tools
- produce the correct artifact or operational outcome
- report status truthfully
- distinguish partial success from full success
- recover or escalate safely when tool steps fail
- remain useful across long multi-step workflows
- continue progressing autonomously after acceptance
- proactively report meaningful milestones without noisy chatter
- interrupt the user only when a real decision or input is required

### Product thesis

Phase 5 is about making BlockFork-managed agents not merely executable, but trustworthy in tool-heavy work:

- they should do the work
- they should prove the work
- they should say exactly what was and was not proven
- they should update the user like a real worker, not a passive chatbot

Phase 4 proved execution truth.
Phase 5 proves task success truth and makes agents communicate like actual workers, not passive chatbots.

## 3. The missing layer

Persistent execution currently answers:

- what happened at the runtime and execution level?

Phase 5 must answer:

- did the agent actually accomplish the user's task correctly?

### Repo truth gap analysis

The current repo shows a clear gap between execution truth and task success truth.

#### What exists today

- execution rows
- transition events
- pressure snapshots
- artifact evidence
- capability facts
- budget facts
- continuity recommendations

#### What is missing today

- no durable task object above execution
- no task completion contract
- no task outcome truth model
- no standardized notion of partial success vs complete success
- no benchmark harness that measures usefulness across real workflows
- no structured way to persist "the work was attempted, partially completed, verified, or not verified"
- no durable progress reporting contract tied to task truth
- no formal human-input escalation contract

### Why this matters

An execution can complete while the user task is still only partly satisfied.

Examples:

- the model created a file, but not the right one
- the agent claims success, but the artifact was never verified
- the workflow was interrupted after partial output
- the tool step ran, but the result did not match the brief
- the agent has useful momentum, but the user should not have to ask for updates

Phase 5 exists to close that semantic gap without confusing execution success with task success.

## 4. Recommended Phase 5 batch roadmap

The cleanest roadmap is to start with measurement, then add task truth, then harden artifact confidence, failure taxonomy, progress reporting, completion truth, and long-horizon reliability.

### Batch 5.1 - Tool Usefulness Benchmark Harness

#### Problem solved

BlockFork needs a repeatable way to measure whether agents are actually useful on tool-heavy tasks.

#### Scope

- benchmark fixtures
- repeatable runner over real workflows
- prompt templates and expected result definitions
- scoring capture for outputs, artifacts, progress updates, and verification
- failure and partial-success recording
- lightweight recorded-run scorer

#### What must be added

- benchmark task definitions
- reproducible execution harness
- result capture and scoring storage
- checkpoint visibility for progress reporting evaluation
- a CLI scorer for recorded benchmark runs

#### Reuse existing primitives

- execution identity
- execution events
- artifact verification
- budget and capability facts
- continuity events where workflows hit pressure

#### What not to build yet

- no new public API
- no full task database
- no auto-repair logic
- no memory plane

#### Expected verification / gate outcome

- benchmark tasks run reproducibly
- outputs are scored consistently
- artifact truth can be compared across runs
- usefulness regressions become measurable
- progress reporting can be measured before the policy is hardened

### Batch 5.2 - Task Outcome Truth Layer

#### Problem solved

BlockFork needs a durable object that represents the user task or work item, not just the execution attempt.

#### Scope

- durable task-level state
- linkage from task to one or more executions
- task status history
- task-level completion and partial-completion states

#### What must be added

- task identity
- task state transitions
- task-to-execution association
- durable state surviving restart

#### Reuse existing primitives

- execution rows as attempts
- event ledger as state history
- session lineage where relevant
- continuity recommendations for task rollover/restart decisions

#### What not to build yet

- no sophisticated planner
- no autonomous task decomposition engine
- no generalized cross-agent orchestration

#### Expected verification / gate outcome

- one task can span multiple executions
- the runtime can say whether a task is done, partial, failed, or awaiting recovery
- task truth survives restart

### Batch 5.3 - Artifact Completion Confidence

#### Problem solved

Artifact existence alone is not enough. BlockFork needs a lightweight way to say whether an artifact is structurally plausible and likely satisfies the prompt.

#### Scope

- benchmark-specific artifact validators
- minimum structural checks for common artifact types
- distinction between:
  - artifact existed
  - artifact structurally valid
  - artifact likely satisfies intent

#### What must be added

- small validators per benchmark family
- evidence-to-state mapping for artifact creation and verification
- minimal content-shape checks

#### Reuse existing primitives

- `execution_artifacts`
- artifact evidence checks
- workspace boundary enforcement

#### What not to build yet

- no full semantic quality judge
- no open-ended rubric explosion
- no generalized content scoring system for every file type

#### Expected verification / gate outcome

- artifact claims are no longer binary only
- usefulness reporting can distinguish creation from adequacy
- benchmark outputs can be validated with simple rules

### Batch 5.4 - Tool Failure Classification

#### Problem solved

The runtime needs a shared vocabulary for tool-heavy failure modes.

#### Scope

- a small taxonomy of tool failure categories
- durable persistence of those categories
- mapping from runtime observations to those categories

#### What must be added

- failure category mapping
- durable failure reason storage
- benchmark-visible failure labels

#### Reuse existing primitives

- recovery classification
- budget reasons
- artifact rejection reasons
- continuity events

#### What not to build yet

- no giant ontology of all possible tool errors
- no provider-specific exception catalog

#### Expected verification / gate outcome

- failures are classified consistently
- partial success becomes visible
- reporting no longer collapses all tool problems into "failed"

### Batch 5.5 - Agent Progress Reporting & Human-Input Escalation

#### Problem solved

The agent needs to proactively report meaningful task progress and interrupt the user only when input is genuinely required.

#### Scope

- durable progress event vocabulary
- proactive user notification policy
- human-input escalation contract
- structured progress message shape
- mapping from task-state transitions to report-worthy milestones
- durable linkage between progress messages and task truth

#### What must be added

- progress categories and emission rules
- escalation rules
- message payload shape
- state-to-notification mapping
- quiet-period policy for non-reportable work

#### Reuse existing primitives

- task truth
- execution events
- artifact verification
- continuity recommendations
- recovery_required semantics
- budget and context pressure facts

#### What not to build yet

- no noisy heartbeat spam
- no every-tool-call notification stream
- no free-form progress layer detached from durable state
- no public API redesign

#### Expected verification / gate outcome

- progress messages are emitted only at meaningful checkpoints
- user input is requested only when it materially blocks progress
- no spammy update behavior
- progress statements match durable task state

### Batch 5.6 - Truthful Completion Contract

#### Problem solved

The agent needs a grounded completion summary that cannot overclaim success.

#### Scope

- required completion-summary shape
- truthful success / partial / incomplete fields
- proof references for created or modified artifacts
- explicit "not verified" and "follow-up needed" fields

#### What must be added

- final handoff summary contract
- end-state truth mapping
- durable proof references

#### Reuse existing primitives

- artifact verification
- execution truth
- task truth
- continuity recommendations where completion should not be claimed

#### What not to build yet

- no user-facing redesign of the whole response surface
- no new public completion API unless later proven necessary

#### Expected verification / gate outcome

- completion statements match durable truth
- the system can distinguish "I made it" from "I verified it"
- partial success is reported honestly
- final completion is proactively sent

### Batch 5.7 - Long-Horizon Tool Workflow Reliability

#### Problem solved

Tool-heavy conversations become fragile over time, especially when planning, prompting, artifact work, and progress reporting are interleaved.

#### Scope

- benchmark coverage for multi-step workflows
- failure-position tracking
- plan-to-execution handoff checks
- context-pressure failure segmentation
- progress continuity checks across longer tasks

#### What must be added

- long workflow benchmark cases
- segmented failure analysis
- context-pressure attribution

#### Reuse existing primitives

- context pressure tracking
- continuity recommendations
- recovery_required semantics
- execution event history
- progress reporting contract

#### What not to build yet

- no full memory/compaction subsystem
- no autonomous long-term planning architecture

#### Expected verification / gate outcome

- we can measure where usefulness collapses
- failures can be attributed to before/during/after artifact creation
- multi-step workflows become more predictable
- progress remains meaningful during long runs

### Why this order

This order is intentional:

1. measure usefulness first
2. define task truth second
3. improve artifact confidence third
4. classify failures fourth
5. add proactive progress reporting and escalation fifth
6. require truthful handoff sixth
7. harden long workflows last

That sequence avoids building a task model before we know how to score it, and avoids building a progress layer before there is durable truth beneath it.

## 5. Desired Phase 5 user journey

### Example workflow

User:

- "Create a premium landing page from this source page. Use it as inspiration, save the website files, and tell me exactly what you completed."

### Expected Phase 5 journey

#### 1. Acknowledge the task and set expectations

The agent should confirm the objective and indicate that it will proceed.

Example:

- "I’ll use the source page as inspiration, build the landing page, save the files, and report back with what was created and verified."

#### 2. Begin working autonomously

The agent should start tool work without waiting for another user prompt.

#### 3. Send a progress update after source analysis / plan lock

The agent should report that the source has been inspected and the implementation plan is locked.

Example:

- "I’ve analyzed the source page and locked the build plan. Next I’m creating the landing page files."

#### 4. Continue into artifact creation without waiting for the user

The agent should work through the artifact-building steps on its own.

#### 5. Send a progress update when the initial artifact is created and verification has started

The agent should say that the artifact exists and verification is underway.

Example:

- "The initial landing page artifact is in place. I’m now verifying the file structure and content coverage."

#### 6. Only pause if a genuine decision is needed

If the task reaches a point where the next step materially changes the output or introduces a real risk, the agent should ask the user.

#### 7. Send a final truthful completion report

The final report should include:

- created or modified files
- verified facts
- not-yet-verified facts
- caveats
- final task state

### Blocked-state journey

If the task cannot continue safely, the agent should say so clearly.

Example:

- "I’m blocked because I need your decision on whether to overwrite the existing page structure. I can continue safely once you choose preserve or replace."

The interruption should be triggered only by a material decision, such as:

- ambiguous goal that materially changes the output
- irreversible or externally impactful action
- missing mandatory input
- tradeoff or creative choice that blocks progress
- credential or access issue
- recovery path requires a human decision

The agent should not interrupt for minor styling choices, routine retries, or execution details it can reasonably decide itself.

This journey must demonstrate autonomous progress, proactive communication, truthfulness, and task-level state progression.

## 6. Benchmark task set

Phase 5 should use real tasks that match the work BlockFork-managed agents are expected to do.

### 1. Create a landing page from a short brief

- Prompt pattern:
  - "Create a landing page for X with sections A, B, C and save it in the workspace."
- Expected tool behavior:
  - inspect workspace
  - create or update page files
  - preserve requested structure
- Expected artifact/result:
  - landing page file or component set saved in the correct location
- Success:
  - artifact exists, is non-empty, and matches required structure
- Partial success:
  - page created but missing one requested section or polish pass
- Failure:
  - no artifact, wrong location, or claim without proof
- Progress evaluation:
  - task accepted
  - plan locked
  - artifact created
  - verification started
  - completion or blocked update sent truthfully

### 2. Create a landing page from a source URL or extracted page content

- Prompt pattern:
  - "Use this source page as inspiration and create a new site."
- Expected tool behavior:
  - extract source content
  - transform into a new page
  - avoid copying if the prompt requires a fresh result
- Expected artifact/result:
  - generated page structure grounded in the source
- Success:
  - source influence is visible and the artifact is created correctly
- Partial success:
  - extraction succeeds but synthesis is incomplete
- Failure:
  - ungrounded output, missing artifact, or overclaim
- Progress evaluation:
  - task accepted
  - source analysis milestone
  - artifact creation milestone
  - verification milestone or blocked update

### 3. Create or edit a Markdown brief

- Prompt pattern:
  - "Turn these notes into a clean Markdown brief with headings."
- Expected tool behavior:
  - write the file
  - preserve requested sections
  - update the existing artifact if one exists
- Expected artifact/result:
  - `.md` file with expected structure
- Success:
  - headings present, content coherent, file saved in workspace
- Partial success:
  - file updated but missing one requested section
- Failure:
  - no file, wrong file, or completion claim without verification
- Progress evaluation:
  - task accepted
  - draft created
  - revision complete or blocked

### 4. Inspect a repo and produce a grounded summary

- Prompt pattern:
  - "Inspect this repo and summarize how feature X works."
- Expected tool behavior:
  - inspect files
  - ground claims in source lines or filenames
  - avoid speculation
- Expected artifact/result:
  - summary with citations or file references
- Success:
  - summary is grounded and accurate
- Partial success:
  - summary is mostly right but omits key details
- Failure:
  - hallucinated behavior or unsupported claims
- Progress evaluation:
  - task accepted
  - inspection complete
  - summary draft ready

### 5. Generate a frontend section/component and save it correctly

- Prompt pattern:
  - "Build a hero section / card / form and save it in the right file."
- Expected tool behavior:
  - modify the correct component file
  - preserve project conventions
  - create a usable UI slice
- Expected artifact/result:
  - component file updated and renders correctly enough for the benchmark
- Success:
  - file saved, structure valid, minimal render behavior preserved
- Partial success:
  - visually plausible but missing required behavior or structure
- Failure:
  - wrong file, broken output, or no durable change
- Progress evaluation:
  - task accepted
  - component milestone reached
  - verification started

### 6. Revise a previously created artifact based on user feedback

- Prompt pattern:
  - "Keep the artifact, but revise it to address feedback A and B."
- Expected tool behavior:
  - edit the existing artifact rather than starting over
  - preserve useful prior work
- Expected artifact/result:
  - updated file with requested revisions
- Success:
  - revision is grounded in the prior artifact and feedback
- Partial success:
  - some feedback addressed, some missed
- Failure:
  - replacement that discards required work or unverified claims
- Progress evaluation:
  - task accepted
  - revision plan locked
  - update applied

### 7. Perform a multi-step research -> structure -> artifact task

- Prompt pattern:
  - "Research the repo, outline the result, then create the artifact."
- Expected tool behavior:
  - gather facts
  - create a structured plan
  - produce the artifact from that plan
- Expected artifact/result:
  - research-grounded output file or summary
- Success:
  - the structure and artifact both align with the discovered facts
- Partial success:
  - research is solid but artifact is incomplete
- Failure:
  - missing bridge between research and output
- Progress evaluation:
  - task accepted
  - research complete
  - structure locked
  - artifact started
  - verification started

### 8. Recover from a deliberate partial tool failure

- Prompt pattern:
  - "The first write failed; recover and finish safely."
- Expected tool behavior:
  - recognize the partial failure
  - avoid pretending success
  - resume or escalate appropriately
- Expected artifact/result:
  - final artifact or explicit recovery state
- Success:
  - recovery is truthful and the artifact state is sound
- Partial success:
  - recovery attempt is correct but completion remains incomplete
- Failure:
  - silent loss of work or false completion
- Progress evaluation:
  - blocked state reported truthfully
  - recovery path communicated
  - resume or final failure reported

### Progress-reporting evaluation for every benchmark

Every benchmark should also score:

- did the agent proactively notify at meaningful checkpoints?
- did it avoid unnecessary status spam?
- did it ask for user input only when genuinely needed?
- did final completion match durable truth?

## 7. Proposed evaluation rubric

Use a simple 0-2 scoring model per dimension.

### Recommended model

- `0` = fail
- `1` = partial
- `2` = pass

### Why this is the right model for Phase 5

This is better than a single pass/fail flag because Phase 5 needs to measure:

- partial success
- truthful status
- verification quality
- recovery quality
- progress reporting quality
- escalation quality

It is also simpler than a full numeric grading system, which would overfit too early.

### Suggested dimensions

- task completion accuracy
- tool invocation correctness
- artifact creation truth
- artifact verification status
- status honesty
- recovery behavior
- context stability
- user handoff quality
- progress reporting usefulness
- human-input escalation quality
- unnecessary verbosity or confusing claims

### Aggregate interpretation

- `18-22` total: strong useful execution
- `12-17` total: partial usefulness, needs hardening
- below `12`: unreliable or misleading tool behavior

The exact cutoffs can be tuned later, but the per-dimension 0-2 model should stay.

## 8. Task-level state model

### Is a new durable model needed?

Yes.

Execution truth alone is not enough to answer usefulness questions.

BlockFork needs a durable task-level model above executions so it can track:

- the user's objective
- attempts to satisfy that objective
- whether the objective is complete, partial, or failed
- whether completion is verified
- when the agent should report progress

### Cleanest naming

The cleanest option is `tasks`.

Why:

- `tasks` is the simplest objective-level noun
- `agent_tasks` over-indexes on the implementation style
- `tool_tasks` is too narrow and misses non-tool parts of the workflow

### Recommended relationship to executions

- one task can span multiple executions
- one execution belongs to one task attempt
- a task should persist across retries and recovery
- the execution ledger remains the attempt-level truth
- the task ledger becomes the objective-level truth
- progress messages should be driven by task state, not raw model chatter

### Recommended task states

- `received`
- `acknowledged`
- `planned`
- `in_progress`
- `tool_work_started`
- `artifact_created`
- `artifact_verified`
- `blocked_human_input_required`
- `partially_completed`
- `recovery_required`
- `failed`
- `completed`

### Should task state be durable in SQLite?

Yes.

Phase 5 is about persistent usefulness, not in-memory convenience. If task state is not durable, the runtime cannot reliably measure or explain long-horizon usefulness.

### Which states can trigger progress notifications?

Report-worthy transitions should include:

- `received` -> `acknowledged`
- `acknowledged` -> `planned`
- `planned` -> `tool_work_started`
- `tool_work_started` -> `artifact_created`
- `artifact_created` -> `artifact_verified`
- `tool_work_started` -> `partially_completed`
- `tool_work_started` -> `blocked_human_input_required`
- `tool_work_started` -> `recovery_required`
- `recovery_required` -> `in_progress` or `failed`
- `in_progress` -> `completed`

Not every transition should notify the user. Only meaningful milestone transitions should.

## 9. Tool failure taxonomy

The taxonomy should be small enough to use and rich enough to explain the main failure shapes.

| Category | Meaning | Directly observable today? | Persist in Phase 5? |
| --- | --- | --- | --- |
| `tool_not_invoked` | The task required a tool step, but no tool was ever attempted | Partially, via missing tool activity or absent artifact evidence | Yes |
| `tool_invocation_failed` | The tool call or command could not start or was rejected | Yes, in many runtime failure paths | Yes |
| `tool_output_invalid` | The tool ran, but output was malformed or unusable | Sometimes, depending on validation | Yes |
| `artifact_missing` | The expected artifact was never created | Yes, via artifact evidence checks | Yes |
| `artifact_partial` | The artifact exists but is incomplete or only partly satisfies the task | Partially, via artifact verification plus benchmark checks | Yes |
| `execution_interrupted` | The runtime stopped mid-task or lost active ownership | Yes, via execution states and recovery_required | Yes |
| `context_collapsed` | The conversation or execution context became unusable for continuation | Partially, via pressure and continuity data | Yes |
| `status_claim_unverified` | The agent claimed success without durable proof | Yes, via artifact honesty guardrails | Yes |
| `user_confirmation_waiting` | The task is intentionally paused for user input | Yes, via workflow state or prompt context | Yes |
| `blocked_for_input` | Progress cannot safely continue until the user makes a decision or provides missing input | Partially, via task state and escalation events | Yes |
| `recovery_blocked` | Recovery exists but cannot proceed without human input or external resolution | Partially, via `recovery_required` classification | Yes |

### Notes

- Keep the taxonomy focused on usefulness, not on every provider exception.
- Failure categories should explain the benchmark result and the handoff quality.
- The taxonomy should support both task-level state and benchmark scoring.

## 10. Artifact usefulness layer

Current artifact verification is necessary but not sufficient.

### What current verification gives us

The runtime already distinguishes:

- artifact evidence present
- artifact evidence missing
- artifact verification rejected

That is a strong truth boundary.

### What Phase 5 should add

Phase 5 should extend artifact truth with lightweight usefulness checks:

- artifact existed
- artifact structurally valid
- artifact likely satisfies prompt intent

### How artifact state interacts with progress

- `artifact_created` progress should only be sent when there is durable evidence that creation happened
- `artifact_verified` progress should only be sent when the verification state supports it
- progress messages about artifacts should distinguish creation from verification
- the final completion message must not claim artifact success before the task/artifact truth layer supports it

### What to validate

#### Website or HTML-like artifacts

Possible minimal checks:

- file exists
- file is non-empty
- expected entry file is present
- required sections or landmarks exist
- file is internally consistent enough to be inspectable

#### Markdown artifacts

Possible minimal checks:

- file exists
- file is non-empty
- required headings appear
- requested sections are present
- content is not just placeholder text

### Should benchmark-specific validators exist?

Yes.

That is the right level of specificity for Phase 5 because it keeps semantic evaluation grounded in task shape, not in generic quality vibes.

### What not to do yet

Do not build a universal semantic judge for all artifact types.

Phase 5 should stay lightweight and benchmark-driven until there is evidence that broader semantic evaluation is worth the cost.

## 11. Truthful completion contract

A BlockFork-managed agent should report completion in a way that matches durable truth.

### Recommended completion summary shape

- what I completed
- what artifacts or files were created or modified
- what was verified
- what was not verified
- what failed or remains incomplete
- whether human follow-up is needed
- final task state

### Behavioral rule

The agent should not say "done" unless the summary can be backed by durable evidence.

The agent should proactively send the completion report when the task completes; the user should not have to ask "done?" or "what happened?"

### Where this belongs

This contract should be layered across multiple surfaces:

- runtime contracts
  - so the system knows what fields must exist
- prompt and instruction templates
  - so agents learn to speak truthfully
- operator/dev docs
  - so humans can interpret results and audit failures

It should not live in only one layer.

## 12. Long-horizon reliability and context

The recent website-generation task showed both sides of the problem:

- the agent can create a real artifact
- long, tool-heavy workflows still become fragile under context pressure

### What Phase 5 should do now

Phase 5 should:

- benchmark long workflows
- measure when usefulness collapses
- track whether failure happens before, during, or after artifact creation
- improve plan-to-execution handoff
- avoid unnecessary multi-turn inflation
- preserve meaningful progress reporting across long-running work
- notify the user when a major milestone is reached or work becomes blocked

### What Phase 5 should not do yet

Do not prematurely build the full memory or compaction system inside Phase 5.

That belongs to a later workstream if needed.

### Boundary with later memory work

Phase 5 should observe and harden:

- where workflows fail
- how often they fail
- what artifact states they leave behind
- when progress updates remain truthful versus when the workflow becomes unsafe

Later memory or compaction work should solve:

- how to preserve and reshape long context
- how to compress conversation state safely
- how to support longer autonomy windows

## 13. Relationship to other roadmap items

### Phase ordering

Phase 4 Persistent Execution Layer through Batch 6 is effectively complete.

The next product frontier is Tool Usefulness, Task Truth, and Agent Progress Reporting.

### Reboot resilience relationship

Reboot resilience is a separate infrastructure workstream.

Phase 5 design can begin now in parallel with reboot-resilience planning.

However:

- deployment-style testing of long unattended workflows should wait for reboot resilience
- benchmark design and the first usefulness harness can proceed before that

### Recommendation

Do not block Phase 5 design on reboot resilience.

Do treat reboot resilience as an operational dependency for the most realistic long-horizon tests.

## 14. Recommended next implementation step

### First batch

Batch 5.1 - Tool Usefulness Benchmark Harness

### Why it should come first

Because BlockFork should measure usefulness before it tries to model it durably.

Without a benchmark harness, later task truth, progress reporting, and artifact confidence work will be harder to evaluate and easier to overbuild.

### Intended scope

- define the benchmark fixtures
- define the task scenarios
- define the scoring rubric
- capture outputs, artifacts, progress updates, and verification results
- keep the runtime public contract unchanged

### What verification should prove

- the benchmark suite runs repeatably
- useful workflows can be scored consistently
- partial success is visible
- artifact truth is measurable
- progress reporting is useful, not noisy
- human-input escalation happens only when warranted
- the current runtime behavior remains unchanged for normal chat paths

## 15. Final recommendations

### One-line verdict

Phase 5 is now locked as Tool Usefulness, Task Truth, and Agent Progress Reporting.

### Thesis

BlockFork already knows how to persist execution truth; Phase 5 should make it able to prove task success truth and communicate progress like a real worker.

### Proposed batch roadmap

1. Batch 5.1 - Tool Usefulness Benchmark Harness
2. Batch 5.2 - Task Outcome Truth Layer
3. Batch 5.3 - Artifact Completion Confidence
4. Batch 5.4 - Tool Failure Classification
5. Batch 5.5 - Agent Progress Reporting & Human-Input Escalation
6. Batch 5.6 - Truthful Completion Contract
7. Batch 5.7 - Long-Horizon Tool Workflow Reliability

### Recommended benchmark suite

- landing page from a short brief
- landing page from source URL or extracted page content
- Markdown brief creation
- grounded repo inspection summary
- frontend section/component generation
- revise a previously created artifact
- multi-step research to structure to artifact workflow
- deliberate partial-failure recovery
- each benchmark should also score proactive progress updates, noise level, escalation quality, and truthful completion

### Recommended first implementation batch

Batch 5.1 should come first.

### When Phase 5 should begin relative to reboot resilience

Phase 5 design should begin now.

Implementation of the first benchmark harness can also begin in parallel with reboot-resilience planning.

But high-confidence unattended runtime testing should wait until reboot resilience is addressed.

### Planning status

The Phase 5 plan is now locked for implementation prompts once the team is ready to begin.
