---
name: diy
description: Interactive walkthrough for the .dot/diy Standard. As a maintainer, author or refresh this repo's decisions catalog (with or without AI research assistance). As a protégé who pulled this repo down to build your own variant, walk through the maintainer's catalog and keep or swap each key architectural/deployment decision, ending in a portable build brief.
user-invocable: true
---

# /diy

This skill is the one entry point for both sides of the .dot/diy Standard: the
**maintainer** who authors the decisions catalog on the source-repo side, and
the **protégé** who pulls the repo down to build their own variant. It always
runs inline in the main conversation — never dispatched as a subagent — because
both modes need genuine live back-and-forth with a human.

Supporting reference docs live alongside this file in the same skill
directory: `${CLAUDE_SKILL_DIR}/decisions.schema.md` (the catalog entry
format) and `${CLAUDE_SKILL_DIR}/build-brief.schema.md` (the session output
format). Read whichever is relevant before authoring or consuming either
file.

## Mode detection

Check for `.dot/diy/decisions.yaml` at the repo root.

- **Not found** → default to **maintainer mode**.
- **Found** → default to **protégé mode** and start the walkthrough directly.

Either way, state the assumption in one line and let the human override it —
file existence alone can't distinguish a maintainer refreshing an existing
catalog from a protégé starting a walkthrough. For example: "Found an
existing catalog — starting your walkthrough. Say 'I'm the maintainer' if you
want to update the catalog instead."

## Maintainer mode

Two paths, both always offered — not either/or:

1. **Autonomous.** Dispatch the `diy-cataloger` agent standalone. It
   researches the repo and writes/refreshes `.dot/diy/decisions.yaml`
   directly, flagging low-confidence entries for you to review afterward.
   Best for a maintainer who already knows the standard and wants a quick
   pass without a live interview.
2. **Interactive.** For a maintainer newer to the standard who wants guidance
   on what makes a good catalog entry. Runs live, in this conversation — but
   internally it *also* dispatches the same `diy-cataloger` agent to do the
   actual evidence-gathering (one evidence-gathering implementation, not
   two). Surface the agent's findings into the conversation for the
   maintainer to confirm, edit, or reject before anything is written to
   `decisions.yaml`.

Ask which path the maintainer wants before dispatching anything.

## Protégé mode

The protégé's session only ever discusses what's already in
`decisions.yaml` — it does not dispatch `diy-cataloger`. If the catalog is
silent on something the protégé asks about, do a cheap ad hoc inline read of
the repo yourself rather than dispatching the agent; its output is shaped for
structured catalog entries, the wrong shape for an on-the-fly gap-fill
answer mid-walkthrough.

### Session flow

- **Order**: group entries by `category` (not raw catalog-list order).
  Within a category, sequence by `dependsOn` where present, so a decision is
  never presented before something it depends on.
- **Framing**: teach-lite by default. For each entry, give 1-2 sentences of
  context — what the decision is, why it matters, drawn from the catalog's
  `whyChosen` field — before asking whether to keep or swap it. This is
  deliberate: the point of the walkthrough is to teach the protégé the
  source product's architecture as they go, not just collect swap choices
  silently. Offer a "just grill me" fast mode (bare question, no framing) for
  a protégé who doesn't want the explanation.
- **Fast-path defaults**, offered at two granularities:
  - Whole-session, at the start: "keep everything as default" skips straight
    to a fully-kept build brief with zero swaps.
  - Per-category, partway through: "keep the rest of this category as-is"
    skips remaining entries in the current category without abandoning the
    whole session.

### Recording outcomes

Write `.dot/diy/build-brief.yaml` incrementally as the session progresses —
see `build-brief.schema.md` for the exact structure. This file doubles as
resumable session state: resuming means re-opening it and continuing from
the first entry with no `outcome` set yet. There is no separate
session-state file.

### Cross-decision cascades

When the protégé swaps entry X and other entries list X in their
`dependsOn`:

1. Immediately surface a one-line warning: "this swap affects: Y, Z — you'll
   revisit those when we get there." Do not interrupt the current category's
   flow with a forced context switch.
2. When the session later reaches Y or Z in the category order, re-present
   them with a note that an upstream dependency changed, and prompt
   reconfirmation rather than silently carrying forward the old answer.
3. If the session ends (paused, or fast-pathed past) with a dependent never
   reconsidered, it cannot be written to the build brief as `kept`. Write its
   `outcome` as `needs-review` with a `reviewReason` explaining which
   upstream dependency changed.

### Session-close validation pass

Before the build brief is considered final, dispatch a bounded,
non-interactive subagent (an ephemeral dispatch — not `diy-cataloger`, and
not a new named mechanism agent) to re-walk every `dependsOn` edge across
`decisions.yaml` and the in-progress `build-brief.yaml`. It confirms every
entry has a non-null `outcome`, and confirms no entry whose upstream
dependency was swapped is left un-reconsidered without an explicit
`needs-review` flag. Surface whatever it reports back into the conversation
for the protégé to resolve or explicitly acknowledge before treating the
session as done.

### When a swap needs real exploration

If a protégé's swap decision turns out to need real investigation of its own
— not just a quick catalog lookup — and a `wayfinder` skill is available in
this environment, point the protégé at it as the next step rather than
trying to handle that depth here. If `wayfinder` isn't available, say so
plainly and let the protégé decide how they want to investigate further;
this skill does not depend on `wayfinder` being present.
