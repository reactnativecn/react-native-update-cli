# PR #85 review follow-up

## Changes

- `CacheNewObject` now resolves its shape index into the ordered, fully decoded
  property keys in the pretty pass. Both registers and the per-function cache
  index remain part of the comparison. Unknown shapes, undecodable keys and
  unsupported operands fail closed. With no binary resolver, the shape is only
  folded for diagnostics; the existing binary-data and raw-audit gates still
  forbid text-only equivalence.
- Fuzz success requires a positive integer round count, all requested positive
  comparisons, zero compilation/comparison failures, at least one effective
  planted difference, and no missed or unbuildable negatives. Optimized-away
  differences do not count. The last round also attempts a negative, so runs
  shorter than ten rounds are not structurally unable to exercise rejection.
- New regressions cover shape-index relocation, key changes, key order,
  register/cache preservation, malformed/missing references, text-only fallback,
  and fuzz runs with zero or incomplete useful coverage.
- Enforcing that gate exposed a pre-existing generator defect in the HBC 96
  CI run (seed 96, round 41): the quoted-string regex matched a gap after an
  escaped quote and inserted `~` before a quoted property name. String mutation
  and negative planting now use real string-token boundaries from the already
  installed Babel parser and JSON-encode replacements. The minimized regression
  also checks comments, regexps, templates, escapes and UTF-16 source offsets.
  The failure gate remains strict; the generator is fixed rather than skipping
  the failing round or changing the seed.

## Scope and evidence

The CacheNewObject regression uses synthetic instruction bytes and binary literal
sections to exercise the production pretty and raw normalizers. It does not claim
that a source-level fixture was compiled into CacheNewObject by a real hermesc.
The existing pinned HBC 96/98 compiler CI remains required before merging.

Unknown-opcode semantic coverage remains a separate follow-up, not a verified
current-compiler false-acceptance bug. Before accepting additional compiler
snapshots, audit their complete opcode/operand schemas and referenced sections.
Do not remove the whole pretty pass: information such as exception-handler tables
is not currently covered by the raw instruction normalizer alone.

Local validation in the authoring environment is limited to Node.js execution of
transpiled helpers and synthetic fixtures; Bun and hermesc are not installed.
The PR description records the subsequent CI state separately.

## CodeRabbit argument-validation follow-up

Only an omitted `--rounds` flag selects the default of 200. A flag without a
value, an empty value, or a following option is rejected with exit code 2 before
creating the output directory or invoking the compiler. Four CLI regressions
use an executable compiler fixture with a call marker to verify those side
effects do not occur; the valid-count control verifies the marker does work.
Argument-reading, compilation and run-entry functions now document their contracts.
