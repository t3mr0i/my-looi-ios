# Optional Hermes research agent

The Conversations screen links to **Agent tasks**. This is an optional service for
explicit text research requests that can continue while the phone is locked.
Normal Realtime conversation, local memory and BLE do not need this service.
The current integration starts tasks from this screen; it does not add voice
delegation, scheduled jobs or push notifications.

## App connection

Enter the server's HTTPS origin and its LOOI access token, then choose **Save and
verify connection**. The token is a separate server credential, not an OpenAI key.
It must contain 32–512 base64url characters. The app keeps the connection in
SecureStore/Keychain and uses it only in the Authorization header. Redirects are
refused. A saved connection can be tested without showing its token.

Enter a task and choose **Start task**. The app records its UUID before sending
the request. If the response is lost, **Retry the same task** reuses that UUID
and the exact text. It never automatically creates replacement work. Pending
submission recovery is encrypted with MMKV AES-256; its random key is held in
device-only SecureStore on iOS. A missing encryption key with existing recovery
data fails closed. Do not erase recovery data to work around an unknown task:
check the server's task list before deciding how to recover the installation.

Polling runs only while this screen is focused and the app is active. Full
answers load when expanded; older task pages can be loaded separately. Opening
a source contacts that website through the system browser. Backgrounding or
disconnecting the app stops local requests, while an admitted server task can
continue. Use **Cancel task** to request its cancellation. A cancelling task
becomes cancelled only after its worker exits. Cancelling does not undo provider
work or charges already incurred.

Deleting a terminal task removes its query and result from the active server
database. A UUID/deletion-time receipt remains to prevent an old request from
executing again. The app clears a pending admission if the server returns the
corresponding deleted-ID receipt. Provider records and Fly volume snapshots have
separate lifecycles; deleting a task does not delete those copies.

## Server contract and limits

Implementation: `services/hermes/`. It uses the pinned Hermes v0.22.5 runtime as a
Python library and a small single-owner HTTP facade. The app token cannot access
Hermes administration, terminal commands or arbitrary provider configuration.
The only enabled agent tool is `web_search`; runtime startup verifies this list.
Search uses the pinned DDGS extra with both keyless fallback and rescue disabled.
OpenAI receives the entered task and search context. DDGS and its search engines
receive search queries. No conversation, saved personal facts, audio, photos or
robot controls are attached by the app.

The server allows one executing task, eight queued tasks, 2,000 query characters,
six agent iterations and bounded execution/cancellation time. These are execution
limits, not a guaranteed dollar budget. The default inference model is
`gpt-6-luna` through the direct OpenAI Responses route. Actual model access must
be checked with the operator's account.

Task queries, results and sources live in SQLite on the encrypted Fly volume.
The service retains up to 10,000 task rows; the owner can browse and delete them.
Minimal deletion receipts are retained indefinitely and can grow with usage.
This is a private single-owner deployment; a public multi-user service requires
separate user authorization, ownership, quotas and a different storage design.

Each Hermes run executes in its own process. Cancellation first interrupts it,
then terminates/kills it if necessary. The worker slot stays occupied until that
process exits. On restart, running/cancelling tasks become interrupted and are
not replayed. Unstarted queued work resumes. A restored old database snapshot
is a separate recovery operation: reconcile it before resuming queued work,
because provider execution since the snapshot cannot be inferred from that copy.

## Fly.io deployment

