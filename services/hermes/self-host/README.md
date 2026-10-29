# Self-host on a Debian VPS

This Compose setup runs the existing Hermes service and preserves its HTTP API, SQLite task history, idempotency, queue, cancellation, restart recovery, and Hermes search behavior. It does not migrate data from Fly or configure a public endpoint, DNS, or HTTPS proxy.

## Preflight

- Use the existing VPS only after checking its guest load, available disk space, and that host port `8080` is unused. Do not stop or replace services to make room; choose a different loopback host port if needed and update the reverse-proxy target accordingly.
- Check that the `looi-hermes-self-host` Compose project and its named volume do not already exist unexpectedly. If they do, inspect their configuration and data before running `up`; do not assume they are disposable.
- Confirm enough free space on Docker's data filesystem for the image, build cache, persistent task data, and backups. A full filesystem blocks both Docker and SQLite writes. Diagnose storage pressure before building or starting; no automatic cleanup is included.
- Docker Engine and the Compose plugin are required. The Compose syntax was checked locally with Docker Compose v2.29.7; this does not validate the VPS Docker installation, image build, or actual memory peak.
- The initial container limits are 1 CPU and 2 GiB RAM, leaving nominal capacity for the host and its other services. Monitor peak usage before treating these limits as sufficient. The LLM runs remotely; this service does not need a local GPU.

## Configure and start

From a checked-out repository on the VPS, install the template outside the repository and build context so credentials cannot be copied into the image:

```sh
cd /path/to/my-looi-ios/services/hermes/self-host
sudo install -m 600 .env.example /etc/looi-hermes.env
sudoedit /etc/looi-hermes.env
```

Replace both placeholders with the existing OpenAI API key and a newly generated bearer token. Generate a token locally with `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`; put the value in the protected env file and in the LOOI app's Agent connection. The `.env.example` file contains placeholders only. Keep `/etc/looi-hermes.env` mode `0600` and outside the repository.

After the disk and port checks pass:

```sh
LOOI_ENV_FILE=/etc/looi-hermes.env docker compose up -d --build
docker compose ps
```

The service binds only to `127.0.0.1:8080` on the host. Compose creates a separate project named `looi-hermes-self-host` and a persistent named volume for SQLite and Hermes home data. Its restart policy is `unless-stopped`; on restart, active jobs are marked `interrupted` and are not replayed, while not-yet-started queued work remains queued.

The health check requests the service's `/health` endpoint. It checks local worker liveness, not OpenAI authentication, model access, or search-provider availability; verify those separately with a real task before switching the app. It reports an unhealthy container but Docker's restart policy does not restart a process solely because it is unhealthy; `unless-stopped` restarts a process that exits. Logs are rotated at 10 MB with three files. The container's stop grace is 110 seconds for the default 100-second worker budget. Shutdown currently cancels an active task and records it as `interrupted`; the grace period allows orderly cancellation and persistence, it does not drain the task to completion. If `LOOI_AGENT_TIMEOUT_SECONDS` is raised, keep the stop grace above the configured timeout (at least timeout + 10 seconds).

Do not run `docker compose down -v` unless you intend to erase all task records, deletion receipts, and Hermes home data. Back up the SQLite volume and verify restore before upgrades that may require rollback.

## Manual SQLite backup

`backup.py` uses SQLite's online backup API, so it can read the live database consistently while SQLite is in WAL mode. It checks integrity, normalizes the result to a standalone single-file database, creates the output with mode `0600`, and refuses to overwrite an existing path. The backup contains task data; keep it in protected storage. Its destination directory must already exist and have enough free space.

From `services/hermes/self-host`, on the default rootful Docker Engine volume, create a protected host backup directory and run the helper against the volume mountpoint:

