# Design

## Why Galactic War needs this

Community Mods excludes Galactic War from its own `startGame` wrapper with a single
early-return in `ui/main/game/community_mods/states/connect_to_game.js`:

```js
if (window.gNoMods || mode.substr(-2, 2).toLowerCase() == "gw") {
  model.gameModIdentifiers([]);
  model.companionModsChecked(true);
  model.needsServerModsUpload(false);
  return oldStartGame(region, mode, startParams);
}
```

The branch it skips — `activeServerModIdentifiersToMount()` → `checkCompanionMods()` →
`mountServerMods()` → call through — is complete and generic. Galactic War simply never
reaches it, so no server mod is mounted, the referee cannot read the mod's unit specs, and
the server starts with `commanders:[null]`.

## Chrome 40

Shipped code runs in Coherent UI's Chrome 40. No `let`, arrow functions, template literals
or `class`; a parse error takes out the whole script rather than the line. `eslint.config.mjs`
is the executable statement of that limit and its whitelist is exhaustive — no entry means
no. `ko`, `_` (lodash 3.9.3), `$` and `api` are globals, and every scene shares one JS scope,
which is why each module is an IIFE that guards against being loaded twice.

## Promises

Inside this mod every chain is native, because every chain carries an engine promise.
Everything that **leaves** the mod is a jQuery promise, adapted with `ns.jq`.

jQuery 2.1.4 decides what is a promise by looking for a `promise` **method** — see
`$.when` and `deferred.then` in `media/ui/main/shared/js/thirdparty/jquery-2.1.4.js`. An
engine promise, which is what every `api.*` call returns, has `then` and no `promise`.
So `$.when(api.content.remount())` treats the engine promise as a plain value and
resolves immediately: the wait is skipped with no error, no rejection and no log line.
That cost this mod a silent 4-second gap between "mounted" and the models actually being
registered, and in an earlier build it merged the unit list before the zips had mounted,
losing 243 units. A native promise is invisible to `$.when` for the same reason — it has
no `promise` method either — so a chain cannot be half migrated.

Native promises adopt any thenable, engine promises included, so `Promise.resolve` and
`Promise.all` cannot fail this way. `Promise` is Chrome 32, inside the Chrome 40 limit,
and `eslint.config.mjs` whitelists it. `Promise.allSettled` is Chrome 76 and is not
available; `shared/promise.js` supplies `ns.settled`, which neutralises each input first
so one failure cannot cancel the rest — the behaviour `$.when(...).always()` gave.

`ns.jq` builds a `$.Deferred` from a thenable. Everything the mod hands out goes through
it, stock callers and other mods alike:

| What is handed out                       | Who reads it                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `api.file.unmountAllMemoryFiles`         | `gw_play/gw_referee.js:24`, `:202`, `replay_loading.js:158`, Community Mods `states/replay_loading.js:80` |
| `CommunityModsManager.remountClientMods` | `gw_play.js:202`, `:218`, Community Mods `transit.js:107`, `:130`, `start.js:332`, `gw_referee.js:20`     |
| `api.net.startGame`                      | `connect_to_game.js:709`                                                                                  |
| `ns.mount.run`                           | GW-AI-Overhaul `shared/race_mods.js:103`, through `$.when`                                                |
| `ns.manifest.load`                       | GW-AI-Overhaul `shared/race_mods.js:59`, through `$.when`                                                 |
| `ns.manifest.detectClientRelevance`      | nothing outside this mod today; it is on the public namespace and returns a promise                       |

`ns.mount.run` wraps inside `run` rather than at the export, so concurrent callers still
share one object. The native chain underneath is what `shared/hooks.js` and
`connect_to_game/start.js` build on, and a native promise adopts a jQuery one, so those
internal callers are unaffected.

`icon_atlas/icons.js` is the exception, and stays native end to end: the icon_atlas scene
loads it alone, without the shared modules, and stock discards its value at
`icon_atlas.js:163`. `$.ajax` stays as the HTTP client — its return is a thenable, so
native code consumes it — and Community Mods' own `$.Deferred`s are adopted the same way.