The checked-in configuration is `fly.toml`: Frankfurt (`fra`),
one shared CPU, 1 GB RAM, HTTPS, a 1 GB persistent volume and no idle autostop.
Keep exactly **one Machine** (`--ha=false` on deployment and `fly scale count 1`).
Two Machines cannot share this SQLite task ledger. A single volume is not a
high-availability or host-loss guarantee. [Fly volume architecture](https://docs.fly.io/volumes/overview).

Create the Fly app/volume once, put `LOOI_AGENT_TOKEN` and `OPENAI_API_KEY` in
Fly secrets, and deploy from the repository root:

| Fly secret | Value | Purpose |
|---|---|---|
| `LOOI_AGENT_TOKEN` | A separately generated random base64url token | The iPhone app authenticates to the LOOI server with this token. |
| `OPENAI_API_KEY` | The operator's OpenAI API project key | Only the server uses this key to call OpenAI. Do not use it as the app access token. |

```sh
flyctl apps create looi-hermes-agent --org personal
flyctl volumes create looi_hermes_data --app looi-hermes-agent --region fra --size 1
flyctl ips allocate-v6 --app looi-hermes-agent
flyctl ips allocate-v4 --shared --app looi-hermes-agent
flyctl secrets import --app looi-hermes-agent
flyctl deploy --config fly.toml --remote-only --ha=false --strategy immediate
flyctl scale count 1 --app looi-hermes-agent
```

`flyctl secrets import` reads `NAME=value` records from stdin; provide secrets
privately and never commit them. Deploying secrets restarts the service, so active
tasks may be interrupted. The Docker build context is restricted to service code
by `.dockerignore`; app keys, build artifacts and local configuration are excluded.
The service image resolves the pinned upstream lockfile and DDGS at build time.
[Fly secrets](https://docs.fly.io/apps/secrets), [configuration](https://docs.fly.io/reference/configuration).

The configured Machine and volume incur ongoing hosting costs; model usage and
network transfer are additional. Machine pricing varies by region. Stop/remove
resources when the pilot is no longer needed, retaining wanted data first.
[Fly pricing](https://docs.fly.io/about/pricing).

## Verification

```sh
pnpm run agent:check
pnpm run agent:http-test
docker build --platform linux/amd64 -f services/hermes/Dockerfile -t my-looi-hermes:local .
```

Behavior and HTTP tests use local fixture workers and do not invoke a model or
search engine. A container runtime smoke verifies the actual Hermes imports,
DDGS readiness and exact tool allowlist without inference. These checks do not
establish API-key validity, model entitlement, live search quality or on-device
UI/audio behavior. A live acceptance run must separately cover a small research
task, reconnect, cancellation, deletion and a Machine restart.

### Implementation check, 25 October 2026

- The initial `agent:check` passed TypeScript/client checks and 19 Python tests.
  After the live-discovered source fix, the client behavior test and all 20
  Python tests passed again. A later composite typecheck during the concurrent
  Decisions implementation was blocked by the not-yet-created
  `src/behavior/behavior-engine.ts`; full app checks need to be rerun after that
  separate integration is assembled.
- `agent:http-test`: actual loopback HTTP requests with fixture workers passed,
  including duplicate/conflicting admission, summaries/detail, cancellation and
  deleted-ID receipts.
- The real container started, imported Hermes and DDGS, verified the exact
  `web_search` allowlist and passed health/auth/capabilities/task-list probes.
  The application process ran as UID 10000.
- `ios:check`, the 698-entry lock audit and public-repository audit passed.
  The iOS bundle export and unsigned native ARM64 simulator build passed;
  local build log: `output/ios-agent-build.log`.
- Fly deployment is live at `https://looi-hermes-agent.fly.dev`, with exactly
  one regular Machine, an encrypted 1-GB volume in `fra`, separate deployed
  `LOOI_AGENT_TOKEN` and `OPENAI_API_KEY` secrets, and image
  `registry.fly.io/looi-hermes-agent:deployment-01M5T50CT29S22YM0XMFQFEXMN`.
  Public IPv4/IPv6 DNS records, HTTPS and health/auth/capabilities were checked.
- Two bounded public research tasks completed through the real Hermes/OpenAI
  route. The first exposed Hermes' fixed `untrusted_tool_result` transcript
  wrapper: the old fallback gave JSON field names as titles and admitted an
  error URL. The parser now unwraps only that exact pinned wrapper and accepts
  only successful `data.web` rows. The second live task returned five meaningful
  titles with official Hermes URLs and no error URL.
- Live checks confirmed identical-ID retry without replay, conflicting-ID
  rejection, summary/detail separation, terminal-task cancellation semantics,
  and unchanged completed-task persistence across the image update/restart.
- Device/UI acceptance remains open. CoreSimulator has an incompatible system
  component, and the optional web preview cannot bundle its existing
  `expo-sqlite` WASM import. Neither successful compilation nor fixture tests
  establish correct on-device interaction.
