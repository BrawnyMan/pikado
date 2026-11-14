const managerEntry = location.pathname === "/manager";
const root = document.querySelector("#portal"),
	adminPortal = !["/view", "/veiw"].includes(location.pathname);
let authenticated = false,
	tournaments = [],
	filter = "all",
	search = "";
const esc = (v) =>
	String(v ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
function toast(message) {
	const el = document.querySelector("#toast");
	el.textContent = message;
	el.classList.add("show");
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => el.classList.remove("show"), 5000);
}
async function request(url, data) {
	const r = await fetch(
			url,
			data ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) } : {},
		),
		value = await r.json();
	if (!r.ok) {
		if (r.status === 401) authenticated = false;
		throw new Error(value.error);
	}
	return value;
}
function date(value) {
	return new Date(value).toLocaleString();
}
function renderCards() {
	const host = root.querySelector("#tournament-cards");
	if (!host) return;
	const list = tournaments.filter(
		(t) =>
			(filter === "all" || (filter === "archived" ? t.archived : !t.archived)) &&
			`${t.title} ${t.id}`.toLowerCase().includes(search.toLowerCase()),
	);
	host.innerHTML = list.length
		? list
				.map(
					(t) =>
						`<article class="event-card"><div class="event-card-top"><span class="eyebrow">${t.modelId === "single-32" ? "32" : "16"} players · ${esc(t.phase)}</span><span class="status ${t.archived ? "" : "playing"}">${t.archived ? "Archived" : "Active"}</span></div><h2>${esc(t.title)}</h2><code class="event-id">${esc(t.id)}</code><p>${t.eventCount} saved events · Revision ${t.revision}</p><p class="muted">Created ${esc(date(t.createdAt))}<br>Updated ${esc(date(t.updatedAt))}</p><div class="event-card-links"><a href="/admin?id=${esc(t.id)}">Open admin ↗</a><a href="/view?id=${esc(t.id)}" target="_blank" rel="noopener">Viewer ↗</a><a href="/terminal?id=${esc(t.id)}" target="_blank" rel="noopener">Terminal ↗</a></div></article>`,
				)
				.join("")
		: '<div class="empty-queue">No tournaments here yet. Create one to get started.</div>';
}
function render() {
	if (managerEntry) {
		root.innerHTML = `<header class="topbar"><span class="brand"><span class="brand-mark">◎</span>DARTS LIVE</span><span class="manager-badge">GAME MANAGER</span></header><main><section class="login-panel"><span class="eyebrow">Assigned tournament only</span><h2>Manager sign in</h2><p>Enter the tournament ID and manager password supplied by your admin.</p><form id="manager-entry"><label for="manager-id">Tournament UUID</label><input id="manager-id" name="id" required><label for="manager-pass">Manager password</label><input id="manager-pass" name="password" type="password" autocomplete="current-password" required><button class="primary">Open my tournament ↗</button></form></section></main>`;
		return;
	}

	root.innerHTML = `<header class="topbar"><a class="brand" href="/admin"><span class="brand-mark">◎</span>DARTS<span class="brand-live">LIVE</span></a><div class="top-right">${authenticated ? '<button data-action="refresh">Refresh history</button><button data-action="logout" class="text-button">Sign out</button>' : '<a href="/view">Open a viewer ↗</a>'}</div></header><main><div class="hero"><div><span class="eyebrow accent">${adminPortal ? "The tournament desk" : "Choose your event"}</span><h1>${adminPortal ? "Every event. One place." : "Join the live floor."}</h1><p>${adminPortal ? "Create a tournament, return to a live game, or browse past results." : "Paste a tournament ID to open its spectator display."}</p></div></div>${adminPortal && !authenticated ? `<section class="login-panel"><span class="eyebrow">Admin access</span><h2>Sign in to your tournaments</h2><form id="login"><label for="password">Admin password</label><input type="password" name="password" id="password" autocomplete="current-password" required><button class="primary">Sign in ↗</button></form></section>` : adminPortal ? `<section class="event-create setting-card"><div><span class="eyebrow">New event</span><h2>Keep every tournament</h2><p>Each event gets its own ID, match history and live display.</p></div><form id="create-event"><label for="new-title">Tournament name</label><input name="title" id="new-title" maxlength="80" placeholder="Saturday Night Darts" required><label for="new-model">Player model</label><select id="new-model" name="modelId"><option value="single-16">16 players · 15 matches</option><option value="single-32">32 players · 31 matches</option></select><button class="primary">Create tournament ↗</button></form></section><section class="event-history"><div class="section-head"><h2>Tournament history <span class="count">${tournaments.length}</span></h2></div><div class="history-filters"><label>Search<input id="history-search" type="search" placeholder="Name or tournament ID"></label><label>Show<select id="history-filter"><option value="all">All tournaments</option><option value="active">Active</option><option value="archived">Archived</option></select></label></div><div id="tournament-cards" class="event-cards"></div></section>` : ""}<section class="join-event setting-card"><h2>Open a tournament link</h2><form id="join-event"><label for="event-id">Tournament UUID</label><input id="event-id" name="id" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" required><button class="secondary">Open ${adminPortal ? "admin" : "viewer"} ↗</button></form>${!adminPortal ? '<p>Ask the tournament admin for the viewer link. <a href="/admin">Admin sign in ↗</a></p>' : ""}</section></main><footer><span>◎ DARTS LIVE</span><span>Saved tournaments · Dedicated live rooms · Match history</span></footer>`;
	renderCards();
	const select = root.querySelector("#history-filter");
	if (select) select.value = filter;
	const input = root.querySelector("#history-search");
	if (input) input.value = search;
}
async function loadHistory() {
	tournaments = await request("/api/tournaments");
}
root.addEventListener("submit", async (e) => {
	e.preventDefault();
	const f = e.target,
		data = new FormData(f),
		button = f.querySelector("button");
	button.disabled = true;
	try {
		if (f.id === "manager-entry") {
			const id = String(data.get("id")).trim();
			await request(`/api/manager-login?id=${encodeURIComponent(id)}`, { password: data.get("password") });
			location.href = `/manager?id=${encodeURIComponent(id)}`;
		}
		if (f.id === "login") {
			await request("/api/login", { password: data.get("password") });
			authenticated = true;
			await loadHistory();
			render();
		}
		if (f.id === "create-event") {
			const result = await request("/api/tournaments", {
				title: data.get("title"),
				modelId: data.get("modelId"),
			});
			location.href = `/admin?id=${encodeURIComponent(result.id)}`;
		}
		if (f.id === "join-event") {
			const id = String(data.get("id")).trim();
			if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
				throw new Error("Enter the UUID from your tournament link.");
			await request(`/api/state?id=${encodeURIComponent(id)}`);
			location.href = `/${adminPortal ? "admin" : "view"}?id=${encodeURIComponent(id)}`;
		}
	} catch (error) {
		toast(error.message);
		if (adminPortal && !authenticated) render();
	} finally {
		button.disabled = false;
	}
});
root.addEventListener("click", async (e) => {
	const a = e.target.closest("[data-action]")?.dataset.action;
	try {
		if (a === "logout") {
			await request("/api/logout", {});
			authenticated = false;
			render();
		}
		if (a === "refresh") {
			await loadHistory();
			render();
		}
	} catch (error) {
		toast(error.message);
		if (!authenticated) render();
	}
});
root.addEventListener("input", (e) => {
	if (e.target.id === "history-search") {
		search = e.target.value;
		renderCards();
	}
});
root.addEventListener("change", (e) => {
	if (e.target.id === "history-filter") {
		filter = e.target.value;
		renderCards();
	}
});
try {
	authenticated = (await request("/api/session")).authenticated;
	if (adminPortal && !managerEntry && authenticated) await loadHistory();
} catch (error) {
	toast(error.message);
}
render();
