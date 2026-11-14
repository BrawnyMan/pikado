# Darts Live v5 — saved tournaments and live event terminal

A Node.js darts tournament app with 16/32-player models, 2–7 machines per tournament, leg scoring, match clocks, machine history, sponsor ads and live spectators. A tournament-specific manager role can operate matches without admin access. Multiple tournaments are stored independently in SQLite and selected by UUID in the URL.

## Start the app

Use **Node.js 24 LTS** (the tested runtime). This release uses Node's built-in `node:sqlite` module; no separate database service is required.

Extract the download and open a terminal inside `darts-live`:

```sh
npm ci
```

Copy `.env.example` to `.env`, then set your own password:

```dotenv
ADMIN_PASSWORD=your-long-unique-password
PORT=3000
COOKIE_SECURE=false
```

Run:

```sh
npm start
```

Open **http://localhost:3000/admin**. Sign in, choose 16 or 32 players, name the event, and click **Create tournament**. The app opens that tournament's admin page.

If ADMIN_PASSWORD is not set, the terminal prints a random password for that server run. Admin sessions last 12 hours and end when the server restarts.

## Dedicated tournament URLs

Each tournament receives a UUID, for example `550e8400-e29b-41d4-a716-446655440000`. This is an illustrative ID; use the one created by your server.

| Page | URL pattern |
| --- | --- |
| Admin history / create tournament | `/admin` |
| Tournament admin | `/admin?id=TOURNAMENT_UUID` |
| Tournament manager | `/manager?id=TOURNAMENT_UUID` |
| Manager ID/password entry | `/manager` |
| Live spectator display | `/view?id=TOURNAMENT_UUID` |
| Protected green event terminal | `/terminal?id=TOURNAMENT_UUID` |
| Viewer ID entry | `/view` |

Admin history lists the available event links. Inside a tournament, **Tournament history** returns to the list, **Open display** opens the matching spectator view, and **Live terminal** opens its event stream.

A viewer link selects the tournament; it does not require the admin password. Anyone who can reach the server and has that viewer link can read its player names and results. Admin configuration, exports, the full tournament listing and the terminal/event-log API require an admin session. Assigned managers can perform match operations in their tournament only. UUIDs identify events; they do not grant admin permissions. The shared admin password gives access to all tournaments. Manager passwords are separate, scoped to one tournament, and never grant admin permissions. Manager credentials do not provide global browsing or access to another tournament ID. Spectator links remain public read-only links for people who know them; the manager role does not turn spectator links into private accounts.

For another device or TV on the same network, replace `localhost` with your server computer's local address, for example:

```text
http://192.168.1.50:3000/view?id=YOUR_ACTUAL_UUID
```

Allow port 3000 through the computer's local-network firewall if necessary, keep the server awake, and use the same server address on all devices. WebSockets subscribe to the UUID in the page's URL. Changing Tournament A does not update Tournament B's displays or terminal.

## Tournament history and archives

`/admin` shows all saved tournaments, including creation/update dates, player model, phase, revision, UUID and event count. Search by name or UUID, or filter Active/Archived.

**New tournament** inside a game creates another UUID and retains the current event. It copies machine, display and scoring preferences into a fresh setup. It does not clear the previous event's players or results. Creating from the history page starts with default settings.

**Archive** makes a tournament read-only. Return any active matches to the queue first, so clocks are paused. Archived events remain in history, have working viewer and plan links, and retain their event logs. Click **Reopen** to edit again. Completed tournaments can also remain unarchived if you prefer.

There is no destructive delete action. The old in-place `reset` API is disabled: create another tournament to preserve history.

Every actual match also gets its own persistent UUID, while IDs such as `r1-1` remain convenient labels within that tournament. Event logs carry both the tournament UUID and, for match commands, the match UUID.

## Admin, manager and viewer roles

| Capability | Admin | Assigned manager | Viewer |
| --- | --- | --- | --- |
| View live floor and bracket | Yes | Assigned tournament | Selected public spectator link |
| Assign a ready match to a machine | Yes | Assigned tournament | No |
| Return a match to the queue | Yes | Assigned tournament | No |
| Enter leg scores / confirm winner | Yes | Assigned tournament | No |
| Create/start events or edit players/formats/machines | Yes | No | No |
| Undo, announce, change ad settings | Yes | No | No |
| Browse tournament history / archive / reopen | Yes | No | No |
| Download plans, models or event logs | Yes | No | No |
| Open the real event terminal | Yes | No | No |
| Generate/revoke manager access | Yes | No | No |

### Give a manager access

