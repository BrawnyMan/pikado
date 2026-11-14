import { randomUUID } from "node:crypto";
import { getModel, targetsForModel, createMatches } from "./models.js";
export const samplePlayers = [
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
function check(ok, message) {
	if (!ok) throw new Error(message);
}
const newLeg = () => ({ score: [null, null], winnerId: null });
const validTarget = (n) => Number.isInteger(n) && n >= 1 && n <= 9;
export function initialState() {
	return {
		revision: 0,
		title: "Friday Night Darts",
		phase: "setup",
		modelId: "single-16",
		playerCount: 16,
		roundNames: [...getModel("single-16").roundNames],
		target: getModel("single-16").defaultTargets[0],
		roundTargets: [...getModel("single-16").defaultTargets],
		ads: { enabled: true, intervalSeconds: 5 },
		announcement: null,
		players: [],
		matches: [],
		machines: [1, 2, 3].map((id) => ({ id, name: `Machine ${String(id).padStart(2, "0")}` })),
	};
}
export function legsFromScore(m, score) {
	check(
		Array.isArray(score) &&
			score.length === 2 &&
			score.every((n) => Number.isInteger(n) && n >= 0 && n <= m.target),
		"Invalid leg score.",
	);
	check(!(score[0] === m.target && score[1] === m.target), "Both players cannot win.");
	const winners = [];
	// A legacy aggregate has no chronological information. Put the clinching leg last.
	const winner = score[0] === m.target ? 0 : score[1] === m.target ? 1 : null;
	for (let i = 0; i < 2; i++) for (let n = 0; n < score[i] - (winner === i ? 1 : 0); n++) winners.push(m.players[i]);
	if (winner !== null) winners.push(m.players[winner]);
	return Array.from({ length: m.target * 2 - 1 }, (_, i) => ({ ...newLeg(), winnerId: winners[i] || null }));
}
export function normalizeState(old, now = Date.now()) {
	const s = structuredClone(old);
	s.modelId ??= s.players.length === 32 ? "single-32" : "single-16";
	const model = getModel(s.modelId);
	s.playerCount = model.playerCount;
	s.roundNames = [...model.roundNames];
	s.roundTargets ??= [s.target ?? 2, s.target ?? 2, s.target ?? 2, s.target ?? 2];
	s.roundTargets = targetsForModel(s.roundTargets, model);
	s.ads ??= { enabled: true, intervalSeconds: 5 };
	s.announcement ??= null;
	for (const m of s.matches) {
		m.target ??= s.roundTargets[m.round - 1];
		m.legs ??= legsFromScore(m, m.score);
		m.plannedMachineId ??= null;
		m.sources ??=
			m.round === 1
				? m.players.map((playerId) => ({ playerId }))
				: [0, 1].map((slot) => ({
						matchId: `r${m.round - 1}-${(m.order ?? Number(m.id.split("-")[1])) * 2 - 1 + slot}`,
						outcome: "winner",
					}));
		// Historical v1/v2 timestamps cannot reconstruct earlier machine visits or elapsed time.
		m.machineHistory ??= m.machineId
			? [
					{
						machineId: m.machineId,
						machineName: `Machine ${String(m.machineId).padStart(2, "0")}`,
						startedAt: m.calledAt ?? null,
						endedAt: m.status === "playing" ? null : m.finishedAt ? Date.parse(m.finishedAt) : null,
						legacy: true,
					},
				]
			: [];
		m.timing ??= {
			elapsedMs: m.status === "finished" ? null : 0,
			runningSince: m.status === "playing" ? (m.calledAt ?? now) : null,
			estimated: true,
		};
	}
	return s;
}
export function validateLegs(m, legs) {
	check(Array.isArray(legs) && legs.length === m.target * 2 - 1, `Enter ${m.target * 2 - 1} possible legs.`);
	const totals = [0, 0];
	let gap = false,
		clinched = false;
	const cleaned = legs.map((leg) => {
		check(
			leg &&
				Array.isArray(leg.score) &&
				leg.score.length === 2 &&
				leg.score.every((n) => n === null || (Number.isInteger(n) && n >= 0 && n <= 9999)),
			"Leg scores must be blank or whole numbers from 0 to 9999.",
		);
		check(
			leg.winnerId === null || m.players.includes(leg.winnerId),
			"Choose a player from this match as the leg winner.",
		);
		check(
			!clinched || (leg.winnerId === null && leg.score.every((n) => n === null)),
			"Leave unplayed legs blank after a player has won the match.",
		);
		if (leg.winnerId !== null) {
			check(!gap, "Record leg winners in order, without gaps.");
			const slot = m.players.indexOf(leg.winnerId);
			totals[slot]++;
			clinched = totals[slot] === m.target;
		} else gap = true;
		return { score: [...leg.score], winnerId: leg.winnerId };
	});
	return { legs: cleaned, score: totals };
}
export function applyCommand(current, command, now = Date.now()) {
	const s = normalizeState(current, now);
	if (command.type === "select-model") {
		check(s.phase === "setup", "Start a new tournament before changing the player model.");
		const model = getModel(command.modelId);
		s.modelId = model.id;
		s.playerCount = model.playerCount;
		s.roundNames = [...model.roundNames];
		s.roundTargets = targetsForModel(s.roundTargets, model);
		s.target = s.roundTargets[0];
	} else if (command.type === "add-machine") {
		check(s.machines.length < 7, "Maximum 7 machines.");
		const id = Array.from({ length: 7 }, (_, i) => i + 1).find((id) => !s.machines.some((m) => m.id === id));
		s.machines.push({ id, name: `Machine ${String(id).padStart(2, "0")}` });
		s.machines.sort((a, b) => a.id - b.id);
	} else if (command.type === "remove-machine") {
		check(s.machines.length > 2, "At least 2 machines are required.");
		check(
			s.machines.some((m) => m.id === command.machineId),
			"Machine not found.",
		);
		check(
			!s.matches.some((m) => m.status === "playing" && m.machineId === command.machineId),
			"Return the active match to the queue before removing this machine.",
		);
		s.machines = s.machines.filter((m) => m.id !== command.machineId);
		for (const m of s.matches) if (m.plannedMachineId === command.machineId) m.plannedMachineId = null;
	} else if (command.type === "display-settings") {
		check(typeof command.enabled === "boolean", "Choose whether to enable ads.");
		check(
			Number.isInteger(command.intervalSeconds) && command.intervalSeconds >= 2 && command.intervalSeconds <= 60,
			"Ad interval must be 2–60 seconds.",
		);
		s.ads = { enabled: command.enabled, intervalSeconds: command.intervalSeconds };
	} else if (command.type === "announce") {
		check(
			typeof command.text === "string" && command.text.trim().length > 0 && command.text.trim().length <= 500,
			"Enter a message of 1–500 characters.",
		);
		check(
			Number.isInteger(command.seconds) &&
				(command.seconds === 0 || (command.seconds >= 5 && command.seconds <= 300)),
			"Choose 5–300 seconds, or 0 until cleared.",
		);
		s.announcement = {
			id: `notice-${s.revision + 1}`,
			text: command.text.trim(),
			expiresAt: command.seconds ? now + command.seconds * 1000 : null,
		};
	} else if (command.type === "clear-announcement") {
		s.announcement = null;
	} else if (command.type === "round-settings") {
		check(
			Array.isArray(command.targets) &&
				command.targets.length === s.roundNames.length &&
				command.targets.every(validTarget),
			"Choose 1–9 wins for each bracket round.",
		);
		s.roundTargets = [...command.targets];
		s.target = command.targets[0];
		for (const m of s.matches)
			if (
				["waiting", "ready"].includes(m.status) &&
				!m.customTarget &&
				!m.legs.some((l) => l.winnerId || l.score.some((n) => n !== null))
			) {
				m.target = s.roundTargets[m.round - 1];
				m.legs = Array.from({ length: m.target * 2 - 1 }, newLeg);
			}
	} else if (command.type === "match-settings") {
		const m = s.matches.find((m) => m.id === command.matchId);
		check(m, "Match not found.");
		check(
			Array.isArray(command.players) && command.players.length === m.players.filter(Boolean).length,
			"Provide the named players in this match.",
		);
		check(new Set(command.players.map((p) => p.id)).size === command.players.length, "Player IDs must be unique.");
		for (const input of command.players) {
			check(m.players.includes(input.id), "Player does not belong to this match.");
			check(
				typeof input.name === "string" && input.name.trim().length > 0 && input.name.trim().length <= 60,
				"Player names must contain 1–60 characters.",
			);
			s.players.find((p) => p.id === input.id).name = input.name.trim();
		}
		check(
			new Set(s.players.map((p) => p.name.toLowerCase())).size === s.players.length,
			"Player names must be unique.",
		);
		if (command.plannedMachineId !== undefined) {
			check(
				command.plannedMachineId === null || s.machines.some((b) => b.id === command.plannedMachineId),
				"Choose an available machine ID.",
			);
			check(
				!["playing", "finished"].includes(m.status) || command.plannedMachineId === m.plannedMachineId,
				"Machine planning is only available before a game starts.",
			);
			m.plannedMachineId = command.plannedMachineId;
		}
		check(validTarget(command.target), "Choose 1–9 wins.");
		if (command.target !== m.target) {
			check(m.status !== "finished", "A finished match format cannot change. Undo its result first.");
			const max = command.target * 2 - 1;
			check(
				!m.legs.slice(max).some((l) => l.winnerId || l.score.some((n) => n !== null)),
				"The shorter format would discard recorded legs. Clear those legs first.",
			);
			m.target = command.target;
			m.customTarget = true;
			const legs = Array.from({ length: max }, (_, i) => m.legs[i] || newLeg());
			Object.assign(m, validateLegs(m, legs));
		}
	} else if (command.type === "start") {
		check(s.phase === "setup", "Reset the tournament before starting a new one.");
		check(Array.isArray(command.names), "Enter the player names.");
		const model = getModel(
			command.modelId ?? ([16, 32].includes(command.names.length) ? `single-${command.names.length}` : s.modelId),
		);
		check(command.names.length === model.playerCount, `Enter exactly ${model.playerCount} player names.`);
		s.modelId = model.id;
		s.playerCount = model.playerCount;
		s.roundNames = [...model.roundNames];
		s.roundTargets = targetsForModel(s.roundTargets, model);
		s.target = s.roundTargets[0];
		const names = command.names.map((n) => (typeof n === "string" ? n.trim() : ""));
		check(
			names.every((n) => n.length > 0 && n.length <= 60),
			"Each player name must contain 1–60 characters.",
		);
		check(new Set(names.map((n) => n.toLowerCase())).size === model.playerCount, "Player names must be unique.");
		check(
			typeof command.title === "string" && command.title.trim().length > 0 && command.title.length <= 80,
			"Enter a tournament title (1–80 characters).",
		);
		s.title = command.title.trim();
		s.phase = "running";
		s.players = names.map((name, i) => ({ id: `p${i + 1}`, name }));
		s.matches = createMatches(model, s.players, s.roundTargets);
		for (const m of s.matches) m.uuid = randomUUID();
	} else if (command.type === "reset") {
		return {
			...initialState(),
			revision: s.revision,
			machines: s.machines,
			ads: s.ads,
			modelId: s.modelId,
			playerCount: s.playerCount,
			roundNames: s.roundNames,
			roundTargets: s.roundTargets,
			target: s.roundTargets[0],
		};
	} else {
		check(s.phase === "running", "There is no active tournament.");
		const m = s.matches.find((m) => m.id === command.matchId);
		check(m, "Match not found.");
		if (command.type === "assign") {
			check(m.status === "ready", "Only a ready match can be assigned.");
			check(
				s.machines.some((b) => b.id === command.machineId),
				"Unknown machine.",
			);
			check(
				!s.matches.some((m) => m.status === "playing" && m.machineId === command.machineId),
				"This machine is occupied.",
			);
			m.machineId = command.machineId;
			m.status = "playing";
			m.calledAt = now;
			m.callId = `call-${s.revision + 1}`;
			m.timing.runningSince = now;
			m.machineHistory.push({
				machineId: command.machineId,
				machineName: s.machines.find((b) => b.id === command.machineId).name,
				startedAt: now,
				endedAt: null,
			});
		} else if (command.type === "unassign") {
			check(m.status === "playing", "Match is not playing.");
			stopTimer(m, now);
			m.machineId = null;
			m.status = "ready";
		} else if (command.type === "score" || command.type === "finish") {
			check(m.status === "playing", "Assign the match to a machine first.");
			const result = validateLegs(m, command.legs ?? legsFromScore(m, command.score));
			Object.assign(m, result);
			if (command.type === "finish") {
				check(
					Math.max(...m.score) === m.target && m.score[0] !== m.score[1],
					`Winner must have ${m.target} legs.`,
				);
				const slot = m.score[0] > m.score[1] ? 0 : 1;
				m.winnerId = m.players[slot];
				m.status = "finished";
				m.finishedAt = new Date(now).toISOString();
				stopTimer(m, now);
				if (m.winnerTo) {
					const next = s.matches.find((n) => n.id === m.winnerTo.matchId);
					check(next.players[m.winnerTo.slot] === null, "Next bracket slot is already filled.");
					next.players[m.winnerTo.slot] = m.winnerId;
					if (next.players.every(Boolean)) next.status = "ready";
				} else s.phase = "complete";
			}
		} else throw new Error("Unknown command.");
	}
	return s;
}
export function readyQueue(s) {
	return s.matches.filter((m) => m.status === "ready");
}

function stopTimer(m, now) {
	if (m.timing.runningSince !== null) {
		m.timing.elapsedMs = (m.timing.elapsedMs ?? 0) + Math.max(0, now - m.timing.runningSince);
		m.timing.runningSince = null;
	}
	const visit = m.machineHistory.at(-1);
	if (visit && visit.endedAt === null) visit.endedAt = now;
}
