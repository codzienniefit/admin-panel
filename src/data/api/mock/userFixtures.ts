import type { UserAccount, UserBadge, UserProgress } from "@/data/schemas/user";
import { slugify } from "@/domain/text";
import { iso, UNKNOWN_FIELD } from "./fixtures";

// Made-up people. Every address ends in example.test, a domain reserved for
// testing, and every id starts with "test-": nothing here can be mistaken
// for, or collide with, a real account.

const FIRST = [
	"Anna",
	"Maria",
	"Katarzyna",
	"Małgorzata",
	"Agnieszka",
	"Barbara",
	"Ewa",
	"Zofia",
	"Piotr",
	"Tomasz",
];
const LAST = [
	"Testowa",
	"Przykładowa",
	"Próbna",
	"Demonowska",
	"Wzorcowa",
	"Makietowa",
];
const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A small seeded generator, so the sample data is the same on every load. */
export function seeded(seed: number) {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	return {
		next,
		int: (min: number, max: number) =>
			min + Math.floor(next() * (max - min + 1)),
		pick: <T>(list: readonly T[]): T =>
			list[Math.floor(next() * list.length)] as T,
		chance: (probability: number) => next() < probability,
	};
}

export function buildUserFixtures(): UserAccount[] {
	const rng = seeded(7001);
	const users: UserAccount[] = [];
	for (const [l, last] of LAST.entries()) {
		for (const [f, first] of FIRST.entries()) {
			const n = l * FIRST.length + f + 1;
			const uid = `test-${Array.from({ length: 20 }, () => rng.pick([...ID_CHARS])).join("")}`;
			const provider = rng.pick([
				"password",
				"password",
				"google.com",
				"apple.com",
			]);
			const created = rng.int(30, 900);
			users.push({
				uid,
				email: `${slugify(first)}.${slugify(last)}${n}@example.test`,
				// Not everyone gives a name when signing up.
				displayName: rng.chance(0.15) ? null : `${first} ${last}`,
				emailVerified: provider !== "password" || rng.chance(0.7),
				disabled: rng.chance(0.04),
				providers: [provider],
				createdAtUtc: iso(created),
				lastSignInAtUtc: iso(rng.int(0, Math.min(created, 60))),
				hasProSubscription: rng.chance(0.3),
				[UNKNOWN_FIELD]: `user:${n}`,
			});
		}
	}
	return users;
}

interface ProgressSources {
	workoutIds: readonly string[];
	challenges: ReadonlyArray<{
		id: string;
		lengthDays: number;
		levelIds: readonly string[];
		badgeId: string | null;
	}>;
	/** Badges earned by counting, lowest count first. */
	milestones: ReadonlyArray<{ id: string; count: number }>;
}

/**
 * What one sample person has done, derived from their position in the list:
 * the same person always has the same history.
 */
export function buildUserHistory(
	index: number,
	sources: ProgressSources,
): { progress: UserProgress; earned: UserBadge[] } {
	const rng = seeded(9000 + index);
	// Every fifth person has only just signed up.
	const workoutCount = index % 5 === 4 ? 0 : rng.int(1, 60);

	const workouts =
		sources.workoutIds.length === 0
			? []
			: Array.from({ length: workoutCount }, (_, i) => ({
					workoutId: rng.pick(sources.workoutIds),
					completedAtUtc: iso(i * 2 + rng.next()),
					[UNKNOWN_FIELD]: "completion",
				}));

	const challenges = (workoutCount === 0 ? [] : sources.challenges)
		.filter(() => rng.chance(0.12))
		.slice(0, 5)
		.map((challenge, i) => {
			const startedDaysAgo = 20 + i * 40 + rng.int(0, 15);
			const outcome = i === 0 ? "active" : rng.pick(["completed", "aborted"]);
			const completedDays =
				outcome === "completed"
					? challenge.lengthDays
					: rng.int(1, Math.max(1, challenge.lengthDays - 1));
			return {
				challengeId: challenge.id,
				levelId: challenge.levelIds.length
					? rng.pick(challenge.levelIds)
					: null,
				startedAtUtc: iso(startedDaysAgo),
				completedAtUtc:
					outcome === "completed"
						? iso(Math.max(0, startedDaysAgo - challenge.lengthDays))
						: null,
				abortedAtUtc:
					outcome === "aborted" ? iso(Math.max(0, startedDaysAgo - 5)) : null,
				completedDays,
				[UNKNOWN_FIELD]: "attempt",
			};
		});

	const earned: UserBadge[] = [];
	const earn = (badgeId: string, daysAgo: number) => {
		if (earned.some((item) => item.badgeId === badgeId)) return;
		earned.push({
			badgeId,
			earnedAtUtc: iso(daysAgo),
			grantId: null,
			[UNKNOWN_FIELD]: "userBadge",
		});
	};
	for (const milestone of sources.milestones) {
		if (workoutCount >= milestone.count) {
			earn(milestone.id, (workoutCount - milestone.count) * 2);
		}
	}
	for (const attempt of challenges) {
		const badgeId = sources.challenges.find(
			(c) => c.id === attempt.challengeId,
		)?.badgeId;
		if (attempt.completedAtUtc && badgeId) earn(badgeId, 30);
	}

	return { progress: { workouts, challenges }, earned };
}
