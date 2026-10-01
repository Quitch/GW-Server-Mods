# GW Server Mods

Galactic War does not mount server mods. Community Mods excludes it deliberately, so a
battle launched from a war runs without Legion Expansion or any other server mod, and
Galactic War's referee then fails to generate unit specs for units it cannot see.

This mod mounts whatever server mods you have active before a Galactic War battle starts,
and in co-op it makes the host the source of truth about which ones are in play.

## What it does

- Mounts every active server mod for Galactic War battles, generically. No mod is named in
  the code and no unit specs are bundled, so nothing goes stale when a server mod updates.
- Mounts the client mod a server mod names as its companion, because a faction usually
  splits its art between the two: models in one, textures in the other.
- Keeps those mounts alive across Galactic War's remount cycle, which otherwise drops them
  part way through battle setup.
- Adds strategic icons for modded units, which Galactic War otherwise draws as a plain dot.
- In co-op, publishes the host's server mods to the game's own required-mod check. A viewer
  missing one is stopped at the existing mod-mismatch screen and told which mod and why,
  rather than landing in a battle that fails.
- Only the mods a client has to render need to match. A mod adding units or terrain has to
  be on both sides; one that only adds AI data does not, so it never blocks a join.
- A viewer running a server mod the host is not gets to play regardless — they are simply
  recorded as not sharing it, so features can offer only what the host actually supports.

## What it does not do

**Server mods installed as a folder cannot be used.** There is no way to mount a directory
into the game's virtual filesystem, so such a mod's files never reach the client: the
referee cannot read its unit specs and the renderer has no models, leaving units missing
rather than merely untextured. The mod detects this and says so on the galaxy map instead
of letting you find out mid-battle. Install the mod as a zip, which is what the in-game
Community Mod Manager does. Server mods that only add AI data are unaffected, and client
mods installed as a folder are fine.

Only a locally hosted Galactic War is supported, which is what co-op uses. A Galactic War on
a remote or dedicated server cannot receive mod files at all: the base game's upload path is
tied to the custom-game lobby that Galactic War never visits, and the Galactic War server
state has no handler to receive it. That needs a server mod, not this one.

## How it works

See [docs/design.md](docs/design.md).

## Requirements

- Planetary Annihilation: TITANS
- Community Mods

### For faction mod authors

Ship your strategic icons (`icon_si_*.png`) in your **client** mod, at
`ui/main/atlas/icon_atlas/img/strategic_icons/`. The game builds its icon atlas at startup,
before any server mod is mounted, so icons that exist only in a server mod never reach
Galactic War and your units show a plain dot. See "Strategic icons" in
[docs/design.md](docs/design.md).

This is one case of a wider rule: content that only the client uses (icons, images,
animations) belongs in the client mod. Players download the client mod once, while the
server mod is uploaded and downloaded again every session.

## Credits

**kikta** wrote the original proof of concept this mod grew out of
(`com.pa.gw-server-mods-enable`). It established that a hand-mounted server mod survives
into a Galactic War battle at all, and identified the failure chain that makes it hard:
Community Mods' `remountClientMods` calls `unmountAllMemoryFiles`, the Galactic War referee
then cannot read the mod's unit specs, and the server starts with no commanders.

## Licence

[CC BY 4.0](LICENSE)
