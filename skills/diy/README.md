# The .dot/diy Standard

A portable mechanism any repo can adopt to give the people who pull it down
a real, interactive walkthrough of the product's key architectural
decisions — not just static docs pointed at an AI, but a live session that
teaches those decisions and hands out real power to swap them.

Two people use this mechanism, at different times:

- **The maintainer** — someone on the source-repo side who authors or
  refreshes the decisions catalog, the record of what was decided and why.
- **The protégé** — someone who pulled the repo down to build their own
  variant. They walk through the maintainer's catalog, keeping or swapping
  each decision, and end up with a portable build brief any AI coding tool
  can build a fork from.

Both run through the same entry point: `/diy`.

## What's in this directory

These files are the **mechanism** — portable, repo-agnostic, and containing
no knowledge of any specific product. They ship unmodified into any adopting
repo's `.dot/diy/` directory:

| File                     | Purpose                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `SKILL.md`               | The `/diy` skill itself — mode detection, maintainer flow, protégé session flow.                   |
| `diy-cataloger.md`       | The agent definition for the research/authoring assistant the skill dispatches in maintainer mode. |
| `decisions.schema.md`    | Field reference for `decisions.yaml`, the maintainer-authored catalog.                             |
| `decisions.example.yaml` | A worked two-entry example of a decisions catalog.                                                 |
| `build-brief.schema.md`  | Field reference for `build-brief.yaml`, the protégé session's output.                              |

Two more files get created per-repo as the mechanism is used — these are
**content**, not mechanism, and are not part of this template set:

- `.dot/diy/decisions.yaml` — the actual catalog for whatever product adopted the mechanism.
- `.dot/diy/build-brief.yaml` — a particular protégé's session output.

## Setup

Claude Code does not natively discover skills or agents at arbitrary repo
paths — only `.claude/skills/` and `.claude/agents/` are scanned. There is no
automated bootstrap step for this: after cloning a repo that ships
`.dot/diy/`, make the mechanism locally invokable yourself, once:

1. Get `SKILL.md` recognized as a skill — copy or symlink it so it resolves
   at `.claude/skills/diy/SKILL.md` (along with the other files in this
   directory, which `SKILL.md` references). Whichever you choose (a real
   copy, or your own symlink) is up to you; the mechanism doesn't prescribe
   or automate either.
2. Get `diy-cataloger.md` recognized as an agent — copy or symlink it so it
   resolves at `.claude/agents/diy-cataloger.md`.

Once both are in place, `/diy` is invokable.
