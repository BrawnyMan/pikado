import test from "node:test";
import assert from "node:assert/strict";
import { initialState, applyCommand, samplePlayers, normalizeState } from "../engine.js";
const start = () => applyCommand(initialState(), { type: "start", title: "Test Cup", names: samplePlayers });
test("16 players produce 15 connected matches and 8 ready matches", () => {
	const s = start();
	assert.equal(s.matches.length, 15);
	assert.equal(s.matches.filter((m) => m.status === "ready").length, 8);
	assert.deepEqual(s.matches[0].winnerTo, { matchId: "r2-1", slot: 0 });
	assert.equal(s.matches[0].loserTo, null);
});
test("occupied machines reject a second match; input is unchanged", () => {
	const s = applyCommand(start(), { type: "assign", matchId: "r1-1", machineId: 1 });
	assert.throws(() => applyCommand(s, { type: "assign", matchId: "r1-2", machineId: 1 }), /occupied/);
	assert.equal(s.matches[1].status, "ready");
});
test("only assigned matches accept valid scores", () => {
	let s = start();
	assert.throws(() => applyCommand(s, { type: "finish", matchId: "r1-1", score: [2, 0] }), /Assign/);
	s = applyCommand(s, { type: "assign", matchId: "r1-1", machineId: 1 });
	for (const score of [
		[-1, 0],
		[1.2, 0],
		[3, 3],
		[4, 0],
	])
		assert.throws(() => applyCommand(s, { type: "score", matchId: "r1-1", score }));
	assert.throws(() => applyCommand(s, { type: "finish", matchId: "r1-1", score: [1, 1] }), /2 legs/);
	s = applyCommand(s, { type: "score", matchId: "r1-1", score: [1, 1] });
	s = applyCommand(s, { type: "unassign", matchId: "r1-1" });
	assert.deepEqual(s.matches[0].score, [1, 1]);
	assert.equal(s.matches[0].machineId, null);
});
test("full tournament advances slot 0 and slot 1 winners and declares champion", () => {
	let s = start(),
		count = 0;
	while (s.phase !== "complete") {
		const m = s.matches.find((m) => m.status === "ready");
		assert.ok(m);
		s = applyCommand(s, { type: "assign", matchId: m.id, machineId: 1 });
		const score = count % 2 ? [1, 2] : [2, 1];
		s = applyCommand(s, { type: "finish", matchId: m.id, score });
		count++;
	}
	assert.equal(count, 15);
	assert.equal(s.matches.filter((m) => m.status === "finished").length, 15);
	assert.ok(s.matches.at(-1).winnerId);
	assert.equal(s.matches.filter((m) => m.status === "playing").length, 0);
});
test("setup validates player list and reset returns to setup", () => {
	assert.throws(
		() => applyCommand(initialState(), { type: "start", title: "Cup", names: samplePlayers.slice(1) }),
		/16/,
	);
	assert.throws(
		() => applyCommand(initialState(), { type: "start", title: "Cup", names: Array(16).fill("Alex") }),
		/unique/,
	);
	assert.equal(applyCommand(start(), { type: "reset" }).phase, "setup");
});

