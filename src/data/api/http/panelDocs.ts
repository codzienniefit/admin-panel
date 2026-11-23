import { z } from "zod";
import type { Capabilities } from "@/data/api/capabilities";
import { assertWritable, refuse } from "@/data/api/capabilities";
import { isApiError } from "@/data/api/errors";
import type { ApiClient } from "@/data/api/types";
import type { Challenge } from "@/data/schemas/challenge";
import {
	blankPlanning,
	type Planning,
	planningSchema,
	UNSAVED_ETAG,
} from "@/data/schemas/planning";
import {
	PLANNER_SETTINGS_ID,
	type PlannerSettings,
	plannerSettingsSchema,
} from "@/data/schemas/settings";
import { DEFAULT_PLAN_TYPES } from "@/domain/conditions";
import { formerPathIds } from "./challenges";
import { conform, withCurrent } from "./shared";
import type { Answer, Transport } from "./transport";

// Planning documents and the planner's settings: data only the panel reads.
//
// The store is the backend's `panel/manage/panelDocs/{kind}/{id}`
// (src/handlers/admin/panelDocsHandler.ts; the Worker adds `panel/`). With
// the `planning` capability off it is not asked at all: reads then answer
// with blank documents and the defaults, and saves are refused. Whether the
// panel may save is `writes.planning`.
//
//   GET  manage/panelDocs/{kind}?bodies=true  → [{ id, etag, updatedAtUtc, updatedBy, body }]
//   GET  manage/panelDocs/{kind}/{id}         → that, with the etag as a header too; or 404
//   PUT  manage/panelDocs/{kind}/{id}         → the same, after saving: 201 when created, 200 otherwise
//        If-Match: <etag>      for a document that exists
//        If-None-Match: *      for the first save
//        409 PANEL_DOC_CONFLICT { current: document | null }  when it lost
//        404 PANEL_DOC_NOT_FOUND  a version was named and the document is gone
//        428 when neither header is sent; 413 PANEL_DOC_TOO_LARGE; 400 PANEL_DOC_BAD_…
// `body` is stored and returned as it was sent, unknown fields included.
// The kinds are a fixed list in the backend ("challengePlanning",
// "settings"); an id is letters, digits, "_" and "-", at most 64.
//
// The planning document of a challenge goes to the bin with it and comes
// back with it (the backend does both). While it is there the list does not
// have it and a save that names its version is answered 404.

const PLANNING_KIND = "challengePlanning";
const SETTINGS_KIND = "settings";

const docSchema = z.looseObject({
	id: z.string().nullish(),
	etag: z.string().nullish(),
	updatedAtUtc: z.string().nullish(),
	body: z.record(z.string(), z.unknown()).nullish(),
});

/**
 * A stored document as the panel's entity: the body, with the identity and
 * version the store keeps beside it. The store's values win over anything
 * of the same name inside the body.
 */
export function fromDoc<T>(
	raw: unknown,
	schema: z.ZodType<T>,
	what: string,
	fallback: { id: string; etag?: string | null },
): T {
	const doc = conform(docSchema, raw, what);
	const etag = doc.etag ?? fallback.etag;
	return conform(
		schema,
		{
			...(doc.body ?? {}),
			id: doc.id ?? fallback.id,
			etag: etag ?? "",
			updatedAtUtc: doc.updatedAtUtc ?? "",
		},
		what,
	);
}

/** What is stored: the entity without what the store keeps itself. */
export function toDocBody(
	entity: Record<string, unknown>,
): Record<string, unknown> {
	const { id: _id, etag: _etag, updatedAtUtc: _updated, ...body } = entity;
	return body;
}

/** The header that makes the store refuse a save based on an old version. */
export function versionHeader(etag: string): Record<string, string> {
	return etag === UNSAVED_ETAG || etag === ""
		? { "if-none-match": "*" }
		: { "if-match": etag };
}

export function defaultPlannerSettings(): PlannerSettings {
	return {
		id: PLANNER_SETTINGS_ID,
		etag: UNSAVED_ETAG,
		updatedAtUtc: "",
		planTypes: structuredClone([...DEFAULT_PLAN_TYPES]),
		trainingTypeStyles: {},
		folders: [],
	};
}

const NOT_YET =
	"Produkcja nie zapisuje jeszcze notatek, wymagań ani ustawień planera: planowanie jest w niej wyłączone (przełącznik `planning`). Te funkcje działają na razie tylko w środowisku Test.";

const IN_BIN =
	"To wyzwanie jest w koszu, a jego notatki razem z nim. Przywróć wyzwanie, żeby je zmieniać.";

const MARK = { field: "Komentarz wewnętrzny wyzwania", path: "" } as const;

/**
 * Moves what is planned about a variant from an id this client made up for
 * it (while the backend had none) to the id the backend has given it since.
 *
 * That happens when a challenge from before path ids is saved by something
 * that proposes no id: Retool, a delete and restore, the status call (see
 * "Variant ids" in challenges.ts). The planning document still names the
 * variant the old way; read like this it follows the variant, and the next
 * save of the document stores it under the new id.
 *
 * A key is moved only when nothing could be lost or mixed up: no variant
 * of the challenge has it as its id any more, the variant it was made up
 * for is still at that level, and that variant has nothing planned yet.
 */
