# CHANGELOG

## Unreleased

- Fixed co-op Galactic War battles still loading, for a joining player, the build bar and player list scripts of server mods that only that player has enabled

## v1.6.0 - 2026-10-23

- GW Server Mods' warnings and its battle loading steps now show in German, Spanish, French, Italian, Japanese, Korean, Dutch, Polish, Russian, and Simplified and Traditional Chinese, and each co-op player sees the loading steps in their own language. GW Server Mods now needs Mod Translations, which Community Mods installs with it
- When mounting the server mods fails, the PA log now records why wherever Galactic War mounts them, not only after the Fight button
- Skirmishes with server mods active start about 10 seconds sooner: GW Server Mods no longer mounts every server mod a second time while connecting to a game outside Galactic War
- Fixed joining a multiplayer game outside Galactic War loading the interface scripts of server mods that only you have enabled, which the host's game does not run
- Fixed co-op Galactic War battles loading, for a joining player, the interface scripts of server mods that only that player has enabled

## v1.5.0 - 2026-10-17

- The galaxy map is ready about 2 seconds sooner each time you enter it, including after a battle and when joining or hosting co-op: server mods that are still mounted from the previous screen are no longer mounted a second time
- Galactic War now warns you to restart PA when you change your server mods after first entering the galaxy map: until a restart, PA keeps the unit list it read then, so a faction you add or remove is not reflected in battles
- Fixed the Fight button in Galactic War doing nothing when mounting the server mods failed: the battle now starts, and the PA log records why the mount failed

## v1.4.0 - 2026-10-03

- Add mounted server mod information to the logs for diagnostic purposes

## v1.3.0 - 2026-10-01

- The Galactic War setup screen is ready about 2 seconds sooner: server mods mount after the screen's other mods have loaded instead of holding them up

## v1.2.0 - 2026-09-07

- Galactic War battles launch faster: server mod content is registered once per teardown, inside Community Mods' own rebuild, instead of a second time afterwards - about 10 seconds less per solo launch and 15 in co-op, with the same units and textures

## v1.1.0 - 2026-09-04

- Server mods' own scene scripts now load in Galactic War battles: build bar tabs, hotkey grids, player list theming and in-game mechanics such as Bugs' research
- Server mods are mounted in the war setup screen too, so a Galactic War mod can offer their commanders before a war exists
- Entering a Galactic War no longer stalls on a black screen for several seconds before the galaxy map appears
- Fixed base-game units going missing from a battle when the only active faction mod omits them from its unit list
- Fixed a Galactic War mod's race player being dealt every tech card and starting battles with vanilla units and no commander model: preparing the race for the galaxy map could put one faction's unit list back over the merged one

## v1.0.0 - 2026-08-28

- Initial release