## Seams assigned after mod scripts run

Three separate functions this mod wraps do not exist, or are replaced, at the moment a
scene mod loads:

| Seam                                   | When it is assigned                                                         |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `api.file.unmountAllMemoryFiles`       | Replaced by Community Mods' `gw_referee` state script after the scene loads |
| `handlers.request_client_mod_manifest` | Assigned by `connect_to_game` during its own setup                          |
| `model.send_message`                   | Created in `app.registerWithCoherent`, which runs _after_ `loadSceneMods`   |

Each is taken with an `Object.defineProperty` accessor that re-wraps whatever is
assigned, rather than reading the value once. A repeating timer was tried for the first
of them and is the wrong tool: it is a race, and it stops defending after a fixed number
of tries. **Anything a scene sets up during its own boot should be taken this way.**

## Mounting

Two mounts per server mod, both needed:

| Mount                                | Who does it                              | Why                                                                                                                                   |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/server_mods/<id>/` and `mods.json` | `CommunityModsManager.mountServerMods()` | What the server reads, including the `mount_order` manifest                                                                           |
| `/`                                  | `shared/mount.js`                        | Galactic War's referee generates unit specs client side from `spec://pa/units/…`, and `/server_mods/<id>/` is not on that lookup path |

No mod is named in the code and no unit specs are bundled. The set comes from
`CommunityModsManager.activeServerModsToMount()`, minus the manager's own generated
`community-mods-server` aggregate, which is derived from the others and so is not something a
player can be missing.

### More than one faction

Every faction server mod ships its own `pa/units/unit_list.json` — registry files have no
append mechanism — and the root mounts shadow each other, so with Legion, Bugs and Exiles
active only the last zip's list survives and the battle has one faction's units. The specs
are all there; only the registry is lost. The referee reads that registry client side
(`gw_referee.js` fetches `spec://pa/units/unit_list.json`), so the server's own mount-order
merge never reaches it.

`mergeUnitList()` therefore reads the base game's list and each mounted zip's
`/server_mods/<id>/pa/units/unit_list.json`, unions them, and mounts the result
at `/pa/units/unit_list.json` with `api.file.mountMemoryFiles`. It is a memory file, so every
`unmountAllMemoryFiles` drops it — and every unmount already re-runs the mount through the
hooks, so it comes back with the zips. The referee then overwrites the same path with the
cooked superset it derived from the merged list, in the order the hook wrapper guarantees.

A root-only run re-shadows that memory file: its zip mounts land at `/` after the merged
list was mounted, and the VFS serves whichever mount happened last — measured in `gw_play`
as `coui://pa/units/unit_list.json` dropping from 575 units to 332 after
`mount.run({ rootOnly: true })` and returning to 575 after a full run. GWO issues exactly
that sequence when it primes race cells, so `mountRootOnly` re-mounts the payload of the
last merge, cached in module scope, after its root mounts settle. It cannot call
`mergeUnitList` instead: the merge reads each mod's list through `spec://server_mods/<id>/…`,
those mounts exist only once `CommunityModsManager.mountServerMods` has run on the battle
path, and `spec://` pins a path's first read for the process, so a merge attempted in
`gw_start` would pin empty reads and break every later battle's merge. The cache is
scene-scoped on purpose: the harmful sequence — a battle mount followed by a root-only
one — happens inside `gw_play`, `gw_start` has no merge to restore, and a merge carried
across scenes could name the wrong mod set. The restore must also never run after the
referee's cooked overwrite, which holds because no scene issues a root-only run once a
battle is under way — keep it that way.

#### Where the base list comes from

The base game's own list cannot be read at merge time. `mountAtRoot` puts every active
faction zip at `/`, each of those zips ships `pa/units/unit_list.json`, and this mod is the
only thing that mounts at the root — Community Mods mounts under `/server_mods/<id>/` and
`/client_mods/<id>/` — so from the first root mount onwards `coui://pa/units/unit_list.json`
returns whichever faction mounted last. There is no `pa_ex1` path to read instead: `pa_ex1`
is mounted onto `pa` before mods are, so only `/pa/...` exists at runtime.

