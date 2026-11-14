const root = document.querySelector("#terminal"),
	id = new URLSearchParams(location.search).get("id"),
	events = new Map();
let ambientEnabled = true,
	ambientCycle = 0;
let socket,
	paused = false,
	filter = "",
	title = "",
	connected = false,
	retry = 1000,
	initialized = false,
	recoveryCursor = 0,
	loadingOlder = false,
	authenticated = false;
const scope = (p) => `${p}?id=${encodeURIComponent(id)}`;
const esc = (v) =>
	String(v ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
async function request(url, data) {
	const r = await fetch(
			url,
			data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {},
		),
		v = await r.json();
	if (!r.ok) {
		if (r.status === 401) authenticated = false;
		throw new Error(v.error);
	}
	return v;
}
function status(message) {
	const node = root.querySelector("#terminal-status");
	if (node) {
		node.textContent = message;
		node.classList.toggle("connected", connected);
	}
}
function rows(force = false) {
	const counter = root.querySelector("#log-count");
	if (counter) counter.textContent = events.size;
	if (paused && !force) {
		status(connected ? "LIVE · DISPLAY PAUSED" : "OFFLINE · DISPLAY PAUSED");
		return;
	}
	const out = root.querySelector("#log-output");
	if (!out) return;
	const all = [...events.values()].sort((a, b) => a.id - b.id),
		visible = all.filter((e) =>
			`${e.type} ${e.message} ${e.matchId || ""} ${e.matchUuid || ""} ${JSON.stringify(e.payload)}`
				.toLowerCase()
				.includes(filter.toLowerCase()),
		);
	out.innerHTML = visible.length
		? visible
				.map(
					(e) =>
						`<article class="log-entry"><span class="log-time">${esc(new Date(e.createdAt).toLocaleTimeString())}<small>${esc(new Date(e.createdAt).toLocaleDateString())}<br>#${e.id}</small></span><span class="log-kind">${esc(e.type.toUpperCase())}<small>rev ${e.revision}</small></span><div><p>${esc(e.message)}</p><details><summary>${e.matchId ? `${esc(e.matchId.toUpperCase())} · ${esc(e.matchUuid)} · ` : ""}EVENT ${esc(e.uuid)} · payload</summary><pre>${esc(JSON.stringify(e.payload, null, 2))}</pre></details></div></article>`,
				)
				.join("")
		: '<p class="terminal-empty">No matching events. Waiting for tournament activity<span class="terminal-cursor">▌</span></p>';
	const rev = root.querySelector("#log-revision");
	if (rev) rev.textContent = all.at(-1)?.revision ?? 0;
	if (!paused && !loadingOlder) out.scrollTop = out.scrollHeight;
}
function add(list) {
	for (const e of list) if (e.tournamentId === id) events.set(e.id, e);
	rows();
}
function layout() {
	root.innerHTML = `<header class="terminal-top"><a href="/admin">◎ DARTS LIVE / OBSERVATORY</a><div><a href="/admin?id=${esc(id)}">Admin ↗</a><a href="/view?id=${esc(id)}" target="_blank" rel="noopener">Viewer ↗</a><button data-action="logout">Sign out</button></div></header><main class="terminal-main"><section class="terminal-hero"><div><span class="terminal-label">TOURNAMENT TELEMETRY / LIVE EVENT STREAM</span><h1>${esc(title)}</h1><p>ROOM <code>${esc(id)}</code></p></div><span id="terminal-status">CONNECTING</span></section><section class="ambient-panel"><div class="ambient-head"><span>VISUAL ONLY / SYNTHETIC TELEMETRY · REFRESHES EVERY 5 SECONDS</span><button data-action="ambient">Pause visuals</button></div><div id="ambient-output" aria-label="Decorative terminal simulation"></div><p>Decorative simulation · generated in this browser · never saved or exported</p></section><section class="terminal-panel"><div class="terminal-window-bar"><span class="terminal-dots">● ● ●</span><span>events.log / persistent history + WebSocket</span><span><b id="log-count">0</b> loaded · revision <b id="log-revision">0</b></span></div><div class="terminal-tools"><label>FILTER<input id="log-filter" type="search" placeholder="Match, player, event or UUID"></label><button data-action="pause">Pause display</button><button data-action="older">Load older events</button><a href="/api/events/export?id=${esc(id)}" download>Export full log ↓</a></div><div id="log-output" tabindex="0" aria-label="Tournament event log"></div><div class="terminal-bottom"><span>AUTHORITATIVE SERVER EVENTS · NO CREDENTIALS LOGGED</span><span class="terminal-cursor">STREAM READY ▌</span></div></section><p class="terminal-note">Each row is a saved server event. Reconnecting catches up after the last known event; new socket subscriptions also receive a fresh state snapshot on the tournament screens.</p></main>`;
}
function ambientFrame() {
	const output = root.querySelector("#ambient-output");
	if (!output || !ambientEnabled) return;
	ambientCycle++;
	const hex = () =>
		Math.floor(Math.random() * 0xffffffff)
			.toString(16)
			.padStart(8, "0")
			.toUpperCase();
	const labels = ["VECTOR MESH", "PHOTON CACHE", "ECHO MATRIX", "ORBITAL BUS", "NEON BUFFER", "PULSE FIELD"];
	output.innerHTML = labels
		.map((label) => {
			const n = Math.floor(Math.random() * 100);
			return `<div class="ambient-cell"><span>${label}</span><code>${hex()} : ${hex()}</code><meter min="0" max="100" value="${n}"></meter><small>SIM ${String(ambientCycle).padStart(4, "0")} / ${n}%</small></div>`;
		})
		.join("");
}
setInterval(ambientFrame, 5000);
function login(error = "") {
	root.innerHTML = `<header class="terminal-top"><a href="/admin">◎ DARTS LIVE / OBSERVATORY</a></header><section class="login-panel"><span class="eyebrow">Protected event log</span><h2>Terminal access</h2><p>${esc(error || "Sign in with the admin password to inspect this tournament’s saved event history.")}</p><form id="terminal-login"><label for="terminal-password">Admin password</label><input id="terminal-password" type="password" name="password" autocomplete="current-password" required><button class="primary">Connect ↗</button></form></section>`;
}
async function catchUp() {
	let cursor = initialized ? recoveryCursor : 0;
	try {
		do {
			const list = await request(scope("/api/events") + (cursor ? `&after=${cursor}` : ""));
			add(list);
			if (!initialized || list.length < 200) break;
			cursor = list.at(-1).id;
		} while (true);
		initialized = true;
	} catch (error) {
		if (!authenticated) {
			socket?.close();
			login(error.message);
		} else status("HISTORY FETCH FAILED · RECONNECT OR RELOAD");
	}
}
function connect() {
	if (!authenticated) return;
	socket = new WebSocket(
		`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/live?id=${encodeURIComponent(id)}&channel=monitor`,
	);
	socket.onopen = () => {
		connected = true;
		retry = 1000;
		status("LIVE · RECEIVING");
		catchUp();
	};
	socket.onmessage = (e) => {
		try {
			const message = JSON.parse(e.data);
			if (message.tournamentId !== id) return;
			if (message.type === "event") add([message.event]);
		} catch {
			status("INVALID STREAM MESSAGE");
		}
	};
	socket.onerror = () => socket.close();
	socket.onclose = async () => {
		connected = false;
		recoveryCursor = Math.max(0, ...events.keys());
		status("RECONNECTING · LAST SAVED EVENTS SHOWN");
		if (!authenticated) return;
		try {
			authenticated = await request("/api/session").then(
				(s) => s.authenticated && (!s.role || s.role === "admin"),
			);
		} catch {}
		if (!authenticated) return login("Your admin session ended. Sign in again.");
		setTimeout(connect, retry);
		retry = Math.min(retry * 2, 10000);
	};
}
async function boot() {
	try {
		const state = await request(scope("/api/state"));
		title = state.title;
		authenticated = await request("/api/session").then((s) => s.authenticated && (!s.role || s.role === "admin"));
		if (!authenticated) return login();
		layout();
		ambientFrame();
		connect();
	} catch (error) {
		root.innerHTML = `<main><h1>Terminal unavailable</h1><p>${esc(error.message)}</p><a href="/admin">Open tournament history ↗</a></main>`;
	}
}
root.addEventListener("input", (e) => {
	if (e.target.id === "log-filter") {
		filter = e.target.value;
		rows(true);
	}
});
root.addEventListener("submit", async (e) => {
	e.preventDefault();
	if (e.target.id !== "terminal-login") return;
	try {
		await request("/api/login", { password: new FormData(e.target).get("password") });
		authenticated = true;
		await boot();
	} catch (error) {
		login(error.message);
	}
});
root.addEventListener("click", async (e) => {
	const action = e.target.closest("[data-action]")?.dataset.action;
	try {
		if (action === "ambient") {
			ambientEnabled = !ambientEnabled;
			e.target.textContent = ambientEnabled ? "Pause visuals" : "Resume visuals";
			if (ambientEnabled) ambientFrame();
		}
		if (action === "pause") {
			paused = !paused;
			e.target.textContent = paused ? "Resume display" : "Pause display";
			status(connected ? "LIVE · RECEIVING" : "RECONNECTING");
			rows();
		}
		if (action === "older") {
			loadingOlder = true;
			const first = Math.min(...events.keys());
			if (Number.isFinite(first)) {
				const old = await request(scope("/api/events") + `&before=${first}`);
				add(old);
				if (old.length < 200) e.target.disabled = true;
			}
			loadingOlder = false;
		}
		if (action === "logout") {
			await request("/api/logout", {});
			authenticated = false;
			socket?.close();
			login("Signed out.");
		}
	} catch (error) {
		loadingOlder = false;
		status(error.message);
		if (!authenticated) login(error.message);
	}
});
await boot();
