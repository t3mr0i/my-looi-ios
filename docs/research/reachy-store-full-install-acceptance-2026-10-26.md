# Reachy Store full-install acceptance

Run on 2026-10-26 against the live public Hugging Face catalog and the local LOOI demo Companion. The upstream app and its Python package sources were not edited. No physical Reachy/LOOI hardware, camera, microphone, paid model, or inference service was used.

## Pinned app and resolved environment

| Item | Result |
| --- | --- |
| Store Space | `pollen-robotics/reachy_mini_clock` |
| Space revision | `e8b4a4ea44116d881b940b5ea210fe5e69e162e4` |
| Catalog kind | `python` |
| Catalog dependency | `reachy-mini` (unversioned in the app declaration) |
| Python used by the app runner | `3.14.5` |
| Resolved SDK | `reachy-mini 1.13.0` |
| Installed app | `reachy_mini_clock 0.1.0` |
| App dependency | `pytz 2025.2` |

## Results

**Full Store install: PASS.** The live catalog resolved the pinned revision, then the real `createAppRunner.install(spaceId, { revision })` path created an isolated per-app virtual environment and ran its ordinary pip install from the pinned Hugging Face Space. The installed-registry file and `reachy_mini_clock.main:ReachyMiniClock` entry point were created and validated. This run completed with the machine's normal 94 GB free; it did not use `--no-deps`, a pre-seeded registry, or the earlier SDK virtual environment. Pip selected SDK `1.13.0` from the app's unpinned dependency.

**Installed app start/stop: PASS on retry.** A separate process loaded the saved install through `createAppRunner.ready`, hydrated its entry point from the installed environment, and started the original Clock app. It logged `New timezone selected: UTC`; the app remained `running`, its Reachy movement command advanced the Companion command id and returned `adapted`, and `runner.stop()` returned `stopped`. The installed package and registry were not rewritten for this runtime check.

The first runtime attempt did not emit a movement command inside the 30-second acceptance window. Two consecutive runs afterward passed with the same installed environment and revision. The initial delay was not diagnosed, so the result demonstrates a passing start/command/stop path but does not establish a startup-time guarantee.

## Scope and limits

The Companion used `looi-demo-simulation`; its `measuredPose` was `null`, so this proves protocol adaptation only, not physical movement. The app runner was configured with `no_media`. Clock does not request camera or audio, and this test does not validate video, microphone, or WebRTC media. For a local-network safety guard, the runtime test changed the SDK app-server bind from `0.0.0.0:8080` to loopback in the test process; the installed app package remained unchanged.

The Store installation and process lifecycle both work for this official Python app on the tested Python 3.14.5 environment. MicroDuck's separate missing RPC methods and the hosted-app version gate are documented in the broader [robot-app acceptance report](robot-app-acceptance-2026-10-26.md); this Clock result does not resolve those findings.

## Reproduction

The full installer can be rerun with a live network connection. It removes its isolated environment after a failed run and keeps a successful environment only when `LOOI_KEEP_REACHY_INSTALL=1` is set:

```sh
LOOI_REACHY_ACCEPTANCE_FULL_ROOT=/private/tmp/looi-upstream-reachy-acceptance-full-runner \
LOOI_KEEP_REACHY_INSTALL=1 \
node scripts/robot-bridge-upstream-reachy-install-probe.mjs
```

After a successful install, run the lifecycle check against the resulting registry and environment:

```sh
LOOI_REACHY_ACCEPTANCE_FULL_ROOT=/private/tmp/looi-upstream-reachy-acceptance-full-runner \
node scripts/robot-bridge-upstream-reachy-full-runtime.test.mjs
```

The lifecycle check needs permission to bind local loopback Companion ports. It uses a small fixed catalog fixture because the preceding install probe already resolved the real live catalog revision.