The shadowing faction is itself active, so its list is already in the merge through its own
`/server_mods/<id>/` read. A read taken at merge time therefore contributes nothing, and any
base unit that no active faction lists was dropped: Bugs omits four (`radar_jammer`,
`tank_jammer`, `tank_anti_nuke`, `orbital_mine`), so a Bugs-only war lost them, while
enabling Legion or Exiles alongside brought them back because those two carry the full base
list. A list whose effect depends on which _other_ mods are enabled cannot be expressing
intent, which is why this is treated as a loss rather than a removal.

`captureVanillaUnits()` runs before the first mount of a run and caches the read in
`sessionStorage`, so the first scene of the process captures the unshadowed list and every
later scene reuses it. A base list that cannot be read falls back to the union of the mod
lists: it costs four units in one faction combination, and must never cost a battle.

**`spec://` caches a path after its first read, for the life of the process.** Measured
directly: after mounting the merged list, `coui://pa/units/unit_list.json` returned 575 units
and `spec://pa/units/unit_list.json` still returned the 332 it had served earlier, while a
memory file at a path never read before was visible through `spec://` at once — so this is a
cache, not mount precedence. The root list is therefore read through `coui://` (with a
cache-busting query, which `spec://` rejects), and nothing in this mod touches
`spec://pa/units/unit_list.json` until the merged file is in place; `verify()` probes it only
afterwards. A first version read it through `spec://` and pinned the unmerged list for the
referee, which is why this rule exists.

Community Mods generates a merged list of its own in `community-mods-server.zip`, but only
when every mod's `unitList` had been populated by its asynchronous filesystem scan at the
moment the zip was regenerated; a copy without any list was observed. It is not used as a
source for that reason. Community Mods' `mergeUnitServerMods` switch is honoured: when a
player has turned merging off, this mod does not merge either.

### Folder-installed server mods do not work

A server mod installed as a folder rather than a zip cannot be reached by the client.
`zip.mount` returns `false` for a directory and there is no directory equivalent, so its
content never arrives at the VFS root: the referee cannot read its unit specs and the
renderer has no models. Nothing here can fix that, so it raises `filesystem_server_mod`
and tells the player to install the mod as a zip instead.

An earlier version of this file claimed such mods needed no mount because the game already
exposed `server_mods` folders at the root. That was wrong, and instructively so: the
evidence was `coui://pa/ai_queller/...` resolving for a folder-installed Queller, but the
base game ships `pa_ex1/ai_queller/`, so the probe was reading stock content at the same
path. A mod adding a path the base game does not have - `pa/units/l_*` - returns 404.

The alarm is raised only for folder mods the client has to render, so an AI-only one like
Queller stays quiet: its content is genuinely server-side and its absence from the root
costs nothing.

Folder-installed **client** mods are unaffected - `client_mods/` folders do reach the root,
confirmed against a companion supplying textures from one.

### Before a war exists

`gw_start` has no Community Mods, so `manifest.js` reads the manager's own store there
through the stock `db` extender (`installedModsDB` / `installed_mods`), read-only: the
extender writes back on change and creates the record when the key is missing, so the
observable is never written and the read is skipped when the key is absent.
`manifest.load()` performs that read once; with Community Mods present it resolves at
once, and `activeServerMods()` answers from whichever source is there.

`mount.run({ rootOnly: true, remountContent: false })` is what `gw_start/mount.js` asks
for: the root mounts, nothing else - the scene reads specs and portraits through `coui:`,
which the zip mounts alone serve, and the content remount freezes the UI for seconds.
There is no `/server_mods/` mount because there is no manager to make it and no server to
read it, no unit-list merge because no referee runs here, and no probe of `mods.json`
because it does not exist. There is also nothing to restore on the way out: the merge
cache is scene-scoped and `gw_start` never merged. Its purpose is to let a Galactic War mod show a server mod's
commanders — specs and portraits — before the war is created. A battle mount still refuses
to run without Community Mods, since the `rootOnly` path is the only one the fallback
listing is fit for: re-mounting the merged unit list under a running battle would replace
the referee's cooked one.

