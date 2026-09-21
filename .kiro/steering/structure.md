# Code layout and conventions

## Directories

```
api/                Vercel serverless functions. One file per endpoint.
shared/             Pure code usable from both browser and server. No I/O.
src/
  components/       Reusable presentational pieces.
  features/         Vertical slices: shelf/, disc/, upload/, scan/, search/.
  hooks/            Cross-feature hooks.
  lib/              Browser-side helpers: fetch client, storage, image tools.
  motion/           Animation primitives, variants and shared transitions.
  styles/           global.css holds the design tokens.
  test/             Test setup and helpers.
scripts/            One-off maintenance scripts, run by hand.
.kiro/
  steering/         These guidance documents.
  specs/            Requirements, design and task lists per feature.
  skills/           Task-specific procedures the agent can load on demand.
  hooks/            Automation triggered by file and tool events.
```

## The `shared/` rule

`shared/` is imported by both the browser bundle and serverless functions, so it
must stay free of environment assumptions: no `window`, no `process.env`, no
`fetch`, no file system. Pure functions and schemas only. This is what makes the
domain logic testable without mocks, and every function there should have tests.

If something in `shared/` needs configuration, take it as an argument.

## Features are vertical slices

A feature directory owns its components, hooks, and local state. Reach for
`src/components/` only when a second feature genuinely needs the same piece.
Prefer duplicating a component once over generalising it prematurely — a shelf
tile and an upload preview card look similar and will diverge.

Cross-feature communication goes through the router or a small amount of shared
state, not through imports between feature directories. If `features/shelf/` needs
something from `features/upload/`, that thing belongs in `shared/`, `src/lib/` or
`src/components/`.

## Naming

- Components: `PascalCase.tsx`, one main component per file, named export.
- Hooks: `useThing.ts`.
- Everything else: `camelCase.ts`.
- Tests sit next to the code as `thing.test.ts`.
- CSS classes: `block__element--modifier`, matching the component name.

Avoid default exports except where a framework demands one (Vercel function
handlers). Named exports keep renames honest and imports greppable.

## Validation at the boundary

Every piece of data entering the system from outside — a MusicBrainz response, a
request body, a stored JSON document — is parsed through a Zod schema from
`shared/disc.ts` before use. Inside the boundary, trust the types. Do not scatter
defensive optional-chaining through the UI to compensate for unvalidated input;
validate once, at the edge, and let the types be real.

Third-party API shapes are not our domain model. Map MusicBrainz's response into
`Disc` explicitly rather than storing its JSON and reaching into it later.

## Testing

- `shared/` — unit tested thoroughly. Pure functions, so there is no excuse.
- Components — test behaviour a user can observe: what is on screen, what a tap
  does. Do not assert on animation internals or intermediate frames; assert the
  end state and that the element is present and labelled.
- `api/` — test the pure handler logic. Do not hit real MusicBrainz in tests;
  fixtures live beside the test.
- Do not test implementation details of the motion library. Trust it.

## Comments

Explain **why**, especially where the code looks odd for a non-obvious reason —
free-tier operation limits, an iOS bug being worked around, a MusicBrainz quirk.
These are the things a future reader cannot rediscover. Do not narrate what the
code plainly says.
