# Hermes background tasks

The Conversations screen links to **Agent tasks**. Once the service is configured,
an explicitly requested background task can continue while the phone is locked.
Realtime continues to handle the conversation, and the service handles planning
and public research. Normal Realtime conversation, local memory and BLE do not
depend on the service. It does not create scheduled jobs or push notifications.
Hermes prepares its results in LOOI's warm, curious companion voice. This style
does not give the service senses, personal memory or physical control: the task
text remains the only personal context it receives. The updated companion prompt
was deployed to the configured Netcup service on 28 October 2026. The additional
Realtime response instructions require an updated app build.
During a Realtime conversation, ask LOOI explicitly to take on a goal, prepare
a plan or research a question; the current spoken request is sent as task text.
Ask about a task later to retrieve its status or result. If several tasks match,
clarify which one you mean. Voice searches examine at most five pages; if older
history remains, LOOI reports the incomplete search instead of treating a single
candidate as definitive. Use the task screen to browse older entries. For a task
started in the current Realtime turn, the app may offer its confirmed result once
after the acknowledgment has been heard and the conversation has been quiet.
This short watch ends after three minutes, a new user turn, an interruption, a
session change or loss of foreground access. It never reads the result without
the person's response. Other finished tasks remain available from the task screen
or by asking LOOI; there are no background notifications.

## App connection

The assistant page offers **Try with examples** and **Set up Hermes**. The example
route contains only invented calendar/email data and local drafts; it performs no
model or account requests. It uses a persistent Example data label even while a
mail is scrolled. No example task enters the real task list, memory or diagnostics.

The standard setup takes one private connection code, displays the target origin
and data notice, then verifies and saves only after **Connect to this server**.
The manual alternative takes the server's HTTPS origin and LOOI access token.
The token is a separate server credential, not an OpenAI key.
It must contain 32–512 base64url characters. The app keeps the connection in
SecureStore/Keychain and uses it only in the Authorization header. Redirects are
refused. A saved connection can be tested without showing its token.

An operator can create a private paste code for an existing service:

```sh
python3 services/hermes/create_connection_code.py --url https://agent.example.com
```

It reads the existing `LOOI_AGENT_TOKEN` environment variable or prompts without
echoing it. The resulting code contains that credential; keep it private and do
not put it in URLs, public screenshots or logs. Encoding is not encryption. This
does not create a new token, expiry, per-device access or tenant isolation.
Pausing/leaving setup clears screen credentials and aborts outstanding verification.
An aborted verification cannot subsequently save the connection before its storage
write has begun. A connection write already completed remains a saved setting.

The versioned public-research feature declaration is informational and backward
compatible with old protocol-1 servers. Unknown features never unlock personal
accounts or actions. Personal email/calendar content retrieval, external writes,
device pairing and a public multi-user service are not implemented by this UI step.

### Nous connections

The connected assistant page links to **Connect through Nous**. This is the chosen
account-integration path. The updated server advertises `connectionProviders:
["nous-v1"]`; old servers keep their existing research contract and show an update
message in the new account screen.

`GET /v1/nous` uses the pinned Hermes SDK to read the current regular Nous login,
account metadata and the authenticated connector catalog. An absent login is shown
as `server_login_required`; the operator must complete Hermes' normal Nous login
in this service's dedicated `HERMES_HOME`. The API neither creates guest identities
nor accepts raw Nous tokens from the app. Its current single-owner profile must
belong to the person connecting their accounts.

The person sees and confirms the Nous identity before requesting a link. Only
confirmed catalog entries can be offered. `POST /v1/nous/connect` binds the request
to that identity and refuses existing-account replacement. It obtains a browser
authorization link through Nous, with no automatic retry. The app displays the
destination before opening it without app/provider bearer headers. Returning from
the browser requires a fresh status check; it does not imply OAuth succeeded.
Existing-account repair/disconnection happens in Nous, with an explanation that
other Hermes apps may use that same connection.

The Nous metadata transport is limited to the official Portal and Connector
origins, disables redirects and bounds response size. This path cannot execute
connector tools or fetch personal mail/calendar contents. The research worker's
exact search-tool allowlist is unchanged; its profile explicitly disables
connectors, tool search and automatic guest identities even after a Nous login.
The displayed identity is bound to the captured profile OAuth bearer, not an
ambient gateway-token override. The signed-in catalog must establish
Google availability; the public catalog inspected on 28 October did not list it.
See the [current research and UI evidence](research/hermes-personal-agent-connections-2026-10-28.md).

The Nous metadata adapter was deployed to the configured Netcup service on
28 October 2026. Public HTTPS checks confirmed the advertised capability, the
protected Nous route and a successful research canary. The dedicated profile
initially had no Nous login; authenticated connector availability still requires
the owner's official device-login confirmation. The [deployment record](ops/hermes-nous-deployment-2026-10-28.md)
separates these checks from an authenticated account or Google integration.

Enter a task and choose **Start task**. The app records its UUID before sending
the request. If the response is lost, **Retry the same task** reuses that UUID
and the exact text. It never automatically creates replacement work. Pending
submission recovery is encrypted with MMKV AES-256; its random key is held in
device-only SecureStore on iOS. A missing encryption key with existing recovery
data fails closed. Do not erase recovery data to work around an unknown task:
check the server's task list before deciding how to recover the installation.

Task-screen polling runs only while that screen is focused and the app is active.
The bounded Realtime completion watch also polls only while the conversation is
in the foreground. Full
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
OpenAI receives the submitted task and search context. DDGS and its search engines
receive search queries. No full conversation history, saved personal facts, audio,
photos or robot controls are automatically attached by the app; task text itself
can contain information the user chose to provide. A plan is a proposal, not an
executed reminder or external action. Provider citation markers are removed;
when a search attempt yields no observed sources, the answer says so explicitly.

The server allows one executing task, eight queued tasks, 2,000 query characters,
six agent iterations and bounded execution/cancellation time. These are execution
limits, not a guaranteed dollar budget. The default inference model is
`gpt-6-luna` through the direct OpenAI Responses route. Actual model access must
be checked with the operator's account.

Task queries, results and sources live in SQLite on the configured server's
persistent volume.
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

## Deployment

The configured iPhone service is hosted on the existing Netcup VPS at
`https://159-195-212-54.sslip.io`. Its existing Compose service and data volume
were updated on 26 October 2026; the old Fly machine is stopped. Private operator
details and backup paths are maintained outside the tracked repository. Restarting
the service interrupts active tasks, so check the queue and make an online SQLite
backup before updating it.

### Historical Fly.io configuration

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
- At the time of this check, the Fly deployment was live at `https://looi-hermes-agent.fly.dev`, with exactly
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
  Both test tasks were then deleted: detail GET returned 404, retry PUT returned
  the deleted-ID receipt 410, repeated DELETE returned 204, and the task list
  was empty. Active-worker cancellation is covered by local spawned-worker HTTP
  tests; an in-flight paid request was not deliberately interrupted.
- Device/UI acceptance remains open. CoreSimulator has an incompatible system
  component, and the optional web preview cannot bundle its existing
  `expo-sqlite` WASM import. Neither successful compilation nor fixture tests
  establish correct on-device interaction.
