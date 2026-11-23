import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable, refuse } from "@/data/api/capabilities";
import { isApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import type { ContentStatus } from "@/data/schemas/common";
import {
	type NewWorkout,
	type Workout,
	workoutSchema,
} from "@/data/schemas/workout";
import { unexpectedAnswer } from "./failures";
import {
	addedAt,
	CONTENT_DATE_FRACTION,
	checkSave,
	conform,
	exactIds,
	exactText,
	exactTitle,
	isoInstantOrNull,
	READ_ONLY_FIELDS,
	readWarnings,
	savedId,
	sentUpdatedAt,
	statusFields,
	statusFrom,
	statusWatch,
	versionOf,
	wholeNumber,
	withCurrent,
} from "./shared";
import type { Transport } from "./transport";

// Workouts: `manageWorkouts` of the backend (WorkoutUpsertAdminDto in,
// WorkoutResultAdminDto out; src/handlers/admin/manageWorkoutsHandler.ts for
// what a save does).
//
// `recordingStatus` and `format` (the production fields the planner shows)
// have no place in the panel's schema yet. They are kept on the workout as
// they came and sent back as they were, like any field this build does not
// know: left out of a save the backend would keep them, sent as null it
// would clear them, and the panel never does the second by accident.

export const wireWorkoutSchema = z.looseObject({
	id: z.string(),
	etag: z.string().nullish(),
	title: z.string().nullish(),
	status: z.string().nullish(),
	hidden: z.boolean().nullish(),
	pro: z.boolean().nullish(),
	durationMinutes: z.number().nullish(),
	trainingTypeIds: z.array(z.string()).nullish(),
	addedAtUtc: z.string().nullish(),
	updatedAtUtc: z.string().nullish(),
	// Only in the answer to a save: what publishing would refuse.
	warnings: z.array(z.unknown()).nullish(),
});

export function toWorkout(raw: unknown): Workout {
	const { warnings: said, ...wire } = conform(
		wireWorkoutSchema,
		raw,
		"Trening",
	);
	const warnings = readWarnings(said);
	return conform(
		workoutSchema,
		{
			...wire,
			// Kept on the workout the save answered with, for the screen to
			// show; never sent back, and gone with the next read of the list.
			...(warnings.length > 0 ? { warnings } : {}),
			etag: versionOf(wire),
			status: statusFrom(wire),
			title: wire.title ?? "",
			pro: wire.pro ?? false,
			// The backend stores seconds and divides; a row without a length
			// comes back as null.
			durationMinutes: wholeNumber(wire.durationMinutes, 0),
			trainingTypeIds: wire.trainingTypeIds ?? [],
			addedAtUtc: wire.addedAtUtc ?? "",
			updatedAtUtc: wire.updatedAtUtc ?? "",
		},
		`Trening ${wire.id}`,
	);
}

/**
 * The id the backend gives a workout made from a YouTube address: the video
 * id. Same pattern as its `extractYouTubeVideoID`, so both sides agree.
 */
export function youTubeId(url: string | null | undefined): string | null {
	const pattern =
		/^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
	return pattern.exec(url ?? "")?.[1] ?? null;
}

/**
 * The request body for a save: WorkoutUpsertAdminDto.
 *
 * With `etag` on (the editing contract) what the backend would refuse for
 * its spelling alone is put right first: see "Sent exactly as it is to be
 * stored" in shared.ts.
 */
export function fromWorkout(
	workout: Workout | NewWorkout,
	capabilities: Capabilities,
	now: () => string = () => new Date().toISOString(),
): Record<string, unknown> {
	const { etag: _etag, status, hidden: _hidden, ...rest } = workout;
	// What the backend keeps about the workout itself is not an edit.
	for (const field of READ_ONLY_FIELDS) {
		delete (rest as Record<string, unknown>)[field];
	}
	const isNew = typeof workout.id !== "string";
	const body: Record<string, unknown> = {
		// Supplied by whoever made the picture; kept when it was loaded.
		blurHash: null,
		...rest,
		// Null makes the backend assign the id.
		id: isNew ? null : workout.id,
		...statusFields(status, capabilities),
		imageRelativePath: workout.imageRelativePath ?? "",
		// Before the editing contract the backend called a string method on
		// this and threw on null (BACKEND-SCOPE B5.3); "" is "no film" for both.
		videoUrl: workout.videoUrl ?? "",
		updatedAtUtc:
			typeof workout.updatedAtUtc === "string" && workout.updatedAtUtc
				? workout.updatedAtUtc
				: now(),
	};
	if (capabilities.etag) {
		// An address, a path or an id with a space around it is refused, not
		// trimmed: it is sent without.
		for (const field of ["levelId", "badgeId", "audioRelativePath"] as const) {
			body[field] = exactText(body[field]);
		}
		body.videoUrl = exactText(body.videoUrl) ?? "";
		body.imageRelativePath = exactText(body.imageRelativePath) ?? "";
		body.title = exactTitle(body.title);
		body.trainingTypeIds = exactIds(body.trainingTypeIds);
		body.equipmentIds = exactIds(body.equipmentIds);
		addedAt(body, isNew, now);
		// A full instant or null: "" is not "no date" there, and a date
		// without a time or a zone is left for the backend to refuse.
		for (const field of ["addedAtUtc", "liveAtUtc", "availableAtUtc"]) {
			if (field in body) {
				body[field] = isoInstantOrNull(body[field], CONTENT_DATE_FRACTION);
			}
		}
		sentUpdatedAt(body);
	}
	return body;
}

const MARK = { field: "Komentarz wewnętrzny", path: "internalTitle" } as const;

export interface WorkoutsArea {
	api: ApiClient["workouts"];
	read(id: string): Promise<Workout>;
}

export function workoutsArea(
	transport: Transport,
	capabilities: Capabilities,
): WorkoutsArea {
	// See challenges.ts: tells a change of status from an edit.
	const watch = statusWatch<Workout>();
	const take = (raw: unknown): Workout => watch.remember(toWorkout(raw));

	const read = async (id: string) =>
		take(await transport.request({ path: ["manageWorkouts", id] }));

	async function exists(id: string): Promise<boolean> {
		try {
			await read(id);
			return true;
		} catch (error) {
			if (isApiError(error) && error.kind === "notFound") return false;
			throw error;
		}
	}

	async function write(
		body: Record<string, unknown>,
		headers: Record<string, string>,
		knownId: string | null,
	): Promise<Workout> {
		const raw = await transport.request({
			method: "POST",
			path: ["manageWorkouts"],
			body,
			headers,
		});
		// The panel's route answers with the saved workout; Retool's, and the
		// backend before 2026-11-13, only name it.
		const direct = wireWorkoutSchema.safeParse(raw);
		if (direct.success && "title" in direct.data) return take(raw);
		const id = knownId ?? savedId(raw, /Workout (\S+) updated/);
		if (!id) {
			throw unexpectedAnswer(
				"Zapisano trening, ale backend nie podał jego identyfikatora. Odśwież listę.",
			);
		}
		return read(id);
	}

	/** Publish, hide, back to draft, delete, restore: the stored workout, another status. */
	async function changeStatus(
		id: string,
		status: ContentStatus,
		headers: Record<string, string>,
	): Promise<Workout> {
		return take(
			await transport.request({
				method: "POST",
				path: ["manageWorkouts", id, "status"],
				body: { status },
				headers,
			}),
		);
	}

	return {
		read,
		api: {
			async list() {
				const rows = await transport.request({
					path: ["manageWorkouts"],
					// Without it the backend leaves the bin out; the panel shows it.
					query: capabilities.status ? { includeDeleted: true } : undefined,
					schema: z.array(z.unknown()),
					what: "Lista treningów",
				});
				return rows.map(take);
			},
			async create(workout) {
				assertWritable(capabilities, "workouts", {
					texts: [workout.internalTitle],
					...MARK,
				});
				// A new workout with a YouTube address gets the video's id. The
				// backend only ever inserts a new workout now and answers 409
				// WORKOUT_EXISTS when the id is taken; before the editing
				// contract it wrote without looking, and one that existed would
				// have been replaced (BACKEND-SCOPE B5.2), so the panel looks.
				const videoId = youTubeId(workout.videoUrl);
				if (!capabilities.etag && videoId && (await exists(videoId))) {
					refuse(
						`Trening z tym filmem już istnieje (${videoId}). Zapis nadpisałby go; otwórz tamten trening.`,
						"videoUrl",
					);
				}
				return write(fromWorkout(workout, capabilities), {}, null);
			},
			async save(workout, options) {
				const headers = await checkSave({
					capabilities,
					area: "workouts",
					incoming: workout,
					etag: options.etag,
					readStored: () => read(workout.id),
					markOf: (item) => item.internalTitle,
					...MARK,
				});
				// See challenges.ts: a delete, or a status and nothing else.
				const stored = watch.storedStatus(workout.id, options.etag);
				const statusAlone =
					capabilities.status &&
					((workout.status === "deleted" && stored !== "deleted") ||
						watch.onlyStatusChanged(workout, options.etag));
				return withCurrent(
					() =>
						statusAlone
							? changeStatus(workout.id, workout.status, headers)
							: write(fromWorkout(workout, capabilities), headers, workout.id),
					take,
					() => read(workout.id),
				);
			},
		},
	};
}