**`sessionStorage` is per panel, not per process.** Measured in a battle: `live_game` held 50 keys
including the scene list, and `live_game_build_bar` held one (`dev_mode`) and could not see it.
`localStorage` is shared - a value written in `live_game` reads back in `live_game_build_bar`. The
scene list therefore lives in `localStorage`, because the panel that needs it earliest is the one
that cannot see a `sessionStorage` write. The classification stays in `sessionStorage`: the gate
reads it in the same panel that wrote it.

A faction can ship its build bar data in the **server** mod. Bugs and Exiles both put their
build groups and their `SpecIdToGridMap` entries in `shared_build.js`. Legion does not - its copy
is in the paired client mod, which the game always loads - so Legion hid this for a long time.
`SpecIdToGridMap` has no entry for a unit whose script never ran, and `live_game_build_bar.js`
then puts that unit in a `misc` group that no tab shows. The player sees an empty build bar and
no error. This mod therefore needs a scene entry for **every** scene a server mod can ship UI in,
not only the scenes this mod has work of its own to do in.

The entry alone is not enough. `build.js` reads `scene_mod_list["shared_build"]` while the panel's
own scripts are still to come, so `serverUi.load` must find the scene list **synchronously**. With
no list in hand it reads the store and loads late, and a late load is as good as no load here: the
build set captures `SpecIdToGridMap` when it is built, and a faction whose entries arrive after that
has every unit stamped `misc`. `makeBuildLists` then drops a unit whose buildables are all `misc`,
`parseSelection` cannot resolve the selected commander, and the player has no build bar.

`gw_coop_per_player_loadout` gets the shared modules for the same reason and nothing else:
a co-op viewer picks a commander there, and a Galactic War mod offering a server mod's
commanders needs the root mounts to read their specs and portraits. No scene script of
this mod's own runs there - the Galactic War mod calls `mount.run` itself when it has a
reason to, so a viewer who is not choosing a modded commander pays nothing.

## Keeping the mounts

Community Mods' `remountClientMods()` calls `unmountAllMemoryFiles`, which drops the root
mounts partway through battle setup. Wrapping that function once is not enough: the Community
Mods `gw_referee` state script reassigns it after the scene loads. `shared/hooks.js` installs
an accessor so whatever is assigned gets re-wrapped, which is deterministic where a repeating
timer is a race that also gives up after a fixed number of tries.

### A faction's art is split across two mods

Legion ships its **models** in the server mod and its **textures** in the paired client
mod:

| File                              | Server mod    | Client mod      |
| --------------------------------- | ------------- | --------------- |
| `l_raptor.papa` (model)           | 183,183 bytes | absent          |
| `l_raptor_diffuse.papa` (texture) | absent        | 1,365,902 bytes |

Mounting only the server zip therefore produces a correctly shaped commander rendered
entirely in white. `pairedClientMods()` reads each active server mod's declared
`companions` array and mounts the active client mods it names — Legion's server
`modinfo.json` declares `"companions": ["com.pa.legion-expansion-client"]`. The
dependency is stated by the mod author rather than inferred from a name. A declared
companion that is not active is logged as `companion client mods not all active` rather
than alarmed — the right severity, since the failure is a white unit and not a broken
battle. The residual risk is a server mod that ships split art but declares no
`companions`: it gets no pairing at all, silently.

### The content catalogue

Mounting makes files readable; it does not register models and textures with the
renderer. `api.content.remount()` rebuilds that catalogue, and Community Mods does the
same after mounting client zips. Without it every spec resolves and every unit is
invisible.

It must **not** run during a battle: it blanks the scene, and the models are already
loaded by then, so `live_game` holds the mounts with `remountContent: false`. Zip mounts
themselves survive a remount - that was checked directly, before and after.

