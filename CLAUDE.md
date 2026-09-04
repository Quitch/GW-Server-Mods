# CLAUDE.md

## What this is

GW Server Mods is a client mod for Planetary Annihilation: TITANS that mounts active
server mods for Galactic War battles, which the base game skips, and makes the host the
source of truth for which server mods a co-op battle runs. It ships as plain JS loaded by
the game's embedded Chrome 40 — no build step, only lint.

The base game install (a `media` folder under Steam's `.../Planetary Annihilation
Titans/`) is not part of this repo and lives at a different path on every machine. If it
is set up as an additional workspace root it will appear in the "Additional working
directories" list, and its own `CLAUDE.md` identifies it. Treat it as read-only
reference. Never edit anything there.

## Architecture

[`docs/design.md`](docs/design.md) is the single design document: why Galactic War needs
this, the mount sequence, the seams that must be taken with accessors, the co-op guard's
four outcomes, and what cannot be fixed from a client mod. Read it before changing
anything.

The three that have actually caused bugs here:

- **Anything a scene sets up during its own boot must be taken with an
  `Object.defineProperty` accessor, not read once.** `model.send_message`,
  `handlers.request_client_mod_manifest` and `api.file.unmountAllMemoryFiles` are all
  assigned after mod scripts run. Reading them at load time silently patches nothing.
- **Mounting is not registering.** Files become readable, but models and textures stay
  unknown to the renderer until `api.content.remount()`. Never call it during a battle.
- **A faction's art is split across its server and client mods.** Models in one, textures
  in the other. Mount only one and units render in white.

## Constraints

Shipped `ui/**` must be ES5 / Chrome 40 safe: no `let`, arrow functions, template
literals or `class`. A parse error takes out the whole script, not the line.
`eslint.config.mjs` is the whitelist and is exhaustive — no entry means no. lodash is
3.9.3, so v4 names are absent.

## Comments

The code carries comments only where the code itself cannot explain something: base-game
or engine behaviour, a bug workaround, a dependency outside the mod, or a counter-intuitive
ordering. Past a line or two, a comment is documentation and belongs in
[`docs/design.md`](docs/design.md) instead; where that doc already covers the fact, the
comment is `See design.md.` and nothing more.

Verify a comment against the code before writing it. Every path, filename and identifier
it names must exist, and the claim must match the lines beside it — a confidently wrong
comment is worse than none.

Rejected alternatives and tuning history belong in the commit message. A comment states
the rule that holds now.

Never removed, because they are not prose: `eslint-disable` and `prettier-ignore`
directives.

## Verifying a change

`npm run verify` is the pre-submit gate: `lint:js`, `lint:md`, `format:check`,
`validate:json`, `test`. `npm run test:coverage` adds the coverage report and fails
under 80% lines; keep every shipped file measured rather than excluding it. The harness
runs each shipped file against faked engine globals — see
[`docs/testing.md`](docs/testing.md).

Nothing here starts PA, and `verify` cannot catch what this mod actually does against the
real engine. Every behavioural claim needs the game loaded and a battle launched — see the
verification list at the end of [`docs/design.md`](docs/design.md). The PA log directory under
`%LOCALAPPDATA%\Uber Entertainment\Planetary Annihilation\log\` is the objective record
for renderer failures; `Failed to load texture resource` and `Failed to load shader file`
appear there and nowhere else.