const play = () => applyCommand(start(), { type: "assign", matchId: "r1-1", machineId: 1 });
const leg = (winnerId = null, a = null, b = null) => ({ winnerId, score: [a, b] });
test("machines enforce 2–7, protect occupied machines, and keep stable IDs", () => {
	let s = play();
	assert.throws(() => applyCommand(s, { type: "remove-machine", machineId: 1 }), /active match/);
	s = applyCommand(s, { type: "remove-machine", machineId: 2 });
	assert.deepEqual(
		s.machines.map((m) => m.id),
		[1, 3],
	);
	assert.throws(() => applyCommand(s, { type: "remove-machine", machineId: 3 }), /At least 2/);
	while (s.machines.length < 7) s = applyCommand(s, { type: "add-machine" });
	assert.deepEqual(
		s.machines.map((m) => m.id),
		[1, 2, 3, 4, 5, 6, 7],
	);
	assert.throws(() => applyCommand(s, { type: "add-machine" }), /Maximum 7/);
	s = applyCommand(s, { type: "unassign", matchId: "r1-1" });
	s = applyCommand(s, { type: "remove-machine", machineId: 1 });
	assert.ok(!s.machines.some((m) => m.id === 1));
});
test("per-leg point values persist and leg winners determine first-to-two result", () => {
	let s = play(),
		legs = [leg("p1", 0, 32), leg("p2", 45, 0), leg("p1", 0, 16)];
	s = applyCommand(s, { type: "score", matchId: "r1-1", legs });
	assert.deepEqual(s.matches[0].score, [2, 1]);
	assert.equal(s.matches[0].status, "playing");
	s = applyCommand(s, { type: "finish", matchId: "r1-1", legs });
	assert.equal(s.matches[0].winnerId, "p1");
	assert.deepEqual(s.matches[0].legs, legs);
	assert.equal(s.matches.find((m) => m.id === "r2-1").players[0], "p1");
});
test("unplayed legs, winner order and numeric input are validated", () => {
	const s = play();
	for (const legs of [
		[leg(), leg("p1"), leg()],
		[leg("p1"), leg("p1"), leg("p2")],
		[leg("p1"), leg("p1"), leg(null, 1, 2)],
		[leg("p9"), leg(), leg()],
		[leg("p1", -1, 0), leg(), leg()],
		[leg("p1", 1.1, 0), leg(), leg()],
		[leg("p1", NaN, 0), leg(), leg()],
	])
		assert.throws(() => applyCommand(s, { type: "score", matchId: "r1-1", legs }));
	assert.throws(
		() => applyCommand(s, { type: "finish", matchId: "r1-1", legs: [leg("p1"), leg("p2"), leg()] }),
		/2 legs/,
	);
	const next = applyCommand(s, {
		type: "finish",
		matchId: "r1-1",
		legs: [leg("p2", 34, 0), leg("p2", 40, 0), leg()],
	});
	assert.equal(next.matches[0].winnerId, "p2");
});
test("round rules apply only to unscored queued games and per-game overrides persist", () => {
	let s = play();
	s = applyCommand(s, { type: "round-settings", targets: [3, 3, 4, 5] });
	assert.equal(s.matches[0].target, 2);
	assert.equal(s.matches[1].target, 3);
	assert.equal(s.matches.find((m) => m.id === "r4-1").legs.length, 9);
	s = applyCommand(s, {
		type: "match-settings",
		matchId: "r1-2",
		target: 4,
		players: [
			{ id: "p3", name: "Sam Wilson" },
			{ id: "p4", name: "Jordan Lee" },
		],
	});
	s = applyCommand(s, { type: "round-settings", targets: [2, 2, 2, 2] });
	assert.equal(s.matches[1].target, 4);
	assert.throws(() => applyCommand(s, { type: "round-settings", targets: [0, 2, 2, 2] }));
});
test("rename uses stable IDs across bracket, and shrinking never discards leg data", () => {
	let s = play();
	s = applyCommand(s, { type: "finish", matchId: "r1-1", legs: [leg("p1"), leg("p2"), leg("p1")] });
	s = applyCommand(s, {
		type: "match-settings",
		matchId: "r1-1",
		target: 2,
		players: [
			{ id: "p1", name: "Alex Renamed" },
			{ id: "p2", name: "Jamie Taylor" },
		],
	});
	assert.equal(s.players[0].id, "p1");
	assert.equal(s.players[0].name, "Alex Renamed");
	assert.equal(s.matches.find((m) => m.id === "r2-1").players[0], "p1");
	assert.throws(
		() =>
			applyCommand(s, {
				type: "match-settings",
				matchId: "r1-1",
				target: 3,
				players: [
					{ id: "p1", name: "Alex Renamed" },
					{ id: "p2", name: "Jamie Taylor" },
				],
			}),
		/finished/,
	);
	let t = play();
	t = applyCommand(t, { type: "score", matchId: "r1-1", legs: [leg("p1"), leg("p2"), leg(null, 10, 20)] });
	assert.throws(
		() =>
			applyCommand(t, {
				type: "match-settings",
				matchId: "r1-1",
				target: 1,
				players: [
					{ id: "p1", name: "Alex Morgan" },
					{ id: "p2", name: "Jamie Taylor" },
				],
			}),
		/discard/,
	);
	assert.throws(
		() =>
			applyCommand(t, {
				type: "match-settings",
				matchId: "r1-1",
				target: 2,
				players: [
					{ id: "p1", name: "Jamie Taylor" },
					{ id: "p2", name: "Jamie Taylor" },
				],
			}),
		/unique/,
	);
});
test("ads, timed announcements and reset preserve the intended settings", () => {
	let s = applyCommand(start(), { type: "display-settings", enabled: false, intervalSeconds: 5 });
	s = applyCommand(s, { type: "announce", text: "  Finalists report to Machine 01  ", seconds: 15 });
	assert.equal(s.announcement.text, "Finalists report to Machine 01");
	assert.ok(s.announcement.expiresAt > Date.now());
	s = applyCommand(s, { type: "announce", text: "Break time", seconds: 0 });
	assert.equal(s.announcement.expiresAt, null);
	s = applyCommand(s, { type: "clear-announcement" });
	assert.equal(s.announcement, null);
	assert.throws(() => applyCommand(s, { type: "display-settings", enabled: true, intervalSeconds: 0 }));
	assert.throws(() => applyCommand(s, { type: "announce", text: " ", seconds: 15 }));
	s = applyCommand(s, { type: "add-machine" });
	s = applyCommand(s, { type: "round-settings", targets: [2, 2, 3, 3] });
	s = applyCommand(s, { type: "reset" });
	assert.equal(s.machines.length, 4);
	assert.equal(s.ads.enabled, false);
	assert.deepEqual(s.roundTargets, [2, 2, 3, 3]);
	assert.equal(s.matches.length, 0);
});
test("v1 state migrates without changing existing first-to-three results", () => {
	const legacy = initialState();
	legacy.target = 3;
	delete legacy.roundTargets;
	delete legacy.ads;
	delete legacy.announcement;
	legacy.matches = [
		{ id: "r1-1", round: 1, players: ["p1", "p2"], score: [3, 2], status: "finished", winnerId: "p1" },
	];
	const s = normalizeState(legacy);
	assert.equal(s.matches[0].target, 3);
	assert.equal(s.matches[0].legs.length, 5);
	assert.equal(s.matches[0].legs.at(-1).winnerId, "p1");
	assert.equal(s.ads.intervalSeconds, 5);
});