`gw_play` passes the same option, for the neighbouring reason: the galaxy map has no
renderer content to register. Its commander portraits, tech card art and unit icons are
read through `coui:`, which the root mounts serve on their own, so a remount there buys
nothing and costs the several seconds of black screen between leaving `gw_start` and the
map appearing. The rebuild happens on the way into the battle instead, where it is
needed and where the launch panel accounts for the wait: the patched `model.fight` and
`connect_to_game` both run with the default options.

That makes the coalescing in `run()` load-bearing rather than a convenience. Concurrent
callers still share one run, except a caller that needs the remount while one that
skipped it is in flight - sharing that would hand the battle a catalogue that was never
rebuilt. It waits for the run in flight and then gets its own, queued rather than started
so two runs never overlap their mounts. A root-only run in flight is the other exception:
it merged no unit list and made no `/server_mods/<id>/` mounts, so a battle caller queues
behind it the same way, while a root-only caller may still share a battle run, which does
everything it needs and more. `gw_play/launch.js` therefore installs the hooks
with **no** options: an unmount mid-launch must still restore the catalogue, unlike
`live_game/remount.js`, which installs with `remountContent: false` because there the
scene is already running.

## Launch progress

Galactic War Overhaul shows a loading panel from the Fight click to the hand-off to
`connect_to_game`, and exposes it as `model.gwoLaunchProgress`. This mod only reports
into it: `mount.js` calls `stage()` when it starts mounting and again before the content
remount. GWO owns the screen, so nothing here shows or hides it.

Two facts make that safe without a load-order contract in the code:

- `stage()` is a no-op outside a launch, so the scene-entry mount in `gw_play/launch.js`
  and the mounts in `connect_to_game` and `live_game` report nothing. The scene-entry
  mount no longer performs the content remount, so it has nothing the panel would want
  to label anyway.
- The object is resolved at call time. GWO carries `priority: 200` and this mod the
  default 100, so GWO loads later and the object does not exist when `mount.js` runs.

That ordering is also what puts GWO's `model.fight` wrapper outside this mod's. Stock
`fight` only marks a launch after the war is saved, so if this mod's priority were raised
to GWO's or above, the server-mod mount would run before GWO's wrapper and the panel
would arrive only once the mount had finished - the unindicated wait this exists to end.

## Strategic icons

The icon atlas is built once, at startup. `icon_atlas.js` holds a hardcoded list of 132
names, mods extend it through the `icon_atlas` scene, and `sendIconList()` hands the
result to the engine. Nothing rebuilds it: a name pushed later is accepted and ignored,
which is why a modded unit shows the fallback dot and why re-sending the list during a
battle changes nothing.

Legion does ship `ui/mods/com.pa.legion-expansion/icon_atlas.js` naming its own icons.
That file is delivered through the **server mods' UI list**, which only loads when server
mods are mounted at UI-load time - so skirmish gets it and Galactic War never does.

`icon_atlas/icons.js` sidesteps that by naming every icon on disk rather than only the
ones the base game knows. It needs no mounting: a mod shipping strategic icons shadows
them into `ui/main/atlas/icon_atlas/img/strategic_icons/`, and client mods are mounted
before this scene runs. Listing is async and the scene sends its list as soon as the file
returns, so `sendIconList` is wrapped rather than raced - the scene's own call triggers
the enumeration and the list goes out once, complete.

Two known limits. The atlas is built before any mount exists, so this scene cannot use
the server mods' own `icon_atlas` scripts the way the battle scenes below use theirs, and
enumerates the directory instead. And the atlas grows from 132 to 274 names with one
faction loaded; PA's atlas texture limit is unknown, and an overflow would show up as
_other_ icons breaking rather than the modded ones.

## Server mod scene scripts

A server mod's `modinfo.json` may declare `scenes` like a client mod's — Legion's build
bar tabs, Bugs' research mechanic, Exiles' automatic extractor fire all live there. In a
skirmish they load because Community Mods writes the union of every active server mod's
`scenes` into the server zip's `ui/mods/ui_mod_list.js`
(`community-mods-manager.js`, `activeServerModsUImodList`), which the engine loads when
server mods are mounted at UI load. Galactic War never mounts them at that point, so
those scripts never load and the mechanics they carry are silently absent.