1. Open the event as admin at `/admin?id=UUID`.
2. Go to **Settings → Manager access**.
3. Click **Generate manager password** and confirm.
4. Share the `/manager?id=UUID` link and the generated password with that tournament's operator. The password is shown only in this browser page until closed/reloaded or signed out; it cannot be retrieved later.
5. The operator opens the link and signs in with the manager password. Their page has the floor, queue, bracket and match-plan views, plus score/assignment controls. It has no admin settings, history links, exports or terminal access.

If you lose the password, generate a replacement. **Replace manager password** invalidates the previous password and all current manager sessions for that event. **Revoke access** disables manager login and closes its live connections. Re-enabling generates a new password. Credential changes are logged without the password itself and are not part of the gameplay undo stack.

Manager passwords are stored as salted scrypt hashes in SQLite, separately from spectator state and JSON exports. They survive a server restart; login sessions do not. Manager sessions last 12 hours, and the server checks their tournament scope, allowed command and credential version on each operation. Changing the ID in a manager URL or request does not grant access to another event.

Use separate browser profiles, devices or a private window when testing admin and manager at the same time, because the roles use the same browser's session cookie. One shared manager credential is supported per tournament; this is not an individual staff-account system.

A manager waits for the admin to create and start the tournament. To correct a finished result or alter setup, the manager asks the admin. Managers can correct draft leg scores before confirming a winner. An archived tournament stays read-only for managers.

## Set up and play

1. Open an event's admin page.
2. Choose **16 players** or **32 players** before starting.
3. Enter exactly that many unique names, one per line, or use **Use sample players**.
4. Check the roster order: players 1 & 2 meet, then 3 & 4, and so on. The app does not randomize or seed the roster automatically.
5. Click **Start tournament** and confirm.

The 16-player format has 15 games and four rounds. The 32-player format has 31 games and five rounds. Both are single elimination: winners advance and losers are eliminated.

In **Settings → Dart machines**, add or remove machines, with a minimum of 2 and maximum of 7. An occupied machine cannot be removed. IDs of remaining machines stay stable. Machine lists and assignments belong to the selected tournament.

**Next up** contains games whose two players are known, sorted by bracket round and game number. Click a numbered free-machine button to call a game. The admin may choose any ready game. Later-round games unlock as their opponents become known; the whole earlier round does not need to finish first.

To move a game, click **Return match to queue**, then assign it to another free machine. Its leg records, accumulated playing time and machine history are retained.

## Leg scores, match formats and player settings

The default is **first to 2 wins**, with up to three possible legs. Click **Enter leg scores** on an active game:

| Leg | Player A numeric score | Player B numeric score | Winner |
| --- | --- | --- | --- |
| 1 | Optional | Optional | Choose A or B |
| 2 | Optional | Optional | Choose A or B |
| 3 | Optional, if played | Optional, if played | Choose A or B, if needed |

Numbers are whole values from 0 to 9999. Blank and zero are different. You can use remaining dart points or your chosen numeric convention: **the selected leg winner determines the match tally**, rather than assuming a higher or lower number wins.

A, B, A records a 2–1 match. A, A records 2–0; leave the third leg completely blank. Leg winners must be entered in order, and no additional played leg is allowed after a player clinches the game.

- **Save leg scores** updates the live display without finishing the match.
- **Save & finish match** validates the result, advances the winner and frees the machine.
- **[player] wins** is a shortcut that adds the missing winning legs without inventing numeric scores. Use the leg sheet for a precise record.

Settings has a wins-needed target for every bracket round, from 1 to 9. First to 3 allows 5 possible legs; the maximum is `2 × target − 1`. Changes apply to unscored waiting/queued games. Active games, games with recorded leg data, and individual overrides retain their format.

Open **Game settings** on a machine, queue or bracket/plan card to:

- Rename known players while retaining their IDs and bracket positions. Names update throughout the event and must remain unique.
- Change that game's target, without discarding recorded leg data. A finished game's format stays locked.
- Set a **Preferred machine** for an upcoming game. It is a planning note, not a reservation; the admin still assigns the actual machine.
- Inspect its playing time and machine visits.

**Undo last action** restores the previous event state, with up to 30 undo steps. This is shared across admins of that tournament and includes score/settings/announcement changes. Undo is itself logged: earlier event-log entries are never removed. To correct an older result, undo later dependent actions first. There is no redo. Archive/reopen and manager-access actions are not added to the gameplay undo stack.

## Match clocks and machine history

The opponents share a match stopwatch. It starts on assignment, pauses in the queue, resumes on reassignment and stops when the winner is confirmed. Saving scores alone does not stop it. Running clocks survive reloads and server restarts and include elapsed time during a server outage.

Each machine assignment appends a visit with the machine ID, saved name, start time and end time. A completed game's duration and previous machine names remain recorded even if that machine is later removed. Visit times display in the browser's local timezone.