export function carryVariantKeys(
	planning: Planning,
	paths: readonly { pathId: string; levelId: string }[],
): Planning {
	const current = new Set(paths.map((path) => path.pathId));
	const former = formerPathIds(paths.map((path) => path.levelId));
	let variants: Planning["variants"] | null = null;
	paths.forEach((path, index) => {
		for (const key of former[index] ?? []) {
			const from: Planning["variants"] = variants ?? planning.variants;
			const planned = from[key];
			if (planned === undefined || current.has(key)) continue;
			if (from[path.pathId] !== undefined) continue;
			const moved = { ...from, [path.pathId]: planned };
			delete moved[key];
			variants = moved;
		}
	});
	return variants ? { ...planning, variants } : planning;
}

export interface PanelDocsDeps {
	/** Ids of all challenges; every one gets a planning document. */
	challengeIds(): Promise<string[]>;
	/**
	 * The challenges themselves, loaded a moment ago or now. With them the
	 * list can follow a variant whose id changed, and a save in test-only
	 * mode can tell a test item.
	 */
	challenges?(): Promise<Challenge[]>;
	/**
	 * The challenges as last loaded, however long ago, without asking the
	 * backend. Enough to keep a save away from a challenge in the bin, and
	 * cheap enough for every save.
	 */
	lastChallenges?(): Challenge[] | undefined;
}

export function panelDocsArea(
	transport: Transport,
	capabilities: Capabilities,
	deps: PanelDocsDeps,
): Pick<ApiClient, "planning" | "settings"> {
	const withEtag = (answer: Answer<unknown>, id: string) => ({
		id,
		etag: answer.etag,
	});

	async function put<T extends { id: string }>(
		kind: string,
		entity: T,
		etag: string,
		schema: z.ZodType<T>,
		what: string,
		// What a stored document is read through, also the one a conflict
		// carries: the same document the list would have shown.
		read: (stored: T) => T = (stored) => stored,
	): Promise<T> {
		const path = ["manage", "panelDocs", kind, entity.id];
		const headers = versionHeader(etag);
		return withCurrent(
			async () => {
				// A version named for a document that is gone is a 404 with the
				// backend's own words, never a conflict: creating it again would take
				// the place of the one in the bin, which comes back with its challenge.
				const answer = await transport.send({
					method: "PUT",
					path,
					body: toDocBody(entity),
					headers,
				});
				return read(
					fromDoc(answer.data, schema, what, withEtag(answer, entity.id)),
				);
			},
			(raw) => read(fromDoc(raw, schema, what, { id: entity.id })),
			async () => {
				const answer = await transport.send({ path });
				return read(
					fromDoc(answer.data, schema, what, withEtag(answer, entity.id)),
				);
			},
		);
	}

	return {
		planning: {
			async list() {
				const challenges = deps.challenges ? await deps.challenges() : null;
				const ids = challenges
					? challenges.map((challenge) => challenge.id)
					: await deps.challengeIds();
				const pathsOf = new Map(
					(challenges ?? []).map((challenge) => [
						challenge.id,
						challenge.paths,
					]),
				);
				const stored = new Map<string, Planning>();
				if (capabilities.planning) {
					const rows = await transport.request({
						path: ["manage", "panelDocs", PLANNING_KIND],
						query: { bodies: true },
						schema: z.array(z.unknown()),
						what: "Dokumenty planowania",
					});
					for (const row of rows) {
						const doc = fromDoc(row, planningSchema, "Dokument planowania", {
							id: "",
						});
						const paths = pathsOf.get(doc.id);
						stored.set(doc.id, paths ? carryVariantKeys(doc, paths) : doc);
					}
				}
				// One per challenge; a document for a challenge that is gone is
				// left where it is and not shown.
				return ids.map((id) => stored.get(id) ?? blankPlanning(id));
			},
			async save(planning, options) {
				if (!capabilities.planning) refuse(NOT_YET);
				const mode = capabilities.writes.planning;
				// The section's switch first: a closed one costs no request.
				assertWritable(capabilities, "planning", { texts: [], ...MARK });
				const challenge = (
					mode === "test-only"
						? await deps.challenges?.()
						: deps.lastChallenges?.()
				)?.find((item) => item.id === planning.id);
				// A document has no comment of its own: it is a test item when
				// the challenge it belongs to is one.
				if (mode === "test-only") {
					assertWritable(capabilities, "planning", {
						texts: [challenge?.internalTitle],
						...MARK,
					});
				}
				// The document of a challenge in the bin is in the bin too, and
				// the list shows a blank one in its place. Saving that would
				// take the place of the stored one for good.
				if (challenge?.status === "deleted") refuse(IN_BIN);
				return put(
					PLANNING_KIND,
					planning,
					options.etag,
					planningSchema,
					"Dokument planowania",
					(stored) =>
						challenge ? carryVariantKeys(stored, challenge.paths) : stored,
				);
			},
		},
		settings: {
			async planner() {
				if (!capabilities.planning) return defaultPlannerSettings();
				try {
					const answer = await transport.send({
						path: ["manage", "panelDocs", SETTINGS_KIND, PLANNER_SETTINGS_ID],
					});
					return fromDoc(
						answer.data,
						plannerSettingsSchema,
						"Ustawienia planera",
						withEtag(answer, PLANNER_SETTINGS_ID),
					);
				} catch (error) {
					// Nobody has saved them yet.
					if (isApiError(error) && error.kind === "notFound") {
						return defaultPlannerSettings();
					}
					throw error;
				}
			},
			async savePlanner(settings, options) {
				if (!capabilities.planning) refuse(NOT_YET);
				// Shared by the whole team: there is no test version of them.
				assertWritable(capabilities, "planning", null);
				return put(
					SETTINGS_KIND,
					{ ...settings, id: settings.id || PLANNER_SETTINGS_ID },
					options.etag,
					plannerSettingsSchema,
					"Ustawienia planera",
				);
			},
		},
	};
}