`shared/server_ui.js` loads them from the scene scripts instead. `loadMods` is the
game's own loader, a global in every scene, and `loadScript` behind it is a synchronous
XHR — so a call from this mod's scene script runs to completion before the scene binds,
at the same point in the page's life the engine would have loaded them. The list comes
from `manifest.scenes(scene)`: the union of the active server mods' `scenes`, computed
where Community Mods is present and persisted to `sessionStorage` by every mount, because
`live_game` and its panels have neither the manager nor a store to ask. Each URL loads
once per page, and a URL the scene or the global list already carries is skipped, which
is what keeps a skirmish — where the engine did load them — from loading them twice.

A mount that lists no mods does not touch the persisted list. `connect_to_game` mounts
as its scene loads, before Community Mods has read its store, and that run sees nothing
— measured live: `mounted server mods {"ok":true,"count":0}` two seconds before
`community mods ready`. Written through, it erased the list `gw_play` had persisted and
every battle scene loaded nothing. Should the list be missing anyway, `serverUi.load`
reads the store itself and loads late, after the scene has bound.

Where it runs: `live_game` (`remount.js`, which also loads the `shared_build` share,
because `build.js` consumed that list before any scene script ran),
`live_game_build_bar` and `live_game_players`. The main menu is not covered: a server
mod's `start` scripts are not loaded in a skirmish either.

The scripts were written for a skirmish. `model.gameModIdentifiers` and the lobby are
absent from a Galactic War battle, so each mod's scripts are a thing to smoke-test rather
than assume; a script that throws takes only itself out, since `loadScript` runs each
file separately.

## The co-op guard

Galactic War co-op already validates client mods host-first, and the server side of that check
(`server-script/states/gw_lobby.js`, `gw_campaign.js`) is set and version matching on opaque
identifier strings — it does not care whether an identifier names a client mod or a server
mod. `set_required_client_mods` is host-only. So server mods join the existing check rather
than getting a new one, and a mismatch lands on the mod-mismatch screen the game already has.

Both payloads are augmented at `model.send_message`, not by reimplementing the functions that
build them.

### Which server mods have to match

Not all of them. A server mod only has to be on the viewer's client if the client renders
its content, and the marker is what it ships under `pa/`:

| Mod                     | `pa/` trees                           | Required |
| ----------------------- | ------------------------------------- | -------- |
| Legion Expansion        | ammo, ai, anim, effects, units, tools | yes      |
| Alien Worlds            | terrain (89 `.papa` CSG models)       | yes      |
| Simple Biomes, tetctree | terrain                               | yes      |
| Queller AI              | `ai_queller`                          | no       |

The test excludes the server-only trees - anything matching `ai` or `ai_*` - rather than
listing the rendered ones. An unrecognised tree is then treated as client-relevant, which
is too strict rather than too lax: a guard that wrongly blocks a join is visible, one that
wrongly allows it produces a battle that fails later.

A units-only rule was considered and rejected. `pa/units/unit_list.json` is a reliable
marker for a unit mod, because registry files have no append mechanism, but Alien Worlds
ships 89 CSG models with no units at all and would have been excluded.

Classification needs the mods mounted, so it runs as part of the mount, and the answer is
persisted in `sessionStorage`. That is not an optimisation: the mount that classifies runs
in one scene and the gate that reads it runs in another, and each scene is a separate page
with its own copy of this module. Held in memory alone, the gate never sees a
classification and silently falls back to requiring everything.

Until a classification exists the gate does require every active server mod, rather than
none.

|                                 | Host publishes | Viewer reports                           |
| ------------------------------- | -------------- | ---------------------------------------- |
| Server mod the host runs        | yes            | yes, if the viewer has it                |
| Server mod only the viewer runs | n/a            | no — unless it declares `galacticWarMod` |

