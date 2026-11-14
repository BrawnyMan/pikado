const app = document.querySelector("#app");
const gameId = new URLSearchParams(location.search).get("id");
const scoped = (path) => `${path}${path.includes("?") ? "&" : "?"}id=${encodeURIComponent(gameId)}`;
const managerMode = location.pathname === "/manager";
const admin = location.pathname === "/admin" || managerMode;
let actorRole = "viewer",
	managerAccess = { enabled: false },
	managerSecret = null;
const isAdmin = () => admin && !managerMode && actorRole === "admin";
function applySession(session) {
	actorRole = session.role || (session.authenticated ? "admin" : "viewer");
	authenticated = !!session.authenticated;
}
let state,
	authenticated = false,
	connection = "connecting",
	tab = "floor",
	pending = false;
let reconnectDelay = 1000,
	audio,
	soundEnabled = false,
	adInventory = { left: [], right: [] },
	seenLive = false;
const highlights = new Map(),
	dirtyForms = new Set();
let callout = null,
	modelsCatalog = [],
	planPlayer = "",
	planRound = "";
const editor = document.createElement("dialog");
editor.id = "editor";
document.body.append(editor);
let editorRevision, editorMatch;

const sample = [
	"Alex Morgan",
	"Jamie Taylor",
	"Sam Wilson",
	"Jordan Lee",
	"Casey Brown",
	"Riley Clark",
	"Taylor Smith",
	"Morgan Davis",
	"Charlie Evans",
	"Drew Walker",
	"Robin Hall",
	"Avery King",
	"Quinn Scott",
	"Cameron Green",
	"Jesse Adams",
	"Finley Baker",
];
const esc = (v) =>
	String(v ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
const name = (id) =>
	state.players.find((p) => p.id === id)?.name ||
	(id && state.phase === "setup" ? `Player ${id.slice(1)}` : "To be decided");
const round = (m) => state.roundNames[m.round - 1];
const initials = (id) =>
	name(id)
		.split(/\s+/)
		.map((n) => n[0])
		.slice(0, 2)
		.join("");
function toast(message) {
	if (editor.open) {
		const error = editor.querySelector(".editor-error");
		if (error) error.textContent = message;
	}
	const el = document.querySelector("#toast");
	el.textContent = message;
	el.classList.add("show");
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => el.classList.remove("show"), 5000);
}
async function post(path, data) {
	const response = await fetch(
		["/api/command", "/api/archive", "/api/manager-login", "/api/manager-access"].includes(path)
			? scoped(path)
			: path,
		{ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) },
	);
	const result = await response.json();
	if (!response.ok) {
		if (response.status === 401) {
			authenticated = false;
			actorRole = "viewer";
			managerSecret = null;
			render();
		}
		if (response.status === 409) {
			dirtyForms.clear();
			state = await (await fetch(scoped("/api/state"))).json();
			render();
		}
		throw new Error(result.error || "Request failed.");
	}
	return result;
}
async function command(data, revision = state.revision) {
	if (state.archived) {
		toast("This tournament is archived. Reopen it from the history screen.");
		return false;
	}
	if (pending || connection !== "live") {
		toast("Wait for the live connection before making changes.");
		return false;
	}
	pending = true;
	app.classList.add("busy");
	try {
		await post("/api/command", { ...data, revision });
		return true;
	} catch (error) {
		toast(error.message);
		return false;
	} finally {
		pending = false;
		app.classList.remove("busy");
	}
}
function connect() {
	const socket = new WebSocket(
		`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live?id=${encodeURIComponent(gameId)}${managerMode ? "&channel=manager" : ""}`,
	);
	socket.onopen = () => {
		connection = "live";
		reconnectDelay = 1000;
		render();
	};
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.type === "state" && (!message.tournamentId || message.tournamentId === gameId)) {
			receiveState(message.state);
		}
	};
	socket.onclose = (event) => {
		connection = "offline";
		if (event?.code === 4001) {
			authenticated = false;
			actorRole = "viewer";
			managerSecret = null;
			render();
			return;
		}
		render();
		setTimeout(connect, reconnectDelay);
		reconnectDelay = Math.min(reconnectDelay * 2, 10000);
	};
	socket.onerror = () => socket.close();
}
function playerRow(m, slot) {
	return `<div class="player-row"><span class="avatar">${esc(initials(m.players[slot]))}</span><span class="player-name">${esc(name(m.players[slot]))}</span><strong class="score">${m.score[slot]}</strong></div>`;
}
function legSummary(m) {
	return `<div class="leg-summary">${m.legs.map((l, i) => `<span class="${l.winnerId ? "played" : ""}" title="${l.winnerId ? esc(name(l.winnerId)) + " won" : "Not decided"}">L${i + 1} <b>${l.score.map((n) => (n === null ? "–" : n)).join(" : ")}</b>${l.winnerId ? ` · ${esc(name(l.winnerId).split(" ")[0])} ✓` : ""}</span>`).join("")}</div>`;
}
function machineCard(machine) {
	const m = state.matches.find((m) => m.status === "playing" && m.machineId === machine.id);
	return `<article data-match="${m?.id || ""}" class="machine ${m ? "active" : ""} ${m && isHighlighted(m.id) ? "new-call" : ""}"><div class="machine-head"><span class="machine-number">${String(machine.id).padStart(2, "0")}</span><div><h2>${esc(machine.name)}</h2><span class="eyebrow">${m ? `${round(m)} · ${m.id.toUpperCase()}` : "Ready for the next match"}</span></div><span class="status ${m ? "playing" : ""}">${m ? "In play" : "Available"}</span></div>${m ? `<div class="players">${playerRow(m, 0)}<div class="versus">VS</div>${playerRow(m, 1)}</div>${legSummary(m)}<div class="match-foot"><span>First to ${m.target} wins</span><span>Best of ${m.target * 2 - 1}</span></div><div class="match-timing"><span>Playing time</span><strong data-timer="${m.id}">${timerText(m)}</strong></div>${admin && authenticated ? `<div class="game-actions"><button data-action="scores" data-id="${m.id}">Enter leg scores</button>${isAdmin() ? `<button data-action="match-settings" data-id="${m.id}">Game settings</button>` : ""}</div><div class="finish-controls"><button class="winner-btn" data-action="finish" data-id="${m.id}" data-slot="0">${esc(name(m.players[0]).split(" ")[0])} wins ↗</button><button class="winner-btn" data-action="finish" data-id="${m.id}" data-slot="1">${esc(name(m.players[1]).split(" ")[0])} wins ↗</button></div><button class="text-button release" data-action="unassign" data-id="${m.id}">Return match to queue</button>` : ""}` : `<div class="empty-machine"><div class="target-icon"><i></i></div><strong>Oche is open</strong><p>${state.phase === "setup" ? "Waiting for the tournament to begin" : "The next match can be assigned here"}</p></div>`}</article>`;
}
function queue() {
	const ready = state.matches.filter((m) => m.status === "ready");
	const free = state.machines.filter(
		(b) => !state.matches.some((m) => m.status === "playing" && m.machineId === b.id),
	);
	return `<section class="queue-section"><div class="section-head"><div><span class="eyebrow">Stay close. You're on deck.</span><h2>Next up <span class="count">${ready.length}</span></h2></div><span class="muted">${admin ? "Choose a free machine to call a match" : "Please wait for your machine assignment"}</span></div>${ready.length ? `<div class="queue-table"><div class="queue-labels"><span>Order</span><span>Players</span><span>Round</span><span>${admin ? "Assign machine" : "Status"}</span></div>${ready.map((m, i) => `<div data-match="${m.id}" class="queue-row ${isHighlighted(m.id) ? "new-call" : ""}"><span class="queue-index">${String(i + 1).padStart(2, "0")}</span><div class="queue-players"><strong>${esc(name(m.players[0]))}</strong><span>vs</span><strong>${esc(name(m.players[1]))}</strong></div><span class="round-label">${round(m)}</span><div class="assignment">${isAdmin() ? `<button data-action="match-settings" data-id="${m.id}" title="Game settings">⚙</button>` : ""}${admin && authenticated ? (free.length ? free.map((b) => `<button data-action="assign" data-id="${m.id}" data-machine="${b.id}" title="Assign to ${esc(b.name)}">${String(b.id).padStart(2, "0")} ↗</button>`).join("") : '<span class="muted">All machines in play</span>') : '<span class="queue-status">Waiting</span>'}</div></div>`).join("")}</div>` : `<div class="empty-queue">${state.phase === "complete" ? "All matches complete. See you at the next tournament." : state.phase === "setup" ? "The waiting queue will appear when the tournament starts." : "No matches ready yet. Finish the matches in play to unlock the next round."}</div>`}</section>`;
}
function planMatches() {
	if (state.matches.length) return state.matches;
	const model = modelsCatalog.find((m) => m.id === state.modelId);
	return (model?.preview || []).map((m) => ({ ...m, target: state.roundTargets[m.round - 1] }));
}
function slotLabel(m, slot) {
	if (m.players[slot]) return esc(name(m.players[slot]));
	const source = m.sources?.[slot];
	return source?.matchId ? `Winner of ${source.matchId.toUpperCase()}` : "To be decided";
}
function timerText(m) {
	if (!m.timing || m.timing.elapsedMs === null) return "Not recorded";
	let seconds = Math.floor(
		(m.timing.elapsedMs + (m.timing.runningSince !== null ? Math.max(0, Date.now() - m.timing.runningSince) : 0)) /
			1000,
	);
	const hours = Math.floor(seconds / 3600),
		minutes = Math.floor((seconds % 3600) / 60);
	seconds %= 60;
	return `${m.timing.estimated ? "≈ " : ""}${hours ? hours + ":" : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function machineLabel(m) {
	const last = m.machineHistory?.at(-1);
	const machine = last?.machineName || state.machines.find((b) => b.id === m.machineId)?.name;
	if (m.status === "playing") return `Playing · ${machine || "Machine " + m.machineId}`;
	if (m.status === "finished") return `Played · ${machine || "Not recorded"}`;
	if (last) return `Last · ${last.machineName}`;
	if (m.plannedMachineId)
		return `Planned · ${state.machines.find((b) => b.id === m.plannedMachineId)?.name || "Machine " + m.plannedMachineId}`;
	return "Machine not assigned";
}
function machineHistory(m) {
	if (!m.machineHistory?.length) return "";
	const stamp = (value) =>
		value === null
			? "Time not recorded"
			: new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
	return `<details class="machine-history"><summary>Machine history (${m.machineHistory.length})</summary><ol>${m.machineHistory.map((v) => `<li><strong>${esc(v.machineName)}</strong><span>${esc(stamp(v.startedAt))} → ${v.endedAt === null ? (m.status === "playing" ? "In play" : "Not recorded") : esc(stamp(v.endedAt))}</span></li>`).join("")}</ol></details>`;
}
function bracket() {
	return `<div class="bracket-intro"><p>Compact overview. Scroll inside a round to see all games, or use Match plan for winner and loser routes.</p></div><section class="bracket compact-bracket">${state.roundNames
		.map(
			(label, i) =>
				`<section class="bracket-round"><h2>${esc(label)}</h2><div class="bracket-games">${planMatches()
					.filter((m) => m.round === i + 1)
					.map(
						(m) =>
							`<article class="bracket-match"><div class="bracket-top"><button class="match-link" data-action="focus-match" data-id="${m.id}">${m.id.toUpperCase()} ↗</button><span>${state.phase === "setup" ? "Planned" : m.status}</span></div>${[0, 1].map((slot) => `<div class="bracket-player ${m.players[slot] && m.winnerId === m.players[slot] ? "winner" : ""}"><span>${slotLabel(m, slot)}</span><strong>${m.score[slot]}</strong></div>`).join("")}<div class="bracket-meta"><span>${esc(machineLabel(m))}</span><span data-timer="${m.id}">${timerText(m)}</span></div>${m.status === "finished" ? `<details class="compact-details"><summary>Leg details</summary>${legSummary(m)}</details>` : ""}${isAdmin() && state.phase !== "setup" ? `<button class="text-button" data-action="match-settings" data-id="${m.id}">Game settings</button>` : ""}</article>`,
					)
					.join("")}</div></section>`,
		)
		.join("")}</section>`;
}
function playerPath(matches) {
	if (!planPlayer) return [];
	let m = matches.find(
		(m) => m.round === 1 && (m.players.includes(planPlayer) || m.sources?.some((s) => s.playerId === planPlayer)),
	);
	const path = [];
	while (m) {
		path.push(m);
		if (m.status === "finished" && m.winnerId !== planPlayer) break;
		m = m.winnerTo ? matches.find((n) => n.id === m.winnerTo.matchId) : null;
	}
	return path;
}
function planner() {
	const matches = planMatches(),
		players = state.players.length
			? state.players
			: Array.from({ length: state.playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));
	const path = playerPath(matches),
		ids = new Set(path.map((m) => m.id));
	const shown = matches.filter(
		(m) => (!planRound || m.round === Number(planRound)) && (!planPlayer || ids.has(m.id)),
	);
	return `<section class="planner"><div class="planner-head"><div><span class="eyebrow">Past games. Live games. Possible next games.</span><h2>Match plan</h2><p>${state.phase === "setup" ? "Model preview — enter your players to turn this into a live tournament." : "Future opponents fill in as earlier matches finish."} Winners advance. Losers are eliminated.</p></div>${isAdmin() ? `<div class="plan-downloads"><a class="download-link" href="/api/export?id=${esc(gameId)}" download>Download plan JSON ↓</a><a class="download-link" href="/api/models/${state.modelId}" download>Model JSON ↓</a></div>` : ""}</div><div class="plan-filters"><label>Follow a player<select id="plan-player"><option value="">All players / games</option>${players.map((p) => `<option value="${p.id}" ${planPlayer === p.id ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label><label>Bracket round<select id="plan-round"><option value="">All rounds</option>${state.roundNames.map((label, i) => `<option value="${i + 1}" ${planRound === String(i + 1) ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label><span class="muted">${shown.length} of ${matches.length} games · Preferred machines are plans, not reservations</span></div>${planPlayer ? `<div class="player-route"><strong>${esc(name(planPlayer))}'s route</strong><p>${path.map((m, i) => `${i ? " → " : ""}<button class="match-link" data-action="focus-row" data-id="${m.id}">${m.id.toUpperCase()}</button> <span>${m.status === "finished" ? (m.winnerId === planPlayer ? "won" : "lost · eliminated") : i ? "if previous games are won" : "current / opening game"}</span>`).join("")}${path.at(-1)?.winnerId === planPlayer && !path.at(-1)?.winnerTo ? " · Champion" : ""}</p></div>` : ""}<div class="plan-scroll"><table class="plan-table"><thead><tr><th>Game / round</th><th>Player A / source</th><th>Player B / source</th><th>Status & score</th><th>Machine / time</th><th>Winner goes to</th><th>Loser goes to</th></tr></thead><tbody>${shown.map((m) => `<tr id="plan-${m.id}" data-plan-match="${m.id}"><td><strong>${m.id.toUpperCase()}</strong><small>${esc(round(m))}</small>${isAdmin() && state.phase !== "setup" ? `<button class="text-button" data-action="match-settings" data-id="${m.id}">Settings</button>` : ""}</td>${[0, 1].map((slot) => `<td class="${m.players[slot] && m.winnerId === m.players[slot] ? "winner" : ""}">${slotLabel(m, slot)}${m.sources?.[slot]?.matchId ? `<small><button class="match-link" data-action="focus-match" data-id="${m.sources[slot].matchId}">From ${m.sources[slot].matchId.toUpperCase()}</button></small>` : ""}</td>`).join("")}<td><span class="plan-status">${state.phase === "setup" ? "planned" : m.status}</span><strong>${m.score.join(" – ")}</strong></td><td>${esc(machineLabel(m))}<small data-timer="${m.id}">${timerText(m)}</small>${machineHistory(m)}</td><td>${m.winnerTo ? `<button class="match-link" data-action="focus-match" data-id="${m.winnerTo.matchId}">${m.winnerTo.matchId.toUpperCase()} · slot ${m.winnerTo.slot === 0 ? "A" : "B"} ↗</button>` : "🏆 Champion"}</td><td>${m.loserTo ? esc(m.loserTo.matchId) : "Eliminated"}</td></tr>`).join("")}</tbody></table></div></section>`;
}
function setup() {
	return `<section class="setup-panel"><div><span class="eyebrow">Let's get throwing</span><h2>Set up your tournament</h2><p>${state.playerCount} players. ${state.machines.length} machines. One champion.</p><p>Choose 16 or 32 players. Enter one player per line. Players 1 & 2 meet first, then 3 & 4, and so on. Default: first to ${state.roundTargets[0]} wins. Change each bracket round in Settings.</p><label for="model-choice">Tournament model</label><select id="model-choice"><option value="single-16" ${state.modelId === "single-16" ? "selected" : ""}>16 players · 15 games</option><option value="single-32" ${state.modelId === "single-32" ? "selected" : ""}>32 players · 31 games</option></select><button class="secondary" data-action="sample">Use sample players</button></div><form id="setup"><label for="title">Tournament name</label><input id="title" name="title" maxlength="80" value="${esc(state.title)}" required><label for="names">Players <span class="muted">· ${state.playerCount} names, one per line</span></label><textarea id="names" name="names" rows="10" placeholder="Alex Morgan&#10;Jamie Taylor&#10;…" required></textarea><button class="primary" type="submit">Start tournament ↗</button></form></section>`;
}
function login() {
	return `<section class="login-panel"><span class="eyebrow">Tournament control</span><h2>${managerMode ? "Manager sign in" : "Admin sign in"}</h2><p>${managerMode ? "Use the manager password supplied by the admin for this tournament." : "Use the password from your server's .env file or startup output."}</p><form id="login"><label for="password">${managerMode ? "Manager" : "Admin"} password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button class="primary">Sign in ↗</button></form><a href="/view?id=${esc(gameId)}">Open spectator display ↗</a></section>`;
}
function render() {
	if (!state) return;
	const savedForms = new Map(
		[...app.querySelectorAll("form[id]")]
			.filter((f) => dirtyForms.has(f.id))
			.map((f) => [f.id, [...new FormData(f)]]),
	);
	const finished = state.matches.filter((m) => m.status === "finished");
	const playing = state.matches.filter((m) => m.status === "playing").length;
	const champion = state.matches.find((m) => !m.winnerTo)?.winnerId;
	app.innerHTML = `<header class="topbar"><a class="brand" href="/view?id=${esc(gameId)}"><span class="brand-mark">◎</span>DARTS<span class="brand-live">LIVE</span></a><div class="top-right"><span class="connection ${connection}"><i></i>${connection === "live" ? "Live updates" : connection === "offline" ? "Reconnecting · display may be outdated" : "Connecting"}</span>${admin ? `<a href="/view?id=${esc(gameId)}" target="_blank" rel="noopener">Open display ↗</a>` : `<button class="text-button" data-action="sound">${soundEnabled ? "Sound on ♫" : "Enable sound ♫"}</button><button class="text-button" data-action="fullscreen">Fullscreen ⛶</button><a href="/${actorRole === "manager" ? "manager" : "admin"}?id=${esc(gameId)}">${actorRole === "manager" ? "Manager" : "Admin"} ↗</a>`}</div></header><main><div class="event-context"><span>EVENT <code>${esc(gameId)}</code>${state.archived ? " · ARCHIVED / READ ONLY" : ""}</span><div>${isAdmin() ? '<a href="/admin">Tournament history ↗</a>' : ""}${isAdmin() ? `<a href="/terminal?id=${esc(gameId)}" target="_blank" rel="noopener">Live terminal ↗</a>` : ""}</div></div><div class="hero"><div><span class="eyebrow accent">${admin ? (isAdmin() ? "Admin control" : "Game manager") : "Live from the oche"} <span class="small-line"></span> ${state.playerCount}-player knockout</span><h1>${esc(state.title)}</h1><p>${admin ? "Call the matches. Keep the floor moving." : `${state.machines.length} machines. One champion. Every leg counts.`}</p></div><div class="hero-right"><div class="hero-stat"><strong>${String(finished.length).padStart(2, "0")}<span>/${state.playerCount - 1}</span></strong><span class="eyebrow">Matches complete</span></div><div class="hero-stat"><strong>${playing}<span>/${state.machines.length}</span></strong><span class="eyebrow">Machines in play</span></div></div></div>${connection === "offline" ? '<div class="offline-banner" role="alert">Connection lost. Scores may be outdated; admin changes are paused until reconnection.</div>' : ""}${
		admin && !authenticated
			? login()
			: `${champion ? `<section class="champion"><span class="eyebrow">Your tournament champion</span><h2>🏆 ${esc(name(champion))}</h2><p>Winner of ${esc(state.title)}</p></section>` : ""}${isAdmin() && state.phase === "setup" ? setup() : admin && state.phase === "setup" ? '<div class="offline-banner">Waiting for the admin to set up and start this tournament.</div>' : ""}<div class="view-toolbar"><nav aria-label="Display view"><button class="tab ${tab === "floor" ? "selected" : ""}" data-action="tab" data-tab="floor">The floor</button><button class="tab ${tab === "bracket" ? "selected" : ""}" data-action="tab" data-tab="bracket">Compact bracket</button><button class="tab ${tab === "plan" ? "selected" : ""}" data-action="tab" data-tab="plan">Match plan</button>${isAdmin() ? `<button class="tab ${tab === "settings" ? "selected" : ""}" data-action="tab" data-tab="settings">Settings</button>` : ""}</nav>${isAdmin() ? `<div class="admin-tools"><button class="text-button" data-action="undo">↶ Undo last action</button><button class="text-button" data-action="new-event">New tournament</button><button class="text-button" data-action="archive">${state.archived ? "Reopen" : "Archive"}</button><button class="text-button" data-action="logout">Sign out</button></div>` : admin ? `<div class="admin-tools"><span class="manager-badge">THIS TOURNAMENT ONLY</span><button class="text-button" data-action="logout">Sign out</button></div>` : `<span class="muted">${state.phase === "setup" ? "Waiting to start" : state.phase === "complete" ? "Tournament complete" : "Tournament in progress"}</span>`}</div>${tab === "settings" && isAdmin() ? settingsPanel() : tab === "plan" ? planner() : tab === "floor" ? `<section class="machines" aria-label="Dart machines">${state.machines.map(machineCard).join("")}</section>${!admin ? `<div class="queue-layout ${state.ads.enabled ? "" : "no-ads"}">${adPanel("left")}${queue()}${adPanel("right")}</div>` : queue()}` : bracket()}${
					finished.length
						? `<section class="results"><div class="section-head"><h2>Latest results</h2><span class="eyebrow">${finished.length} played</span></div><div class="result-list">${[
								...finished,
							]
								.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt))
								.slice(0, 5)
								.map(
									(m) =>
										`<div><span class="result-check">✓</span><strong>${esc(name(m.winnerId))}</strong><span>def. ${esc(name(m.players.find((p) => p !== m.winnerId)))}</span><b>${m.score.join(" – ")}</b><span class="muted">${round(m)} · ${esc(machineLabel(m))} · <span data-timer="${m.id}">${timerText(m)}</span></span></div>`,
								)
								.join("")}</div></section>`
						: ""
				}`
	}</main><footer><span>◎ DARTS LIVE</span><span>Single elimination · Formats set by bracket round · Queue ordered by round and match</span><span>Server revision ${state.revision}</span></footer>`;
	for (const form of app.querySelectorAll("form[id]")) {
		if (!form.elements.namedItem("revision")) {
			const input = document.createElement("input");
			input.type = "hidden";
			input.name = "revision";
			input.value = state.revision;
			form.append(input);
		}
		for (const [key, value] of savedForms.get(form.id) || []) {
			const field = form.elements.namedItem(key);
			if (field) field.value = value;
		}
	}
	updateViewerWidgets();
}
function isHighlighted(id) {
	return !admin && (highlights.get(id) || 0) > Date.now();
}
function receiveState(next) {
	if (!admin && seenLive && state) {
		const called = next.matches.filter(
			(m) =>
				m.status === "playing" &&
				m.callId &&
				Date.now() - (m.calledAt || 0) < 15000 &&
				m.callId !== state.matches.find((old) => old.id === m.id)?.callId,
		);
		const before = state.matches.filter((m) => m.status === "ready"),
			after = next.matches.filter((m) => m.status === "ready");
		const fresh = after.filter((m) => !before.some((old) => old.id === m.id));
		const headChanged = after.length > 0 && before[0]?.id !== after[0]?.id;
		for (const m of [...called, ...fresh, ...(headChanged ? [after[0]] : [])])
			highlights.set(m.id, Date.now() + 10000);
		if (called.length || fresh.length || headChanged) {
			const m = called[0] || after[0];
			callout = m
				? { id: m.id, machineId: called.length ? m.machineId : null, expiresAt: Date.now() + 10000 }
				: null;
			chime();
		}
	}
	state = next;
	seenLive = true;
	render();
}
async function chime() {
	if (admin || !soundEnabled || !audio) return;
	try {
		await audio.resume();
		for (const [i, f] of [660, 880].entries()) {
			const oscillator = audio.createOscillator(),
				gain = audio.createGain(),
				t = audio.currentTime + i * 0.22;
			oscillator.frequency.value = f;
			gain.gain.setValueAtTime(0.0001, t);
			gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
			oscillator.connect(gain);
			gain.connect(audio.destination);
			oscillator.start(t);
			oscillator.stop(t + 0.2);
		}
	} catch {
		soundEnabled = false;
	}
}
function adPanel(side) {
	return state.ads.enabled
		? `<aside class="ad-panel" aria-label="${side} sponsors"><span class="eyebrow">Our partners</span><div class="ad-frame" data-ad="${side}"></div></aside>`
		: "";
}
async function loadAds() {
	try {
		const response = await fetch("/api/ads");
		if (response.ok) adInventory = await response.json();
		const count = document.querySelector("#ad-count");
		if (count) count.textContent = `${adInventory.left.length} left · ${adInventory.right.length} right`;
		updateViewerWidgets();
	} catch {}
}
function updateViewerWidgets() {
	for (const node of app.querySelectorAll("[data-timer]")) {
		const m = state?.matches.find((m) => m.id === node.dataset.timer);
		if (m) node.textContent = timerText(m);
	}
	for (const side of ["left", "right"]) {
		const host = app.querySelector(`[data-ad="${side}"]`);
		if (!host) continue;
		const list = adInventory[side] || [],
			src = list.length ? list[Math.floor(Date.now() / (state.ads.intervalSeconds * 1000)) % list.length] : null;
		if (src && host.dataset.src !== src) {
			host.replaceChildren();
			const img = document.createElement("img");
			img.src = src;
			img.alt = `${side} sponsor advertisement`;
			img.onerror = () => {
				host.textContent = "Sponsor image unavailable";
			};
			host.append(img);
			host.dataset.src = src;
		}
		if (!src) {
			host.dataset.src = "";
			host.textContent = "Your next great partner";
		}
	}
	if (admin) return;
	let notice = document.querySelector("#announcement");
	const a = state?.announcement,
		visible = a && (!a.expiresAt || a.expiresAt > Date.now());
	if (visible) {
		if (!notice) {
			notice = document.createElement("div");
			notice.id = "announcement";
			notice.setAttribute("role", "status");
			notice.setAttribute("aria-live", "polite");
			document.body.append(notice);
		}
		if (notice.dataset.id !== a.id) {
			notice.replaceChildren();
			const label = document.createElement("span");
			label.className = "eyebrow";
			label.textContent = "From tournament control";
			const text = document.createElement("p");
			text.textContent = a.text;
			notice.append(label, text);
			notice.dataset.id = a.id;
		}
	} else notice?.remove();
	let banner = document.querySelector("#next-call");
	if (callout && callout.expiresAt > Date.now()) {
		const m = state.matches.find((m) => m.id === callout.id);
		if (
			m &&
			(callout.machineId ? m.status === "playing" && m.machineId === callout.machineId : m.status === "ready")
		) {
			if (!banner) {
				banner = document.createElement("div");
				banner.id = "next-call";
				banner.setAttribute("role", "status");
				document.body.append(banner);
			}
			banner.textContent = `${callout.machineId ? "Now playing · Machine " + String(callout.machineId).padStart(2, "0") : "Next up"}: ${name(m.players[0])} vs ${name(m.players[1])}`;
		} else banner?.remove();
	} else banner?.remove();
	for (const node of app.querySelectorAll(".new-call"))
		if (!isHighlighted(node.dataset.match)) node.classList.remove("new-call");
}
function settingsPanel() {
	return `<section class="settings-grid"><article class="setting-card"><span class="eyebrow">Tournament staff</span><h2>Manager access</h2><p>A manager can assign games, return games to the queue, enter scores and confirm winners in this tournament only. History, exports, settings and other tournaments stay admin-only.</p><p>Status: <strong>${managerAccess.enabled ? "Enabled" : "Disabled"}</strong></p><label for="manager-link">Manager page</label><input id="manager-link" readonly value="${esc(location.origin + "/manager?id=" + gameId)}"><div class="manager-access-actions"><button data-action="generate-manager">${managerAccess.enabled ? "Replace" : "Generate"} manager password</button><button data-action="revoke-manager" ${managerAccess.enabled ? "" : "disabled"}>Revoke access</button></div>${managerSecret ? `<label for="manager-password">New password — shown only until this page is closed or reloaded</label><input id="manager-password" readonly value="${esc(managerSecret)}"><p>Share this password with the manager separately from the link. Replacing it ends older manager sessions.</p>` : ""}</article><article class="setting-card"><span class="eyebrow">The floor</span><h2>Dart machines <span class="count">${state.machines.length}/7</span></h2><p>Keep 2–7 machines. Return an active game to the queue before removing its machine.</p><div class="machine-settings">${state.machines
		.map((b) => {
			const busy = state.matches.some((m) => m.status === "playing" && m.machineId === b.id);
			return `<div><strong>${esc(b.name)}</strong><span class="muted">${busy ? "In play" : "Available"}</span><button data-action="remove-machine" data-machine="${b.id}" ${busy || state.machines.length <= 2 ? "disabled" : ""}>Remove</button></div>`;
		})
		.join(
			"",
		)}</div><button data-action="add-machine" ${state.machines.length >= 7 ? "disabled" : ""}>+ Add machine</button></article>
  <article class="setting-card"><span class="eyebrow">Match formats</span><h2>Wins needed by bracket round</h2><p>First to 2 means best of 3. Changes apply to unstarted, unscored matches. Active games and game-specific overrides keep their format.</p><form id="round-settings">${state.roundTargets.map((n, i) => `<label for="target-${i}">${esc(state.roundNames[i])}</label><input id="target-${i}" name="target-${i}" type="number" min="1" max="9" value="${n}" required>`).join("")}<button class="primary">Save formats</button></form></article>
  <article class="setting-card"><span class="eyebrow">Spectator display</span><h2>Send an announcement</h2><p>Show a message in the middle of every viewer screen.</p><form id="announce"><label for="message">Message</label><textarea id="message" name="text" rows="3" maxlength="500" required placeholder="Quarterfinal players, please report to the desk."></textarea><label for="duration">Display time</label><select id="duration" name="seconds"><option value="15">15 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="0">Until cleared</option></select><button class="primary">Push to viewers ↗</button></form><button class="secondary" data-action="clear-announcement">Clear message</button></article>
  <article class="setting-card"><span class="eyebrow">Sponsors</span><h2>Rotating side ads</h2><p>Add PNG, JPG, WEBP or GIF files to <code>ads/left/</code> and <code>ads/right/</code> beside server.js. Files rotate alphabetically and new filenames appear within 15 seconds.</p><p id="ad-count">${adInventory.left.length} left · ${adInventory.right.length} right</p><form id="display-settings"><label for="ads-enabled">Show ads beside the waiting queue</label><select id="ads-enabled" name="enabled"><option value="true" ${state.ads.enabled ? "selected" : ""}>Enabled</option><option value="false" ${!state.ads.enabled ? "selected" : ""}>Hidden</option></select><label for="ad-interval">Seconds per image</label><input id="ad-interval" name="intervalSeconds" type="number" min="2" max="60" value="${state.ads.intervalSeconds}" required><button class="primary">Save ad settings</button></form></article></section>`;
}
function openEditor(m, mode) {
	if (mode !== "scores" && !isAdmin()) return toast("Game settings are admin-only.");
	editorRevision = state.revision;
	editorMatch = structuredClone(m);
	if (mode === "scores") {
		editor.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">${round(m)} · ${m.id.toUpperCase()}</span><h2>Leg scores</h2></div><button data-close aria-label="Close">×</button></div><p>First to ${m.target} wins · up to ${m.target * 2 - 1} legs. Enter optional numeric scores and select each leg winner. Leave unplayed legs blank. Numeric scores do not decide the winner automatically.</p><form id="leg-editor" data-id="${m.id}"><div class="leg-grid"><strong>Leg</strong><strong>${esc(name(m.players[0]))}</strong><strong>${esc(name(m.players[1]))}</strong><strong>Leg winner</strong>${m.legs.map((l, i) => `<span>Leg ${i + 1}</span>${l.score.map((value, slot) => `<input aria-label="Leg ${i + 1}, ${esc(name(m.players[slot]))} score" type="number" name="score-${i}-${slot}" min="0" max="9999" value="${value ?? ""}">`).join("")}<select name="winner-${i}" aria-label="Leg ${i + 1} winner"><option value="">Not played / undecided</option>${m.players.map((p) => `<option value="${p}" ${l.winnerId === p ? "selected" : ""}>${esc(name(p))}</option>`).join("")}</select>`).join("")}</div><p class="editor-error" role="alert"></p><div class="dialog-actions"><button class="secondary" type="submit" name="intent" value="score">Save leg scores</button><button class="primary" type="submit" name="intent" value="finish">Save & finish match ↗</button></div></form>`;
	} else {
		editor.innerHTML = `<div class="dialog-head"><div><span class="eyebrow">${m.id.toUpperCase()} · game settings</span><h2>Players & format</h2></div><button data-close aria-label="Close">×</button></div><p>Names update everywhere. Player IDs and bracket positions stay the same.</p><form id="match-editor" data-id="${m.id}">${
			m.players
				.filter(Boolean)
				.map(
					(p) =>
						`<label for="name-${p}">Player <code>${p}</code></label><input id="name-${p}" name="${p}" value="${esc(name(p))}" maxlength="60" required>`,
				)
				.join("") || "<p>Players will appear when earlier matches finish.</p>"
		}<label for="planned-machine">Preferred machine (planning only)</label><select id="planned-machine" name="plannedMachineId" ${["playing", "finished"].includes(m.status) ? "disabled" : ""}><option value="">Not planned</option>${state.machines.map((b) => `<option value="${b.id}" ${m.plannedMachineId === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select><p class="muted">${esc(machineLabel(m))} · Playing time: ${timerText(m)}</p>${machineHistory(m)}<label for="game-target">Wins needed (best of <span id="best-of">${m.target * 2 - 1}</span>)</label><input id="game-target" name="target" type="number" min="1" max="9" value="${m.target}" ${m.status === "finished" ? "readonly" : ""} required><p class="editor-error" role="alert"></p><button class="primary">Save game settings</button></form>`;
	}
	editor.showModal();
}
editor.addEventListener("click", (e) => {
	if (e.target.closest("[data-close]") && !pending) editor.close();
});
editor.addEventListener("input", (e) => {
	if (e.target.name === "target") editor.querySelector("#best-of").textContent = Number(e.target.value) * 2 - 1;
});
editor.addEventListener("submit", async (event) => {
	event.preventDefault();
	const f = event.target,
		data = new FormData(f),
		m = editorMatch;
	let payload;
	if (f.id === "match-editor")
		payload = {
			type: "match-settings",
			matchId: m.id,
			target: Number(data.get("target")),
			plannedMachineId: ["playing", "finished"].includes(m.status)
				? m.plannedMachineId
				: data.get("plannedMachineId")
					? Number(data.get("plannedMachineId"))
					: null,
			players: m.players.filter(Boolean).map((id) => ({ id, name: String(data.get(id)) })),
		};
	else {
		const legs = m.legs.map((_, i) => ({
			score: [0, 1].map((slot) => {
				const v = data.get(`score-${i}-${slot}`);
				return v === "" ? null : Number(v);
			}),
			winnerId: data.get(`winner-${i}`) || null,
		}));
		payload = { type: event.submitter?.value === "finish" ? "finish" : "score", matchId: m.id, legs };
		if (
			payload.type === "finish" &&
			!confirm("Finish this match using the recorded leg winners and advance the winner?")
		)
			return;
	}
	editor.querySelector(".editor-error").textContent = "";
	if (await command(payload, editorRevision)) editor.close();
	else
		editor.querySelector(".editor-error").textContent +=
			" Close and reopen this editor if the tournament changed on another screen.";
});
app.addEventListener("input", (event) => {
	const form = event.target.closest("form[id]");
	if (form) dirtyForms.add(form.id);
});
app.addEventListener("change", (event) => {
	const form = event.target.closest("form[id]");
	if (form) dirtyForms.add(form.id);
});
app.addEventListener("click", async (event) => {
	const b = event.target.closest("[data-action]");
	if (!b || b.disabled) return;
	const { action, id } = b.dataset;
	const m = state.matches.find((m) => m.id === id);
	if (action === "tab") {
		tab = b.dataset.tab;
		return render();
	}
	if (["generate-manager", "revoke-manager"].includes(action)) {
		if (!isAdmin()) return;
		if (
			!confirm(
				action === "generate-manager"
					? "Generate a new manager password? Existing manager sessions will end."
					: "Revoke manager access and end its sessions?",
			)
		)
			return;
		try {
			const result = await post("/api/manager-access", {
				enabled: action === "generate-manager",
				revision: state.revision,
			});
			managerAccess = { enabled: result.enabled };
			managerSecret = result.password;
			render();
		} catch (error) {
			toast(error.message);
		}
		return;
	}
	if (action === "focus-match" || action === "focus-row") {
		if (action === "focus-match") {
			planPlayer = "";
			planRound = "";
		}
		tab = "plan";
		render();
		const row = document.getElementById(`plan-${id}`);
		if (row) {
			row.classList.add("focused-game");
			row.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
		}
		return;
	}
	if (action === "sound") {
		if (soundEnabled) {
			soundEnabled = false;
		} else {
			try {
				audio ??= new (window.AudioContext || window.webkitAudioContext)();
				await audio.resume();
				soundEnabled = true;
				chime();
			} catch {
				toast("Sound could not be enabled in this browser.");
			}
		}
		render();
		return;
	}
	if (action === "fullscreen") {
		try {
			if (document.fullscreenElement) await document.exitFullscreen();
			else await document.documentElement.requestFullscreen();
		} catch {
			toast("Fullscreen is not available in this browser.");
		}
		return;
	}
	if (action === "scores" || action === "match-settings") return openEditor(m, action);
	if (action === "sample") {
		document.querySelector("#names").value = Array.from(
			{ length: state.playerCount },
			(_, i) => sample[i] || `Player ${i + 1}`,
		).join("\n");
		dirtyForms.add("setup");
		return;
	}
	if (action === "logout") {
		try {
			await post("/api/logout", {});
			authenticated = false;
			actorRole = "viewer";
			managerSecret = null;
			editor.close();
			render();
		} catch (e) {
			toast(e.message);
		}
		return;
	}
	if (action === "add-machine") return command({ type: action });
	if (action === "remove-machine" && confirm("Remove this machine from the floor?"))
		return command({ type: action, machineId: Number(b.dataset.machine) });
	if (action === "clear-announcement") return command({ type: action });
	if (action === "assign") return command({ type: "assign", matchId: id, machineId: Number(b.dataset.machine) });
	if (
		action === "unassign" &&
		confirm("Return this match to the waiting queue? Its recorded leg scores will be kept.")
	)
		return command({ type: "unassign", matchId: id });
	if (action === "finish") {
		const slot = Number(b.dataset.slot),
			opponent = 1 - slot;
		if (m.score[opponent] >= m.target)
			return toast("The other player already has enough wins. Correct the leg winners first.");
		const legs = structuredClone(m.legs);
		let wins = m.score[slot];
		for (const leg of legs)
			if (!leg.winnerId && wins < m.target) {
				leg.winnerId = m.players[slot];
				wins++;
			}
		if (
			confirm(
				`Confirm ${name(m.players[slot])} wins ${m.target}–${m.score[opponent]}? Unrecorded winning legs will be added; numeric scores remain optional. Use Enter leg scores for detailed results.`,
			)
		)
			return command({ type: "finish", matchId: id, legs });
	}
	if (
		action === "undo" &&
		confirm("Undo the most recent server action, including any settings or announcement changes?")
	)
		return command({ type: "undo" });
	if (action === "new-event" && confirm("Create a separate tournament? This event and its history will be kept.")) {
		try {
			const result = await post("/api/tournaments", {
				title: "New tournament",
				modelId: state.modelId,
				copyFrom: gameId,
			});
			location.href = `/admin?id=${encodeURIComponent(result.id)}`;
		} catch (error) {
			toast(error.message);
		}
		return;
	}
	if (
		action === "archive" &&
		confirm(
			state.archived
				? "Reopen this tournament for editing?"
				: "Archive this tournament as read-only? Active games must be returned to the queue first.",
		)
	) {
		try {
			await post("/api/archive", { archived: !state.archived, revision: state.revision });
		} catch (error) {
			toast(error.message);
		}
		return;
	}
});
app.addEventListener("submit", async (event) => {
	event.preventDefault();
	const form = event.target,
		data = new FormData(form),
		revision = Number(data.get("revision"));
	let payload;
	if (form.id === "login") {
		try {
			const result = await post(managerMode ? "/api/manager-login" : "/api/login", {
				password: data.get("password"),
			});
			applySession({ authenticated: true, ...result });
			dirtyForms.delete("login");
			if (isAdmin()) await loadManagerAccess();
			render();
			if (connection !== "live") connect();
		} catch (e) {
			toast(e.message);
		}
		return;
	}
	if (form.id === "setup") {
		const names = String(data.get("names"))
			.split(/\r?\n/)
			.map((n) => n.trim())
			.filter(Boolean);
		if (names.length !== state.playerCount)
			return toast(`Enter exactly ${state.playerCount} names. You have ${names.length}.`);
		if (!confirm("Start the tournament using this player order?")) return;
		payload = { type: "start", modelId: state.modelId, title: String(data.get("title")), names };
	}
	if (form.id === "round-settings")
		payload = { type: form.id, targets: state.roundTargets.map((_, i) => Number(data.get(`target-${i}`))) };
	if (form.id === "display-settings")
		payload = {
			type: form.id,
			enabled: data.get("enabled") === "true",
			intervalSeconds: Number(data.get("intervalSeconds")),
		};
	if (form.id === "announce")
		payload = { type: "announce", text: String(data.get("text")), seconds: Number(data.get("seconds")) };
	if (payload && (await command(payload, form.id === "setup" ? state.revision : revision))) {
		dirtyForms.delete(form.id);
		render();
		toast("Saved and sent to viewers.");
	}
});
async function loadManagerAccess() {
	try {
		const response = await fetch(scoped("/api/manager-access"));
		if (response.ok) managerAccess = await response.json();
	} catch {}
}
setInterval(() => {
	if (state) updateViewerWidgets();
}, 500);
setInterval(loadAds, 15000);
await loadAds();
try {
	modelsCatalog = await (await fetch("/api/models")).json();
} catch {}
try {
	const [s, session] = await Promise.all([
		fetch(scoped("/api/state")).then(async (r) => {
			if (!r.ok) throw new Error("Tournament unavailable");
			return r.json();
		}),
		fetch("/api/session").then((r) => r.json()),
	]);
	state = s;
	applySession(session);
	if (isAdmin()) await loadManagerAccess();
	render();
} catch {
	app.textContent = "Unable to load the tournament. Check the ID or open /admin to choose an event.";
}
if (state && !state.error) {
	if (!managerMode || authenticated) connect();
} else if (managerMode) {
	app.innerHTML = `<main>${login()}</main>`;
} else {
	app.innerHTML =
		'<main><h1>Tournament unavailable</h1><p>Check the ID in your link.</p><a href="/admin">Open tournament history ↗</a></main>';
}

app.addEventListener("change", async (event) => {
	if (event.target.id === "model-choice") {
		planPlayer = "";
		planRound = "";
		await command({ type: "select-model", modelId: event.target.value });
	}
	if (event.target.id === "plan-player") {
		planPlayer = event.target.value;
		render();
	}
	if (event.target.id === "plan-round") {
		planRound = event.target.value;
		render();
	}
});
