# ASA settings catalog

The panel exposes 422 scalar ARK: Survival Ascended options: 145 boolean, 185 float, 74 integer, 15 string and 3 password. Two passwords are editable per profile; `ServerAdminPassword`, `AdminListURL`, `UpdateAllowedCheatersInterval` and `RCONPort` stay visible in the catalog but are protected and managed only by the infrastructure. Structs, arrays, repeated directives and mod settings go through the advanced INI editor.

## Navigating the editor

There is a single technical catalog, but the PWA arranges the fields into 18 categories close to the sections of ARK's host menu: general, rates and difficulty, player, creatures and taming, breeding, per-level stats, harvesting, items/crafting/loot, structures, PvE/PvP/tribes, world, transfers, interface, cryopods, maps, rules, administration and launch.

Every field has at least one normalized tag; the vocabulary has 44 cross-cutting themes (mating, baby growth, imprinting, wild and tamed dinos, player, harvesting, structures, raids, tribes, transfers, HUD, security, and so on). Tags are inferred from the field text and corrected by hand, key by key, where the heuristic is wrong (`TAG_OVERRIDES` in `gameSettingsTaxonomy.ts`: for example `ServerPlatform` is not a structure and `BanListURL` is not about time). Search indexes the INI key, label, description, category and tag names. Category, tag, text and the "modified only" filter can be combined and show result counts without changing how the profile is serialized.

A field counts as "modified" only if its value differs from the ASA default (numeric comparison for int and float); infrastructure fields and fields left at the default do not count. The summary shows the total of modified fields plus the non-empty advanced directives and launch arguments. "Copy category" re-checks every copied value with the save-time rules and discards, with a notice, those that are invalid or out of range.

Most fields have a short description (in Italian, like the rest of the UI): 146 come from `gameSettingHelp.ts` and are limited to options whose meaning is known from ASA documentation. 12 have no text (wireless crafting variants, outpost limits, `OutpostSigilRewardMultiplier` and similar) because their meaning cannot be verified: no text is better than an invented one.

`MultiHome` and `ExclusiveJoin` remain in the catalog but show in the editor only in profiles that already set them (`legacy: true`): with a single network interface in a container `MultiHome` is not useful and the launcher does not pass its address; `ExclusiveJoin` (`-exclusivejoin`) is equivalent to `UseExclusiveList`.

## Displayed defaults

Each key has a `defaultValue`. The placeholder is derived from it, so leaving a field empty shows exactly what ASA will use without an override. Boolean menus also say whether the default is on or off.

