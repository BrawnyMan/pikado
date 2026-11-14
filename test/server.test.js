import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";
import { WebSocket } from "ws";
import { samplePlayers } from "../engine.js";
test(
	"multi-tournament HTTP, room isolation, protected terminal, history, archive and SQLite restart",
	{ timeout: 30000 },
	async () => {
		const dir = mkdtempSync(path.join(tmpdir(), "darts-test-"));
		let child;
		const clients = [];
		const ads = path.join(dir, "ads");
		for (const side of ["left", "right"]) mkdirSync(path.join(ads, side), { recursive: true });
		writeFileSync(
			path.join(ads, "left", "01 sponsor.png"),
			Buffer.from(
				"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=",
				"base64",
			),
		);
		writeFileSync(path.join(ads, "left", "unsafe.svg"), "<svg/>");
		writeFileSync(path.join(dir, "secret.png"), "secret");
		symlinkSync(path.join(dir, "secret.png"), path.join(ads, "left", "link.png"));
		async function launch() {
			child = spawn(process.execPath, ["server.js"], {
				cwd: new URL("..", import.meta.url),
				env: {
					...process.env,
					PORT: "0",
					HOST: "127.0.0.1",
					ADMIN_PASSWORD: "test-password",
					DATA_DIR: dir,
					ADS_DIR: ads,
				},
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			await new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("Startup timeout")), 5000);
				child.stdout.on("data", (c) => {
					output += c;
					if (output.includes("Darts Live ready")) {
						clearTimeout(timer);
						resolve();
					}
				});
				child.once("exit", (c) => {
					clearTimeout(timer);
					reject(new Error(`Server exited ${c}`));
				});
			});
			return `http://127.0.0.1:${/http:\/\/localhost:(\d+)/.exec(output)[1]}`;
		}
		try {
			let origin = await launch();
			let cookie = "";
			const post = (route, data, requestOrigin = origin) =>
				fetch(origin + route, {
					method: "POST",
					headers: { Origin: requestOrigin, Cookie: cookie, "Content-Type": "application/json" },
					body: JSON.stringify(data),
				});
			const get = (route) => fetch(origin + route, { headers: { Cookie: cookie } });
			assert.equal((await get("/api/tournaments")).status, 401);
			assert.equal((await post("/api/login", { password: "test-password" }, "http://other.test")).status, 403);
			const login = await post("/api/login", { password: "test-password" });
			cookie = login.headers.get("set-cookie").split(";")[0];
			assert.equal(login.status, 200);
			const a = await (await post("/api/tournaments", { title: "Cup A", modelId: "single-16" })).json(),
				b = await (await post("/api/tournaments", { title: "Cup B", modelId: "single-32" })).json();
			assert.notEqual(a.id, b.id);
			assert.equal((await (await get("/api/tournaments")).json()).length, 2);
			assert.equal((await get("/api/state")).status, 400);
			assert.equal((await get("/api/state?id=missing")).status, 404);
			const catalog = await (await get("/api/models")).json();
			assert.equal(catalog[1].preview.length, 31);
			assert.equal((await (await get("/api/models/single-32")).json()).playerCount, 32);
			assert.equal((await (await get(`/api/export?id=${a.id}`)).json()).matches.length, 15);
			const inventory = await (await get("/api/ads")).json();
			assert.deepEqual(inventory.left, ["/ads/left/01%20sponsor.png"]);
			assert.equal((await get(inventory.left[0])).headers.get("content-type"), "image/png");
			assert.equal((await get("/ads/left/link.png")).status, 404);
			assert.equal((await get("/ads/left/unsafe.svg")).status, 404);
			async function connect(id, monitor = false, authorized = false) {
				const ws = new WebSocket(
					origin.replace("http:", "ws:") + `/live?id=${id}${monitor ? "&channel=monitor" : ""}`,
					{ origin, headers: authorized ? { Cookie: cookie } : {} },
				);
				clients.push(ws);
				const received = [];
				ws.on("message", (m) => received.push(JSON.parse(m)));
				await once(ws, "message");
				return { ws, received };
			}
			const wa = await connect(a.id),
				wb = await connect(b.id),
				terminal = await connect(a.id, true, true);
			const blocked = new WebSocket(origin.replace("http:", "ws:") + `/live?id=${a.id}&channel=monitor`, {
				origin,
			});
			clients.push(blocked);
			await once(blocked, "error");
			const update = once(wa.ws, "message"),
				event = once(terminal.ws, "message");
			assert.equal(
				(
					await post(`/api/command?id=${a.id}`, {
						type: "start",
						title: "Cup A",
						names: samplePlayers,
						revision: 0,
					})
				).status,
				200,
			);
			await update;
			await event;
			assert.equal(wa.received.at(-1).state.matches.length, 15);
			assert.equal(terminal.received.at(-1).event.type, "start");
			assert.equal(wb.received.length, 1);
			assert.equal(
				(await post(`/api/command?id=${a.id}`, { type: "assign", matchId: "r1-1", machineId: 1, revision: 0 }))
					.status,
				409,
			);
			assert.equal(
				(await post(`/api/command?id=${a.id}`, { type: "assign", matchId: "r1-1", machineId: 1, revision: 1 }))
					.status,
				200,
			);
			assert.equal(
				(await post(`/api/command?id=${a.id}`, { type: "finish", matchId: "r1-1", score: [2, 1], revision: 2 }))
					.status,
				200,
			);
			assert.equal((await post(`/api/command?id=${a.id}`, { type: "undo", revision: 3 })).status, 200);
			let saved = await (await get(`/api/state?id=${a.id}`)).json();
			assert.equal(saved.matches[0].status, "playing");
			assert.deepEqual(saved.matches.find((m) => m.id === "r2-1").players, [null, null]);
			assert.equal(saved.id, a.id);
			assert.ok(saved.matches[0].uuid);
			assert.equal((await post(`/api/archive?id=${a.id}`, { archived: true, revision: 4 })).status, 400);
			assert.equal(
				(await post(`/api/command?id=${a.id}`, { type: "unassign", matchId: "r1-1", revision: 4 })).status,
				200,
			);
			assert.equal((await post(`/api/archive?id=${a.id}`, { archived: true, revision: 5 })).status, 200);
			assert.equal((await post(`/api/command?id=${a.id}`, { type: "add-machine", revision: 6 })).status, 423);
			assert.equal((await post(`/api/archive?id=${a.id}`, { archived: false, revision: 6 })).status, 200);
			assert.equal((await post(`/api/command?id=${a.id}`, { type: "reset", revision: 7 })).status, 400);
			const log = await (await get(`/api/events/export?id=${a.id}`)).json();
			assert.ok(log.some((e) => e.type === "finish"));
			assert.ok(log.some((e) => e.type === "undo"));
			assert.ok(log.some((e) => e.matchUuid === saved.matches[0].uuid));
			assert.ok(log.every((e) => e.tournamentId === a.id));
			const page = await (await get(`/api/events?id=${a.id}&after=${log[0].id}`)).json();
			assert.equal(page[0].id, log[1].id);
			assert.equal(wb.received.length, 1);
			assert.equal((await (await get(`/api/state?id=${b.id}`)).json()).revision, 0);
			const exported = await (await get(`/api/export?id=${a.id}`)).json();
			assert.equal(exported.history, undefined);
			assert.equal(exported.id, a.id);
			for (const c of clients) c.terminate();
			const exited = once(child, "exit");
			child.kill();
			await exited;
			origin = await launch();
			assert.equal((await get("/api/tournaments")).status, 401);
			saved = await (await get(`/api/state?id=${a.id}`)).json();
			assert.equal(saved.revision, 7);
			assert.equal(saved.matches[0].status, "ready");
			assert.equal(saved.matches[0].machineHistory.at(-1).machineId, 1);
			const relogin = await post("/api/login", { password: "test-password" });
			cookie = relogin.headers.get("set-cookie").split(";")[0];
			assert.equal((await (await get("/api/tournaments")).json()).length, 2);
			assert.equal((await (await get(`/api/events/export?id=${a.id}`)).json()).length, log.length);
			const watcher = await connect(a.id, true, true);
			const closed = once(watcher.ws, "close");
			assert.equal((await post("/api/logout", {})).status, 200);
			await closed;
			assert.equal((await get(`/api/events?id=${a.id}`)).status, 401);
		} finally {
			for (const c of clients) c.terminate();
			if (child && child.exitCode === null) {
				const done = once(child, "exit");
				child.kill();
				await done;
			}
			rmSync(dir, { recursive: true, force: true });
		}
	},
);