```sh
sudo install -d -m 700 /var/backups/looi-hermes
volume_dir=$(docker volume inspect --format '{{ .Mountpoint }}' looi-hermes-self-host_hermes_data)
sudo python3 backup.py \
  --database "$volume_dir/tasks.sqlite3" \
  --output "/var/backups/looi-hermes/tasks-$(date +%Y%m%d-%H%M%S).sqlite3"
```

To test a restore without replacing the live database, use only the backup file to restore a temporary database and run an integrity check:

```sh
sudo python3 - "/var/backups/looi-hermes/tasks-YYYYMMDD-HHMMSS.sqlite3" <<'PY'
import sqlite3
import sys
import tempfile
from pathlib import Path

backup = Path(sys.argv[1]).resolve(strict=True)
with tempfile.TemporaryDirectory(prefix="looi-restore-check-") as directory:
    restored = Path(directory) / "restored.sqlite3"
    source = sqlite3.connect(f"{backup.as_uri()}?mode=ro", uri=True)
    destination = sqlite3.connect(restored)
    try:
        source.backup(destination)
        destination.execute("PRAGMA journal_mode=DELETE")
        if destination.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
            raise SystemExit("restore check failed")
    finally:
        destination.close()
        source.close()
print("Restore check passed.")
PY
```

This verifies SQLite can restore and read the backup file by itself; it does not replace a periodic operational recovery test.

## HTTPS integration

The app requires an HTTPS URL. Configure the VPS's existing reverse proxy separately to terminate TLS and forward to `http://127.0.0.1:8080`. This directory does not install or modify a proxy, firewall, DNS record, certificate, or public port. Keep the bearer token enabled.

If the existing proxy runs in another container, use the optional overlay below. It removes the base file's loopback host-port binding and attaches only the agent to an already existing private Docker network, under the alias `looi-agent`. Point the proxy upstream at `http://looi-agent:8080`; the proxy container must also be attached to that network. The overlay will not create a network or publish a port. It uses Compose's `!reset` YAML tag; confirm the installed Compose can parse it with `config --quiet` before starting. Set `LOOI_PROXY_NETWORK` to the existing network name:

```sh
export LOOI_PROXY_NETWORK=my-existing-private-proxy-network
export LOOI_ENV_FILE=/etc/looi-hermes.env
docker compose -f docker-compose.yml -f docker-compose.proxy.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.proxy.yml up -d --build
```

Omit `docker-compose.proxy.yml` to keep the default `127.0.0.1:8080` host binding.

## Useful operations

### Configured Netcup maintenance access

When direct SSH on port 22 is unreachable, the configured host already provides
SSH inside TLS on port 443. From the repository root, use the checked-in helper:

```sh
python3 services/hermes/self-host/ssh_via_tls.py -- 'uname -sr'
```

It uses the existing SSH key and pinned host key, verifies the TLS certificate,
and selects the existing SSH route with its TLS server name. It neither changes
the firewall nor disables host verification. The default destination is the
configured Netcup host; `--host`, `--tls-name` and `--user` can select another
already configured route. A new host must have its SSH host key verified and
installed separately. This helper does not create a route on an arbitrary server.

The service's `HERMES_HOME` and `HERMES_SHARED_AUTH_DIR` both live inside the
dedicated `hermes_data` volume. Complete any regular Nous device login as UID
10000 in that profile. Do not import another installation's credentials or place
tokens in the env template, source tree, image or command arguments.

The [28 October deployment record](../../../docs/ops/hermes-nous-deployment-2026-10-28.md)
records the tested image, backup, rollback and live-check limits.

Run these from this directory, with the same `LOOI_ENV_FILE` value used at startup. `docker compose config --quiet` checks Compose syntax and interpolated paths without printing environment values; it does not build or run the service.

```sh
LOOI_ENV_FILE=/etc/looi-hermes.env docker compose logs --tail=100 agent
LOOI_ENV_FILE=/etc/looi-hermes.env docker compose stop
LOOI_ENV_FILE=/etc/looi-hermes.env docker compose start
```

Stopping during a running task interrupts that task; do not restart during work that must finish.