test("32-player JSON model creates and completes all 31 connected games", () => {
	const names = Array.from({ length: 32 }, (_, i) => `Player ${i + 1}`);
	let s = applyCommand(initialState(), { type: "select-model", modelId: "single-32" });
	assert.equal(s.roundTargets.length, 5);
	assert.equal(s.playerCount, 32);
	s = applyCommand(s, { type: "start", title: "32 Cup", names });
	assert.equal(s.matches.length, 31);
	assert.equal(s.matches.filter((m) => m.status === "ready").length, 16);
	for (const m of s.matches) {
		if (m.winnerTo) {
			const next = s.matches.find((n) => n.id === m.winnerTo.matchId);
			assert.equal(next.sources[m.winnerTo.slot].matchId, m.id);
		}
		assert.equal(m.loserTo, null);
	}
	let played = 0;
	while (s.phase !== "complete") {
		const m = s.matches.find((m) => m.status === "ready");
		assert.ok(m);
		s = applyCommand(s, { type: "assign", matchId: m.id, machineId: 1 });
		s = applyCommand(s, { type: "finish", matchId: m.id, score: played % 2 ? [1, 2] : [2, 1] });
		played++;
	}
	assert.equal(played, 31);
	assert.equal(s.matches.at(-1).round, 5);
	assert.ok(s.matches.at(-1).winnerId);
});
test("model selection preserves final-round targets and refuses mid-tournament changes", () => {
	let s = applyCommand(initialState(), { type: "round-settings", targets: [2, 2, 3, 4] });
	s = applyCommand(s, { type: "select-model", modelId: "single-32" });
	assert.deepEqual(s.roundTargets, [2, 2, 2, 3, 4]);
	s = applyCommand(s, { type: "select-model", modelId: "single-16" });
	assert.deepEqual(s.roundTargets, [2, 2, 3, 4]);
	assert.throws(() => applyCommand(start(), { type: "select-model", modelId: "single-32" }), /new tournament/);
	assert.throws(
		() => applyCommand(initialState(), { type: "select-model", modelId: "single-64" }),
		/16-player or 32-player/,
	);
	assert.throws(
		() =>
			applyCommand(initialState(), {
				type: "start",
				modelId: "single-32",
				names: samplePlayers,
				title: "Wrong roster",
			}),
		/32/,
	);
});
test("clock pauses, resumes on a new machine, stops at finish and preserves machine snapshots", () => {
	let s = applyCommand(start(), { type: "assign", matchId: "r1-1", machineId: 1 }, 1000);
	s = applyCommand(s, { type: "unassign", matchId: "r1-1" }, 6000);
	assert.equal(s.matches[0].timing.elapsedMs, 5000);
	assert.equal(s.matches[0].timing.runningSince, null);
	s = applyCommand(s, { type: "assign", matchId: "r1-1", machineId: 2 }, 10000);
	s = applyCommand(s, { type: "finish", matchId: "r1-1", score: [2, 1] }, 13000);
	const m = s.matches[0];
	assert.equal(m.timing.elapsedMs, 8000);
	assert.equal(m.timing.runningSince, null);
	assert.equal(m.machineId, 2);
	assert.deepEqual(
		m.machineHistory.map((v) => [v.machineId, v.startedAt, v.endedAt]),
		[
			[1, 1000, 6000],
			[2, 10000, 13000],
		],
	);
	s = applyCommand(s, { type: "remove-machine", machineId: 2 }, 20000);
	assert.equal(s.matches[0].machineHistory.at(-1).machineName, "Machine 02");
	assert.equal(s.matches[0].timing.elapsedMs, 8000);
});
test("preferred machine is advisory and removal clears the plan without changing actual history", () => {
	let s = start();
	s = applyCommand(s, { type: "match-settings", matchId: "r2-1", players: [], target: 2, plannedMachineId: 3 });
	assert.equal(s.matches.find((m) => m.id === "r2-1").plannedMachineId, 3);
	s = applyCommand(s, { type: "remove-machine", machineId: 3 });
	assert.equal(s.matches.find((m) => m.id === "r2-1").plannedMachineId, null);
	s = applyCommand(s, {
		type: "match-settings",
		matchId: "r1-1",
		players: samplePlayers.slice(0, 2).map((name, i) => ({ id: `p${i + 1}`, name })),
		target: 2,
		plannedMachineId: 2,
	});
	s = applyCommand(s, { type: "assign", matchId: "r1-1", machineId: 1 });
	assert.equal(s.matches[0].machineId, 1);
	assert.equal(s.matches[0].plannedMachineId, 2);
});
test("legacy completed games do not invent elapsed durations", () => {
	const legacy = start();
	delete legacy.modelId;
	delete legacy.playerCount;
	delete legacy.roundNames;
	const m = legacy.matches[0];
	delete m.timing;
	delete m.machineHistory;
	m.status = "finished";
	m.machineId = 2;
	m.calledAt = 1000;
	m.finishedAt = new Date(5000).toISOString();
	const s = normalizeState(legacy);
	assert.equal(s.modelId, "single-16");
	assert.equal(s.matches[0].timing.elapsedMs, null);
	assert.equal(s.matches[0].machineHistory[0].legacy, true);
});