Undo keeps a currently playing clock continuous. Undoing a finish resumes the game without counting the time it spent finished. Legacy games imported from earlier versions may have approximate active clocks or unrecorded final durations; the interface labels these instead of inventing historical timing.

## Floor, compact bracket and match planning

**The floor** shows all machines, the queue and recent results.

**Compact bracket** uses smaller cards and independently scrolling round columns. Finished leg details are collapsed until opened.

**Match plan** is a spreadsheet-style website table. It shows:

- Past, current and future games.
- Known player names or sources such as **Winner of R1-1**.
- Status, result, current/previous/preferred machine, duration and visit history.
- The winner's next match and slot, or Champion for the final.
- The loser's destination: Eliminated in the included formats.

Click game IDs to follow links, filter by round, or choose **Follow a player** to inspect a possible route to the final. Future steps depend on winning earlier games; an actual loss ends that route. Planning is read-only and does not simulate outcomes into the live tournament. A full placeholder preview is available before starting.

The reusable model files are small:

```text
models/16.json
models/32.json
```

They declare the format, player count, round names and default targets. `models.js` generates all match sources and winner links for the shared engine. The app supports these two included single-elimination models; importing an arbitrary graph or adding a losers bracket is not implemented.

For admins, **Download plan JSON** exports the selected event without its undo snapshots. Before starting, it exports its generated placeholder plan. **Model JSON** downloads just the small configuration. These download endpoints and buttons are admin-only; viewers and managers still have the read-only match-plan table. There is no JSON upload screen.

## Sponsor ads, announcements and sound

Put PNG, JPG/JPEG, WEBP or GIF images into:

```text
ads/left/
ads/right/
```

The left and right slideshows sit beside the viewer queue on wide screens and below it on narrow screens. They rotate independently in alphabetical filename order, every **5 seconds** by default. Settings can change this to 2–60 seconds or hide the panels for that tournament. The image folders themselves are shared across tournaments. New filenames/removals are detected within 15 seconds; use a new filename when replacing artwork. No artwork is bundled. SVG, HTML and symbolic links are excluded.

**Settings → Send an announcement** pushes up to 500 characters to the center of every viewer for that UUID. Choose 15, 30 or 60 seconds, or Until cleared. **Clear message** removes it. A new announcement replaces the old one, and timed messages disappear without requiring a subsequent match update.

On each viewer, click **Enable sound ♫** after opening/reloading to activate its chime. New calls and changes to the next ready players produce a brief sound, a 10-second player callout and a slow temporary highlight. Ordinary score edits, renaming and ad rotation do not chime. Reduced-motion preferences use a steady highlight. Keep device audio unmuted.

## Decorative terminal visuals

The terminal now has a separate **Visual only / Synthetic telemetry** panel. It refreshes every **5 seconds** with random hex strings, imaginary module labels and green meter values. It is purely decorative and does not describe real tournament, network or server performance.

The synthetic values are generated in browser memory. They make no HTTP or WebSocket requests, never enter SQLite or browser storage, do not change event counts, and are excluded from real log exports. **Pause visuals / Resume visuals** controls this panel independently of the real event stream. Reloading discards its previous values. The real event log remains below it and is labeled separately.

## Green live event terminal

Open `/terminal?id=YOUR_UUID` or click **Live terminal** in the admin. It uses a green-on-black observatory style with:

- Timestamped, numbered events and live connection status.
- Tournament revision, event UUID and match UUID.
- Human-readable descriptions and expandable command payloads.
- Search/filter by player, game, action or UUID.
- **Pause display / Resume display**: incoming events continue to be collected while the visible rows are paused.
- **Load older events** in pages of 200.
- **Export full log** as JSON.

The terminal starts with the latest 200 stored events and merges new WebSocket events by their unique sequence ID. After disconnects, it catches up in ordered pages after its last known event. The database retains all accepted event records even when the undo stack or visible terminal page is shorter. Sign-out or session expiry closes the protected monitor connection.

Rows represent committed server changes: creation, start, assignments, scores, results, undo, settings, announcements, archive and reopen. Rejected commands are not tournament updates and are not saved in this event log. Login credentials are not included. A log row records a committed change broadcast by the server; it is not a receipt proving every viewer displayed it. Socket heartbeat packets and initial subscriber snapshots are not duplicate tournament-change events.

## SQLite storage, migration and backups

The runtime database is:

```text
data/darts.sqlite
```

SQLite tables store tournaments, their current state/undo stack, append-only event records, and scoped manager credential hashes/versions. Each accepted command updates the state and inserts its event **in one transaction**, then broadcasts after commit. A failed transaction saves neither change. UUID-scoped revisions reject stale admin commands. The small model JSON files remain reusable configuration; they are not event databases.

To upgrade from v1–v4:

