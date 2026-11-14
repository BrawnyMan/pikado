import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TournamentStore, commandPayload } from "../store.js";
import { initialState, applyCommand, samplePlayers } from "../engine.js";
function fixture() {
	const dir = mkdtempSync(path.join(tmpdir(), "darts-store-"));
	const store = new TournamentStore(dir);
	return {
		dir,
		store,
		close() {
			store.close();
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
test("SQLite keeps separate UUID records and atomic, append-only events", () => {
	const f = fixture();
	try {
		const a = f.store.create({ title: "A", modelId: "single-16" }),
			b = f.store.create({ title: "B", modelId: "single-32" });
		assert.notEqual(a.state.id, b.state.id);
		assert.match(a.state.id, /^[0-9a-f-]{36}$/);
		const next = f.store.commit(a.state.id, 0, (r) => ({
			state: applyCommand(r.state, { type: "start", title: "A", names: samplePlayers }),
			history: [r.state],
			type: "start",
			message: "Started A",
			payload: {},
		}));
		assert.equal(next.state.matches.length, 15);
		assert.equal(new Set(next.state.matches.map((m) => m.uuid)).size, 15);
		assert.equal(f.store.get(b.state.id).state.phase, "setup");
		assert.throws(
			() =>
				f.store.commit(a.state.id, 0, () => {
					throw new Error("must not run");
				}),
			/changed/,
		);
		assert.equal(f.store.events(a.state.id, { all: true }).length, 2);
		const before = f.store.get(a.state.id).state;
		assert.throws(() =>
			f.store.commit(a.state.id, 1, () => ({
				state: { ...before, title: "Not committed" },
				history: [],
				type: "bad",
				message: "fail",
				payload: { x: 1n },
			})),
		);
		assert.equal(f.store.get(a.state.id).state.title, "A");
		assert.equal(f.store.get(a.state.id).state.revision, 1);
		assert.equal(f.store.events(a.state.id, { all: true }).length, 2);
		assert.equal(f.store.events(b.state.id, { all: true }).length, 1);
		assert.equal(commandPayload({ type: "score", password: "do not save", score: [1, 0] }).password, undefined);
	} finally {
		f.close();
	}
});
test("old JSON imports once with stable tournament / match UUIDs and preserves the source file", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "darts-migration-"));
	const old = {
		state: applyCommand(initialState(), { type: "start", title: "Legacy Cup", names: samplePlayers }),
		history: [initialState()],
	};
	const source = JSON.stringify(old);
	writeFileSync(path.join(dir, "tournament.json"), source);
	let db;
	try {
		db = new TournamentStore(dir);
		const first = db.list()[0],
			match = db.get(first.id).state.matches[0].uuid;
		assert.equal(db.list().length, 1);
		db.close();
		db = new TournamentStore(dir);
		assert.equal(db.list().length, 1);
		assert.equal(db.list()[0].id, first.id);
		assert.equal(db.get(first.id).state.matches[0].uuid, match);
		assert.equal(readFileSync(path.join(dir, "tournament.json"), "utf8"), source);
		assert.equal(db.events(first.id, { all: true })[0].type, "legacy-import");
	} finally {
		db?.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
test("event cursors replay more than one page in order without gaps", () => {
	const f = fixture();
	try {
		const id = f.store.create({ title: "Replay Cup", modelId: "single-16" }).state.id;
		for (let i = 0; i < 205; i++)
			f.store.commit(id, i, (r) => ({
				state: r.state,
				history: r.history,
				type: "test",
				message: `Event ${i}`,
				payload: {},
			}));
		const all = f.store.events(id, { all: true }),
			first = f.store.events(id, { after: all[0].id }),
			second = f.store.events(id, { after: first.at(-1).id });
		assert.equal(first.length, 200);
		assert.equal(second.length, 5);
		assert.deepEqual(
			[...first, ...second].map((e) => e.id),
			all.slice(1).map((e) => e.id),
		);
		const older = f.store.events(id, { before: all[20].id });
		assert.deepEqual(
			older.map((e) => e.id),
			all.slice(0, 20).map((e) => e.id),
		);
	} finally {
		f.close();
	}
});