| Case                                                     | Result                                |
| -------------------------------------------------------- | ------------------------------------- |
| Host has it, viewer does not                             | Blocked, named on the mismatch screen |
| Both have it, versions differ                            | Blocked as a version mismatch         |
| Viewer has it, host does not                             | Joins; recorded as not shared         |
| Viewer has it with `galacticWarMod: true`, host does not | Blocked — stock behaviour, unchanged  |

That last row is deliberate. `galacticWarMod` means "everyone must match on this" for client
mods today, and this mod must not quietly soften it for server mods.

`GwServerMods.hostRequiresMod(identifier)` answers whether the host's published required
list names the identifier — client or server mod alike — so a feature can offer only what
the host supports — a viewer running Legion against a host that is not should not be
offered Legion. `GwServerMods.hostServerMods()` is the list form of the same capture:
`{ identifier, displayName, version }` per mod, an empty array when the host published
nothing. Both are public contract — Galactic War Overhaul's co-op race picker filters its
offer through `hostServerMods()` — so their names, shapes and the capture they read must
not change without a coordinated GWO release.

## Identifier case

The gate normalises identifiers to lower case on both sides, so that comparison is safe.
`model.gameModIdentifiers` goes back to the game instead - reconnect info and the beacon -
where a mod installed as `qQuellerAI-dev` must not become `qquellerai-dev`. `manifest.js`
carries both forms for that reason.

## Alarms

Failures here otherwise surface much later as a missing unit or a battle that will not
start, so they are raised on screen as well as in the console, in wording a player can
act on. The banner is a bonus rather than the report: not every scene composites its root
document, `live_game` in particular.

### Logging

PA's log file keeps only the **first** console argument, so every call builds one
concatenated string. Passing `message, detail` lands in the log as `message` alone.

`api.debug.log` is not used and should not be. It is a forwarder -
`Function.apply.call(console.log, console, arguments)` - so it truncates identically, and
it adds two problems: every call is gated on a `debug_allow_logs` local setting that is
unset by default, so output vanishes for exactly the user who needs it; and the log
records its call site (`boot.js`) rather than ours, losing which module spoke.

Stock agrees with itself here: Community Mods and the `[GW COOP]` code both concatenate
rather than pass multiple arguments.

`cmm_unavailable` and `gate_unavailable` matter most - a partly installed guard is worse
than none, because it looks like enforcement.

## What this cannot fix

Only a locally hosted Galactic War works, which is what co-op uses. A remote or dedicated
Galactic War server cannot receive mod files at all: `mod_data_available` exists only in
`server-script/states/lobby.js`, and the upload is gated on a redirect to `new_game.html` that
Galactic War never performs. Adding it needs a server mod.

Nothing verifies that mounted server-mod content matches what a saved war was created against,
so a war resumed after a mod update can lose units with no warning.

## Verification

The unit tests ([`testing.md`](testing.md)) pin what each module does with the engine
faked; whether the engine behaves as faked is verified by loading the game.

1. Solo local war, launch a battle — server mod units present, no `commanders:[null]`.
2. No `identifiers_lost` alarm, and `model.gameModIdentifiers()` holds the server mod at
   connect time. **This is the one assumption taken from reading the base game rather than
   from observing it**, which is why it alarms rather than failing quietly.
3. Mounts survive `gw_play` → `live_game`.
4. Co-op with a viewer missing the host's server mod — mismatch screen names it.
5. Co-op with a viewer running an extra server mod — joins, and `hostRequiresMod` is false.
   Then set `"galacticWarMod": true` on that mod and repeat: the viewer must be blocked.
6. Host and viewer on different versions of the same mod — version mismatch.
7. A second, unrelated server mod, to confirm nothing is specific to one mod.
8. `gw_start` with a faction server mod enabled — `GwServerMods.mount.state().mounted` is
   true and `coui:/` resolves one of its commander specs, with no Community Mods on the
   page.
9. A Galactic War battle with Legion, Bugs and Exiles — Legion's build bar tabs and
   hotkeys, a Bugs research station unlocking a unit, an Exiles extractor firing on its
   own; then the same in a skirmish, where each must still load exactly once.