1. Stop the old server.
2. Back up `.env` and the entire `data/` folder.
3. Extract this release and retain/copy your existing `.env`, `data/` and sponsor image folders.
4. Use Node.js 24 LTS; run `npm ci`, then `npm start`.
5. Open `/admin`, sign in, and find the imported tournament. Copy its new UUID viewer link to your TVs.

Existing v4 SQLite data gains the manager-access table automatically. No existing tournaments are removed. On the first database startup, a previous `data/tournament.json` is imported as one UUID tournament, including its current results and undo snapshots. The original file is left unchanged as a backup, and a database marker prevents duplicate imports on later restarts. The persistent event log begins with the import event; old releases did not record the original command log. Earlier events already discarded by old resets cannot be reconstructed.

Fresh installs start with an empty history and create their first tournament through `/admin`. ID-less old viewer URLs no longer select an implicit event: use the new UUID links.

For backups, stop the server and copy the **entire data directory**, including any SQLite sidecar files. Restore the whole stopped directory. Do not overwrite a database while the app is running. Keep it on a persistent local disk on a Node.js host. This starter is intended for one running Node server process; multiple hosted replicas would additionally need shared database and cross-server event distribution.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_PASSWORD` | Random at startup | Shared password for admin/history/terminal |
| `PORT` | `3000` | HTTP and WebSocket port |
| `HOST` | `0.0.0.0` | Listening interface |
| `DATA_DIR` | `data/` beside server.js | SQLite database and optional legacy import source |
| `ADS_DIR` | `ads/` beside server.js | Shared left/right image folders |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |

Prefer absolute paths for custom directories. For internet hosting, use HTTPS, COOKIE_SECURE=true and a reverse proxy that preserves the public Host and forwards WebSocket upgrades. The app is delivered as source and has not been publicly deployed.

## API and project structure

| Endpoint | Purpose |
| --- | --- |
| `GET/POST /api/tournaments` | Admin list / create tournament |
| `GET /api/state?id=UUID` | Selected tournament's spectator state |
| `POST /api/command?id=UUID` | Admin command or allowed manager command for its assigned UUID |
| `GET/POST /api/manager-access?id=UUID` | Admin-only status / generate / revoke |
| `POST /api/manager-login?id=UUID` | Sign in with that event’s manager password |
| `POST /api/archive?id=UUID` | Admin archive/reopen with current revision |
| `GET /api/events?id=UUID` | Admin log page; optional `before` or `after` event ID |
| `GET /api/events/export?id=UUID` | Admin full event log download |
| `GET /api/export?id=UUID` | Admin-only event/plan JSON download |
| `GET /api/models` | Model configurations and previews |
| `GET /api/models/:id` | Admin-only model JSON download |
| `GET /api/ads` | Shared left/right image URL lists |
| `GET /api/session` | Current browser's admin-session status |
| `POST /api/login`, `POST /api/logout` | Sign in / out |
| WebSocket `/live?id=UUID` | Room-specific spectator state snapshots |
| WebSocket `/live?id=UUID&channel=manager` | Assigned manager’s scoped live state |
| WebSocket `/live?id=UUID&channel=monitor` | Protected room-specific event stream |

POST requests and WebSocket upgrades must have an Origin matching Host. Browsers supply this automatically. Admin endpoints require an admin session cookie. Manager operations require a valid manager session for the requested UUID and one of `assign`, `unassign`, `score` or `finish`. The API enforces these restrictions independently of the displayed buttons. State messages identify their `tournamentId`; monitor messages include the persistent event record. Commands never target an implicit default tournament.

Source files:

- `server.js`: HTTP, sessions, room broadcasts, assets and commands.
- `store.js`: SQLite schema, transactions, event persistence and JSON migration.
- `engine.js`: Tournament, scoring, timer and machine rules.
- `models.js`, `models/`: Generic bracket generation and 16/32 configuration.
- `public/app.js`: Scoped admin and spectator pages.
- `public/portal.js`: Tournament creation/history and viewer ID entry.
- `public/terminal.js`: Protected green event-stream page.
- `test/`: Engine, database, HTTP/WebSocket and browser-DOM checks.

Run `npm test`. All **30 tests** passed during packaging, covering full 16/32 tournaments, scoring, clocks, migration, SQL rollback, stable UUIDs, independent room broadcasts, protected log access, archive/reopen, restart persistence, multi-page replay, history filtering, manager access boundaries and revocation, manager UI restrictions, decorative refresh isolation and terminal behavior. DOM tests simulate browser APIs. Visual layout, actual speaker output and fullscreen remain unverified because browser preview was unavailable.

The app does not connect directly to dartboard hardware or implement automatic 501 throw/checkout scoring. Admins enter numeric leg scores and winners.
