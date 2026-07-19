# Build brief schema

The build brief is the output of a protégé's live walkthrough session: a
portable record of every decision they kept, swapped, or left needing
review, in a form any AI coding tool can build a fork from. It lives at
`.dot/diy/build-brief.yaml` in the protégé's own repo and is written
incrementally during the session — it doubles as resumable session state,
since resuming just means continuing from the first entry with no `outcome`
set yet. There is no separate "final" artifact; a completed build brief is
simply one where every entry has a non-null `outcome`.

## File

A single YAML file, `.dot/diy/build-brief.yaml`, with a header block
followed by a list of entries grouped by `category` (mirroring the session's
own category grouping).

## Header block

| Field            | Type                                        | Notes                                                                                                                                                         |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protege`        | string                                      | Free-text identifying info for whoever ran the session (name, or however they introduced themselves).                                                         |
| `sourceRepo`     | string                                      | The maintainer's repo this build brief was walked through against.                                                                                            |
| `generatedAt`    | string (ISO 8601 timestamp)                 | Set/updated each time the file is written.                                                                                                                    |
| `lastValidation` | `{ passed: bool, issues: list of strings }` | The most recent session-close validation pass result (see `SKILL.md`'s "Session-close validation pass" section). Absent until the first validation pass runs. |

## Entry fields

Each entry carries its original `id` and `category` from `decisions.yaml`,
plus:

| Field           | Type                                        | Required                        | Notes                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`            | string                                      | yes                             | Copied from the matching `decisions.yaml` entry.                                                                                                                                                                                                                              |
| `category`      | string                                      | yes                             | Copied from the matching `decisions.yaml` entry — determines grouping.                                                                                                                                                                                                        |
| `outcome`       | enum: `kept` \| `swapped` \| `needs-review` | no (absent = not yet visited)   | Absent while the session hasn't reached this entry yet. `needs-review` means an upstream dependency was swapped and this entry was never reconsidered — never write `kept` in that situation.                                                                                 |
| `newChoice`     | string                                      | only if `outcome: swapped`      | The protégé's replacement for `currentChoice`.                                                                                                                                                                                                                                |
| `swapRationale` | string (prose)                              | only if `outcome: swapped`      | Why the protégé wants this swap, in their own words.                                                                                                                                                                                                                          |
| `evidenceLinks` | list of strings                             | only if `outcome: swapped`      | Carried forward verbatim from the original `decisions.yaml` entry — a pointer to what in the repo actually needs to change. The build brief does not attempt to author migration steps itself; this is a spec (what/why) for a downstream coding tool, not a task list (how). |
| `reviewReason`  | string                                      | only if `outcome: needs-review` | E.g. `"upstream dependency 'data-store' was swapped and this entry was not reconsidered."`                                                                                                                                                                                    |

## Example

```yaml
protege: "jordan"
sourceRepo: "acme/widget-service"
generatedAt: "2026-07-19T02:30:00Z"
lastValidation:
  passed: true
  issues: []

- id: data-store
  category: data-store
  outcome: swapped
  newChoice: MongoDB
  swapRationale: |
    Team already runs Mongo everywhere else; don't want a second database
    technology just for this service.
  evidenceLinks:
    - packages/persistence/src/spec-repository.ts

- id: deployment-model
  category: deployment
  outcome: needs-review
  reviewReason: >-
    upstream dependency 'data-store' was swapped and this entry was not
    reconsidered.
```

See `decisions.schema.md` in this directory for the catalog entry format
this is derived from.
