# Game server performance: what is emulated, what is native, what can be improved

An analysis of how ASA runs on the host and which "emulated" layers actually weigh on resources, with the goal of **reducing CPU/RAM needs and making execution smoother** without touching the stability reached during validation. It separates what is applied from what is still untested.

## The constraint that cannot be bypassed

ASA has **no native Linux dedicated server** and, unlike the old ARK: Survival Evolved, **no real headless/`-nullrhi` mode**: crash logs show the exe still loads `d3d12.dll` / `dxgi.dll` / `vkd3d` and needs a working Vulkan ICD to get past startup, even as a dedicated server with no client attached. The community (see sources below) confirms it: the few attempts to run ASA without a software Vulkan ICD (lavapipe/llvmpipe) fail at startup.

Consequence: **Wine/Proton and the software Vulkan rasterizer cannot be removed**; they are a real requirement of the binary. The room for improvement is not in removing them but in **keeping them from burning resources on output nobody will ever see**. The same reason explains the virtual X display (Xvfb): without a real `DISPLAY` the exe aborts about a second after init.

## What is applied

The code is in `docker/game-server/launch.sh`; the values are overridable from the env file (`game-server.env.example`, `server-raw.env.example`) for A/B tests without rebuilding the image.

| Change | Why | Risk |
|---|---|---|
| `LP_NUM_THREADS=1` | lavapipe (software Vulkan rasterizer) uses **by default one worker thread per core**, even for "rendering" that never produces a visible frame. On a 4-core host this means up to 4 threads competing with ASA's single main gameplay thread (which by game design is mostly single-threaded). Limiting it to 1 leaves cores to ASA. | Very low: standard Mesa variable, also read by Lavapipe (`docs.mesa3d.org/envvars.html`). |
| `WINEDEBUG=-all` | Wine logs `fixme`/`warn` channels to stderr by default: pure string-formatting/syscall overhead on a headless process whose log nobody reads live. | None: only disables diagnostic logging. |
| `PROTON_NO_FSYNC=0`, `PROTON_NO_ESYNC=0` | Checked in Proton's official source (`ValveSoftware/Proton`, branch `proton_9.0`, file `proton`): fsync/esync are **already enabled by default** when the kernel supports them (5.16 or newer). Setting them explicitly does not change today's behaviour but protects against default changes in future GE-Proton releases. | None. |
| `PROTON_USE_XALIA=0` | Xalia is Proton's accessibility daemon (screen reader/input hooks). In the official source it only activates if the appid has `xalia` in Steam's compat_config, which does not happen with a direct `proton run` (the Steam client is not involved); setting it explicitly prevents it from ever activating. | None: purely defensive. |
| `-nosound` on the ASA command line | **Official, documented** flag on ark.wiki.gg/wiki/Server_configuration: disables audio subsystem initialization, avoiding the emulated audio driver for a process that never makes a sound. | Low. |

### Start-up path (managed version)

The managed version keeps all checks but moves or removes redundant work:

- the SteamCMD check of the first launch starts as soon as the agent exposes `/health` and overlaps with boot-sync/configuration; provisioning waits for the same promise and later launches still run a fresh check;
- recursive ownership of the volume is fixed only if the root of `/data` is not owned by `steam`, i.e. on first use or import, instead of scanning game, mods, prefix and saves at every container start;
- on OCI, the boot volume goes from Balanced 10 VPU/GB to Higher Performance 20 VPU/GB before the start and back to 10 at shutdown. It helps only the genuinely I/O-bound phases; loading UE/ASA is partly CPU-bound, so do not expect a guaranteed gain.

Not reduced: the RCON wait, the mod check, the post-SteamCMD hooks, `saveworld`, and the 15 seconds of settle time for the database flush (verified against corruption). No flag changes graphics or gameplay for clients.

## Already correct (verified, no change needed)

- **Shader caches (DXVK/VKD3D) and the Wine prefix are persistent**: `STEAM_COMPAT_DATA_PATH=/data/proton-prefix` and `ARK_INSTALL_DIR=/data/ark` are both on the persistent `/data` volume, so shader compilation caches are not recreated from scratch at every power-on, which matters for an architecture that starts and stops often.
- **fsync/esync**: enabled by default (see above).
- **`WINE_CPU_TOPOLOGY`**: in the official source it is overridden only for a fixed list of appids with topology bugs; ASA is not one of them, so Wine exposes the real topology to the game. No action needed.

## Tested and discarded

1. **`-d3d11` / `-sm5` to force DirectX 11 instead of DX12: no effect, flag removed.** Applied by hand on a running server: clean boot, startup time in line with the baseline (about 113 s vs 111 s), RCON responsive, CPU/RAM unchanged. But the engine **silently ignored the flag**: checking `/proc/<pid>/maps` on all the processes of the service showed only `d3d12.dll` loaded (never `d3d11.dll`), so the translation path stays vkd3d-proton, not DXVK. This matches the community warning below ("many legacy flags are silently ignored by ASA"). Do not retry without a new source that describes a different way to force DXVK (for example a DXVK environment variable instead of the CLI flag).

## Not touched (risky, test before relying on it)

Any change to the Wine/Proton/Vulkan stack should be tested on a disposable server before being considered final, not applied cold on the basis of documentation alone.

1. **Process priority (negative `nice`) and CPU affinity/pinning.** Community sources agree: *"real performance gains come from CPU affinity, not launch flags"*. Raising priority requires the `SYS_NICE` capability (a commented-out line in `game-server.compose.yml`). Measure the effect (RCON `GetGameLog` / tick time) before making it default: with few cores, bad pinning can make things worse.
2. **Legacy flags such as `-structurememopts`, `-UseStructureStasisGrid`, `-nomansky`, `-nomemorybias`, `-UseLargePages`, `-NoHangDetection`.** They appear on the official wiki (which covers both ASE and ASA) or in hosting guides, but the up-to-date ASA community warns that *many legacy ASE flags are silently ignored by ASA or were renamed*. Including them without checking the startup log (`ShooterGame.log`, effective command line) gives false confidence. The `-d3d11` case above is a concrete example. Validate one by one.
3. **Transparent Huge Pages set to `always`.** Ubuntu defaults to `madvise`, already reasonable for a single process with a large working set like ASA (10+ GB). `always` is a host-level tuning (outside the container) with typically marginal gains and a known risk of micro-stalls from memory compaction; not worth it without a benchmark on this specific load.

## Sources

- [ValveSoftware/Proton, official `proton` source (branch `proton_9.0`)](https://raw.githubusercontent.com/ValveSoftware/Proton/proton_9.0/proton): `PROTON_NO_ESYNC`, `PROTON_NO_FSYNC`, `PROTON_USE_XALIA`, `WINE_CPU_TOPOLOGY`, `PROTON_FORCE_LARGE_ADDRESS_AWARE` and their defaults.
- [ARK Official Community Wiki, Server configuration](https://ark.wiki.gg/wiki/Server_configuration): official flags (`-nosound`, `-d3d11`, `-structurememopts`, ...).
- [Mesa 3D, Environment Variables (LP_NUM_THREADS)](https://docs.mesa3d.org/envvars.html)
- [OCI, Block Volume Performance](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeperformance.htm)
- [OCI, Changing Boot Volume Performance](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/update-performance-boot-bv-volume.htm)
- [ProtonDB, Improving Performance](https://www.protondb.com/help/improving-performance)
- Steam Community discussion on ASA launch options (client vs server flags, caution about forum flags the engine does not honor).
