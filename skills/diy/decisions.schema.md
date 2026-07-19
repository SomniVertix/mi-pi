# Decisions catalog schema

The decisions catalog is the maintainer-authored input to the DIY mechanism: a
structured inventory of the key decisions made in building the source
product, written by whoever maintains that repo. It lives at
`.dot/diy/decisions.yaml` and is read by the DIY skill/agent to drive an
interactive walkthrough session — it is not the session's output (see
`build brief` for that).

## File

A single YAML file, `.dot/diy/decisions.yaml`, containing a top-level list of
entries. One entry = one decision.

## Entry fields

| Field            | Type                                     | Required                    | Notes                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ---------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | string                                   | yes                         | Stable slug, unique within the catalog (e.g. `data-store`). Referenced by `dependsOn`.                                                                                                                                                                                                                                                                                                       |
| `category`       | string                                   | yes                         | Free-text grouping (e.g. `data-store`, `auth`, `deployment`, `frontend-framework`). Not an enum — categories vary too much across product types to fix a list.                                                                                                                                                                                                                               |
| `currentChoice`  | string                                   | yes                         | What the source product actually uses today (e.g. `PostgreSQL`).                                                                                                                                                                                                                                                                                                                             |
| `whyChosen`      | string (prose)                           | yes                         | Free-text rationale. Can be as long as needed — multi-line YAML block scalars (`                                                                                                                                                                                                                                                                                                             | `) are expected here. |
| `alternatives`   | list of `{ option, tradeoffs }`          | yes                         | Real alternatives a builder could swap to. `tradeoffs` is prose, not a score.                                                                                                                                                                                                                                                                                                                |
| `swapDifficulty` | enum: `trivial` \| `moderate` \| `major` | yes                         | Rough blast-radius signal for the walkthrough session to set expectations before the user commits to a swap.                                                                                                                                                                                                                                                                                 |
| `evidenceLinks`  | list of strings                          | no                          | File paths (relative to repo root) or URLs backing `currentChoice`/`whyChosen` — an ADR, a commit, a doc, a code comment. Empty/omitted when a maintainer is asserting from memory rather than pointing at evidence.                                                                                                                                                                         |
| `dependsOn`      | list of strings                          | no                          | Other entries' `id`s that this decision assumes or is constrained by. Lets the session sequence questions and warn about downstream impact.                                                                                                                                                                                                                                                  |
| `confidence`     | enum: `verified` \| `inferred`           | no (defaults to `inferred`) | Set to `inferred` when `diy-cataloger` generates or refreshes an entry from evidence it gathered itself; flipped to `verified` once a maintainer has reviewed it. Doubles as the edit-tracking signal for catalog refreshes: `diy-cataloger` only rewrites entries still marked `inferred`, leaving `verified` entries untouched unless the maintainer explicitly asks it to reconsider one. |
| `extra`          | map                                      | no                          | Open-ended, maintainer-defined keys for anything domain-specific that doesn't fit the fixed fields above (e.g. a compliance note, a benchmark link, a migration-cost estimate). No fixed shape — this is the escape hatch that keeps the schema expressive across wildly different product types.                                                                                            |

## Example

See `decisions.example.yaml` in this directory.

## How the catalog gets produced

Most repos have no formal ADR directory — that's the common case, not the
exception. `diy-cataloger` (run standalone/autonomous, or dispatched
mid-conversation by the DIY skill's interactive maintainer mode) compiles
`decisions.yaml` by consulting evidence in priority order:

1. **Code, config, and package manifests** — highest confidence. This is what
   the product actually runs today, so it's the source of truth for
   `currentChoice`.
2. **README/docs prose and git commit history** — medium confidence. Used to
   fill in `whyChosen`. Treated as inferred rather than verified unless a
   direct rationale statement is found (e.g. an explicit "we chose X because
   Y" in a doc or commit message).
3. **Issue tracker** — optional, lowest priority. Skippable; not always
   reachable from a local checkout, and noisier than the other sources.

Every entry `diy-cataloger` writes or refreshes carries `confidence:
inferred` by default. A maintainer reviewing an entry flips it to `verified`.

**Catalog production is repeatable, not one-time.** `diy-cataloger` can be
re-run to refresh the catalog (e.g. after a dependency change or a release);
each refresh only rewrites entries still marked `inferred`, leaving
`verified` entries untouched unless the maintainer explicitly asks it to
reconsider one — the `confidence` field is what makes refreshes safe to
re-run without clobbering maintainer edits.

**A fully manual path is also available.** Nothing requires `diy-cataloger`
— this schema doc is designed to be hand-read and hand-edited directly by a
maintainer who'd rather not involve AI at all.