Values were checked on 2026-08-25 against the [ARK Official Community Wiki](https://ark.wiki.gg/wiki/Server_configuration) and the [ASA baseline in INI format](https://github.com/Arkobat/ArkServerSettings/tree/master/SurvivalAscended/Default). Indexed stat values use the `PerLevelStatsMultiplier`, `PlayerBaseStatMultipliers` and `MutagenLevelBoost` tables of that same page.

Twelve keys have no fixed default documented by Wildcard and show `(non impostato)` ("not set"): `MultiHome`, the max-XP overrides, the two alliance limits, `ExcludeItemIndices`, `ValgueroMemorialEntries`, the three outpost limits, `AdminListURL` and `AutoRestartIntervalSeconds`. `AdminListURL` is only materialized by the project's runtime; for editable numeric fields in this group the slider stays disabled until a value is typed.

Three defaults are the effective ones of the project's launcher, because they are always put on the command line even when absent from the profile: `SessionName=ARK On-Demand`, `MaxPlayers=20` and `ServerPlatform=ALL`.

## Admin credential and RCON

RCON is always on: the launcher passes `?RCONEnabled=True` on the launch URL because the agent needs it for status, saves and auto-stop. `RCONEnabled` is not in the catalog; stored profiles that contain it among their scalar values stay saveable (`OBSOLETE_INFRASTRUCTURE_GUS_KEY_NAMES`) and the agent drops it before writing the INI.

`RCONPort` is infrastructure-owned like the password: launcher and agent use the port from the `RCON_PORT` env (27020 by default) and ignore the INI one, so a profile cannot break status, saves and auto-stop or collide with the game port (7777) or the agent's. Backend and agent reject `RCONPort` in values and raw text, `readIni` hides it, and the launcher/agent realign the line in the INI.

`ServerAdminPassword` does not follow normal ASA default semantics: the launcher always sets it from `RCON_PASSWORD`, the same secret the agent uses. Keeping it out of profiles prevents `GET /configs`, copies between configurations or members' proposals from distributing a credential that can run admin commands. Backend and agent also reject direct attempts through scalar values or the advanced INI editor.

ASA may persist a copy of the password in its runtime INI on the protected volume: the launcher overwrites it from the env before every start, and the agent re-syncs it after RCON-online and after stop, forces the INI to `0600` and masks it in API reads. In game, use `enablecheats <password>` first, then the command with the `cheat` or `admincheat` prefix.

To avoid typing the password on a controller, **Options, Administration, ARK admins** in the panel manages ASA's official whitelist instead. It accepts 32-character alphanumeric EOS/ARK account IDs, can suggest online players detected through RCON with one tap, and writes one ID per line to `ShooterGame/Saved/AllowedCheaterAccountIDs.txt`. The agent serves the same content to ASA as plain text on an endpoint that is reachable without a token only from `127.0.0.1`; from the network it requires `AGENT_TOKEN`. The launcher forces `AdminListURL` to that endpoint and `UpdateAllowedCheatersInterval=5`; both directives are infrastructure-owned and profiles cannot replace them. Accounts on the list are already authenticated as admins and use the `cheat` or `admincheat` prefix directly. The list is global, admin-only, and not included in profiles or members' proposals.

If the game server is stopped, the control plane persists the new list and queues it with priority in the boot queue, before the configuration that starts ASA. While the server is online the file is replaced atomically and ASA re-reads the local `AdminListURL` within 5 seconds. Authorization is assigned when the player connects, so after adding an ID the player must reconnect, but ASA does not need a restart. The local file alone is read at startup and must not be confused with the `AdminListURL` polling.

## Numeric ranges

Every numeric field declares `min` and `step`; `max` is the validation limit. Natural limits are specific to the quantity (ports 1-65535, times of day 0-86400, normalized percentages 0-1, `MaxPlayers` 1-200).

Multipliers (the `*Multiplier*` keys) and `OverrideOfficialDifficulty` have no upper validation limit: they only need to be finite numbers not below `min`. Private servers often use values far beyond the official profile (taming x85, baby growth x50000). For these fields the 0-6 range of ARK's host UI is only a `sliderMax`, the end of the slider: the numeric input next to it accepts higher values, snaps them to the step without clamping to 6, and shows a note below the field that the value is beyond the slider. The advanced INI editor is therefore not needed (it rejects catalog fields anyway).

For fields with an upper limit, slider and input share the same bounds. Arrows respect the range, a typed out-of-range value is brought back to the nearest bound when the field loses focus, and an in-between value is snapped to the step (`snapTypedValue`). The reset button removes the override and returns to the displayed default, without writing it to the file.

The step grid is anchored at zero (multiples of `step`), not at `min`: with a minimum that is not a multiple of the step (for example `min 1`, step 60), anchoring at `min` turned the default 3600 into 3601. The effective ends of slider and input are the first and last grid points in the range. An off-grid default, and a focus/blur without edits, are never rewritten. The function is in `numberSnap.ts`, tested by `server-agent/test/number-snap.test.ts`.

Float multipliers have a fine step: 0.05 (0.1 for official difficulty and Tek batteries), so 0.5, 1.5 and 2.5 are typeable. If the ASA default does not fall on the grid (0.14, 0.44, 0.17 in per-level stats) the step drops to 0.01 so the default stays reachable.

On touch devices the slider value is prepared locally and saved only when the gesture passes a threshold and is clearly horizontal, so vertical movement keeps scrolling the list without changing the profile. The mouse wheel blurs numeric inputs before the browser can apply a step; mouse, keyboard and precise entry stay available.

## Validation and shared rules

Validation rules live in one pure module, `control-plane/pwa/src/configRules.ts`: valid INI keys and sections, values without newlines, infrastructure keys, internal markers, raw text that duplicates a graphical field (compared by effective section: a mod's `Duration` in `[ModX]` is not the message-of-the-day duration), reserved CLI arguments and, with the catalog, types, ranges, correct section, known `managedKeys`, catalog keys put in raw instead of the structured fields, `ServerPlatform`, and string/URL format.

Backend and agent have separate Docker builds and cannot import from the PWA: they receive a generated copy (`control-plane/backend/src/shared/`, `server-agent/src/shared/`, plus the catalog as a table) from `scripts/sync-config-rules.mts`. After changing `configRules.ts` or the catalog, from the `server-agent` folder:

```
node --import tsx ../scripts/sync-config-rules.mts          # rewrites the copies
node --import tsx ../scripts/sync-config-rules.mts --check  # verifies, exit 1 if they diverge
```

An agent test (`config-rules-sync.test.ts`) fails if the copies are out of sync and checks that the configuration built from the catalog with ASA defaults passes validation.

Where it runs:

- **PWA**: `ConfigEditor` validates before sending and shows the error in the page.
- **Backend**: `POST /configs` answers 400 with a message (at most five errors) before saving or queuing a proposal. The module is `config-validation.ts`.
- **Agent**: at provisioning it applies only the structural subset (without the catalog), so already saved profiles stay launchable.

Keys moved between files in the catalog (`ImplantSuicideCD` in `GameUserSettings.ini`, `IgnorePVPMountedWeaponryRestrictions` in `Game.ini`, because ASA reads it from there) are migrated transparently by the agent in profiles saved with the old location (`migrateLegacyKeyLocations`); validation accepts the old location.

## Strings and launch URL

`SessionName`, `ServerPassword` and `SpectatorPassword` end up in the launch URL (`?SessionName=...?ServerPassword=...`), where `?` and quotes truncate the other options. Validation rejects them (passwords also with spaces), rejects leading/trailing spaces and limits to 128 characters; the PWA trims strings. `launch.sh` replaces forbidden characters in the session name with spaces and refuses to start with an unusable `ServerPassword`, instead of starting a public server without saying so.

`BanListURL` is validated as an http(s) address and written by the agent between quotes (the user enters only the address; an already quoted value is not doubled). Other URLs are validated but written as they are. `ServerPlatform` is a menu with `ALL` and the combinations of `PC`, `XSX`, `PS5` and `WINGDK` joined by `+` (in the documented order, for example `PC+XSX+PS5`); any other value is rejected because a typo makes the server invisible. `ClusterId`, `ClusterDirOverride` and `MultiHome` have a minimal format (no spaces or quotes; an IP for MultiHome).

Reserved CLI arguments also cover the launch URL parameters (`-QueryPort`, `-AltSaveDirectoryName`, `-ServerAdminPassword`, `-ServerPassword`, `-SpectatorPassword`, `-SessionName`, `-MaxPlayers`, `-RCONPort`, `-RCONEnabled`): the name ends at the first `=` or space.

The launcher reads keys in the section written by the PWA (for example `MaxPlayers` in `[ARKSA.Launch]`): the agent preserves same-named keys of ASA or mods in other sections, and a grep by name alone would read the wrong one. ASA ignores `MaxPlayers` in `[/Script/Engine.GameSession]` (it writes its own 70 there) and uses `-WinLiveMaxPlayers`, generated by the launcher. Profiles saved with the previous catalog still have `MaxPlayers` in that section: validation accepts it (`LEGACY_KEY_SECTIONS`) and the agent rewrites it into `[ARKSA.Launch]` in `migrateLegacyKeyLocations`.

## Writing the INI

`replaceManagedIni` removes a managed key only in the sections where it is known (catalog, profile sections, effective section of the raw text, sidecar): a mod's `Message` and `Duration`, or `MaxPlayers` of `[/Script/Engine.GameSession]`, are not deleted. The `*.arksa-managed.json` sidecar also records the sections (`entries`); one written earlier with names only keeps cleaning everywhere once. INI and sidecar are written atomically (temp file and rename) keeping existing permissions; a new `GameUserSettings.ini` is created `0600`, like the launcher does. Applying a configuration is replacing: only directives not managed by the panel are preserved.

## Password visibility

`ServerPassword` stays visible to all members because it is needed to join. `SpectatorPassword` gives privileged access: `GET /configs` masks it (in values and raw text) for non-admins who have "none" access to the configuration; people with review or full access see it.

## Automated checks

The catalog integration test fails if any of the 422 keys lacks an explicit default (even `null`), if placeholder and default diverge, if a numeric range is missing, if a default falls outside the slider, if a multiplier has an upper validation limit, or if its slider exceeds 6.

Tests also check that the 422 keys stay unique, that every final field has exactly one category and at least one valid tag, and that the main areas keep breeding, stats, cryopods and map content separate. Other tests check that each default lies on its step grid, that no float multiplier has a step above 0.1, that the agent's managed-keys baseline matches the catalog file, and that hand-corrected tags do not regress.
