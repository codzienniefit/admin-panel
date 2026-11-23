import { describe, expect, it, vi } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import { isTestUpload, mediaArea, toMediaFile } from "./media";
import {
	capabilities,
	errorReply,
	failure,
	fakeBackend,
	json,
	production,
	SWITCHED_OFF,
	validationReply,
} from "./testSupport";
import { UPLOAD_TIMEOUT_MS } from "./transport";

// Rows and answers below follow `manageMedia/files` as it is today
// (docs/research/backend-audit.md §1a, §4a: AllMediaResponseDto,
// MediaFileDto, MediaUploadResponseDto; §6 media flow; §9.4).

const FILES = "manageMedia/files";

function thrownBy(run: () => unknown): ApiError {
	try {
		run();
	} catch (error) {
		if (error instanceof ApiError) return error;
		throw error;
	}
	throw new Error("test: expected it to throw");
}

/** MediaUploadResponseDto. */
const uploaded = (overrides: Record<string, unknown> = {}) => ({
	requestedRelativePath: "test/Zdjęcie 1.webp",
	relativePath: "test/zdjecie-1.webp",
	type: "image",
	contentType: "image/webp",
	cacheControl: "public, max-age=31536000, immutable",
	pathSanitized: true,
	renamedToAvoidOverwrite: false,
	faststartApplied: false,
	faststartReason: "not-applicable",
	originalSizeBytes: 3,
	uploadedSizeBytes: 3,
	message: "File uploaded",
	...overrides,
});

describe("toMediaFile", () => {
	it("reads a file as the backend lists it", () => {
		expect(
			toMediaFile({
				path: "workouts/mobilnosc.webp",
				type: "image",
				createdAtUtc: "2026-11-03T12:00:00.000Z",
			}),
		).toEqual({
			path: "workouts/mobilnosc.webp",
			type: "image",
			createdAtUtc: "2026-11-03T12:00:00.000Z",
		});
	});

	it.each(["image", "audio", "video", "other"])("keeps the type %s", (type) => {
		expect(
			toMediaFile({ path: "a", type, createdAtUtc: "2026-11-03T12:00:00.000Z" })
				.type,
		).toBe(type);
	});

	it.each(["document", "Image", "", null, undefined])(
		"reads the type %j, which it does not know, as other",
		(type) => {
			expect(
				toMediaFile({
					path: "a",
					type,
					createdAtUtc: "2026-11-03T12:00:00.000Z",
				}).type,
			).toBe("other");
		},
	);

	it("keeps fields this build does not know", () => {
		const file = toMediaFile({
			path: "workouts/a.webp",
			type: "image",
			createdAtUtc: "2026-11-03T12:00:00.000Z",
			sizeBytes: 20480,
			widthPx: 1200,
		});
		expect(file.sizeBytes).toBe(20480);
		expect(file.widthPx).toBe(1200);
	});

	it("fails loudly for a file without a path", () => {
		const error = thrownBy(() => toMediaFile({ type: "image" }));
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Plik: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["path"]);
	});

	it("fails loudly, naming the file, when its date is missing", () => {
		const error = thrownBy(() =>
			toMediaFile({ path: "workouts/a.webp", type: "image" }),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Plik workouts/a.webp: dane nie pasują");
		expect(error.issues.map((issue) => issue.path)).toEqual(["createdAtUtc"]);
	});
});

describe("isTestUpload", () => {
	it.each([
		"test/a.webp",
		"workouts/test/a.webp",
		"test/workouts/a.webp",
		"workouts/TEST/a.webp",
		"/test/a.webp",
		"workouts//test//a.webp",
		"test-a.webp",
		"workouts/test-a.webp",
		"workouts/Test-A.webp",
		"workouts/TEST-a.webp",
	])("is true for %s", (path) => {
		expect(isTestUpload(path)).toBe(true);
	});

	it.each([
		"",
		"a.webp",
		"workouts/a.webp",
		// Not a folder: a file that is merely called "test".
		"test",
		"workouts/test",
		"workouts/test.webp",
		"workouts/testowy.webp",
		"workouts/a-test-b.webp",
		"workouts/contest-a.webp",
		"workouts/latest/a.webp",
		"workouts/testy/a.webp",
		"test-folder/a.webp",
		"workouts/test a.webp",
	])("is false for %j", (path) => {
		expect(isTestUpload(path)).toBe(false);
	});
});

describe("mediaArea: list", () => {
	it("lists the files with one request", async () => {
		const backend = fakeBackend().on(
			"GET",
			FILES,
			json({
				files: [
					{
						path: "audio/medytacja.mp3",
						type: "audio",
						createdAtUtc: "2026-11-03T12:00:00.000Z",
					},
					{
						path: "docs/regulamin.pdf",
						type: "document",
						createdAtUtc: "2026-10-01T12:00:00.000Z",
					},
				],
			}),
		);
		const api = mediaArea(backend.transport, SWITCHED_OFF);
		expect(await api.list()).toEqual([
			{
				path: "audio/medytacja.mp3",
				type: "audio",
				createdAtUtc: "2026-11-03T12:00:00.000Z",
			},
			{
				path: "docs/regulamin.pdf",
				type: "other",
				createdAtUtc: "2026-10-01T12:00:00.000Z",
			},
		]);
		expect(backend.calls()).toEqual([`GET ${FILES}`]);
		expect(backend.only("GET", FILES).query).toEqual({});
	});

	it("reads an empty container", async () => {
		const backend = fakeBackend().on("GET", FILES, json({ files: [] }));
		expect(await mediaArea(backend.transport, SWITCHED_OFF).list()).toEqual([]);
	});

	it("fails when the answer has no list of files", async () => {
		for (const answer of [[], {}, { files: null }]) {
			const backend = fakeBackend().on("GET", FILES, json(answer));
			const error = await failure(
				mediaArea(backend.transport, SWITCHED_OFF).list(),
			);
			expect(error.kind).toBe("server");
			expect(error.message).toContain("Lista plików");
		}
	});

	it("passes on the backend failing", async () => {
		const backend = fakeBackend().on(
			"GET",
			FILES,
			errorReply(500, "Failed to return files: RestError"),
		);
		const error = await failure(
			mediaArea(backend.transport, SWITCHED_OFF).list(),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});
});

describe("mediaArea: upload", () => {
	const ON = capabilities({ writes: { media: "on" } });
	const TEST_ONLY = capabilities({ writes: { media: "test-only" } });
	const file = new Blob(["abc"], { type: "image/webp" });

	it("posts the file as the body, with the path in the query", async () => {
		const backend = fakeBackend().on("POST", FILES, json(uploaded()));
		const api = mediaArea(backend.transport, ON);

		const result = await api.upload(file, {
			relativePath: "test/Zdjęcie 1.webp",
		});

		expect(result).toMatchObject({
			requestedRelativePath: "test/Zdjęcie 1.webp",
			// The name the backend really stored it under.
			relativePath: "test/zdjecie-1.webp",
			type: "image",
			pathSanitized: true,
			renamedToAvoidOverwrite: false,
		});
		expect(backend.calls()).toEqual([`POST ${FILES}`]);
		const request = backend.only("POST", FILES);
		expect(request.query).toEqual({ relativePath: "test/Zdjęcie 1.webp" });
		expect(request.body).toBe(file);
		expect(request.headers["content-type"]).toBe("image/webp");
		expect(request.timeoutMs).toBe(UPLOAD_TIMEOUT_MS);
	});

	it("always goes through the sender that can report progress", async () => {
		const backend = fakeBackend().on("POST", FILES, json(uploaded()));
		const api = mediaArea(backend.transport, ON);
		await api.upload(file, { relativePath: "test/a.webp" });
		await api.upload(file, {
			relativePath: "test/a.webp",
			onProgress: () => {},
		});
		expect(backend.requests.map((request) => request.sender)).toEqual([
			"upload",
			"upload",
		]);
	});

	it("passes progress on to the caller", async () => {
		const onProgress = vi.fn();
		const backend = fakeBackend().on("POST", FILES, (request) => {
			request.onProgress?.(0.25);
			request.onProgress?.(1);
			return json(uploaded());
		});
		await mediaArea(backend.transport, ON).upload(file, {
			relativePath: "test/a.webp",
			onProgress,
		});
		expect(onProgress.mock.calls).toEqual([[0.25], [1]]);
	});

	it("tells when the backend stored the file under another name", async () => {
		const backend = fakeBackend().on(
			"POST",
			FILES,
			json(
				uploaded({
					requestedRelativePath: "workouts/a.webp",
					relativePath: "workouts/a-1.webp",
					pathSanitized: false,
					renamedToAvoidOverwrite: true,
				}),
			),
		);
		const result = await mediaArea(backend.transport, ON).upload(file, {
			relativePath: "workouts/a.webp",
		});
		expect(result.relativePath).toBe("workouts/a-1.webp");
		expect(result.renamedToAvoidOverwrite).toBe(true);
	});

	it("reads a type it does not know as other, and keeps the rest of the answer", async () => {
		const backend = fakeBackend().on(
			"POST",
			FILES,
			json(uploaded({ type: "document", contentType: "application/pdf" })),
		);
		const result = await mediaArea(backend.transport, ON).upload(file, {
			relativePath: "docs/a.pdf",
		});
		expect(result.type).toBe("other");
		expect(result.contentType).toBe("application/pdf");
		expect(result.message).toBe("File uploaded");
	});

	it("fails when the answer does not say where the file went", async () => {
		const backend = fakeBackend().on(
			"POST",
			FILES,
			json({ result: "File uploaded" }),
		);
		const error = await failure(
			mediaArea(backend.transport, ON).upload(file, {
				relativePath: "workouts/a.webp",
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toContain("Wynik wysyłania pliku");
	});

	it("makes no request while media are read-only", async () => {
		const backend = fakeBackend();
		const error = await failure(
			mediaArea(backend.transport, SWITCHED_OFF).upload(file, {
				relativePath: "test/a.webp",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Media”");
		expect(backend.requests).toEqual([]);
	});

	it("uploads only test files in test-only mode", async () => {
		const backend = fakeBackend().on("POST", FILES, json(uploaded()));
		const api = mediaArea(backend.transport, TEST_ONLY);

		const error = await failure(
			api.upload(file, { relativePath: "workouts/mobilnosc.webp" }),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{ path: "relativePath", message: error.message },
		]);
		expect(backend.requests).toEqual([]);

		await api.upload(file, { relativePath: "workouts/test-mobilnosc.webp" });
		await api.upload(file, { relativePath: "test/mobilnosc.webp" });
		expect(backend.all("POST", FILES)).toHaveLength(2);
	});

	it("reports the backend failing on a file it cannot store", async () => {
		// mp4 and ogg always fail today (audit §9.4).
		const backend = fakeBackend().on(
			"POST",
			FILES,
			errorReply(
				500,
				"Failed to upload file: Error: Failed to get blob content type",
			),
		);
		const error = await failure(
			mediaArea(backend.transport, ON).upload(
				new Blob(["abc"], { type: "video/mp4" }),
				{ relativePath: "test/a.mp4" },
			),
		);
		expect(error.kind).toBe("server");
		expect(error.status).toBe(500);
	});

	it("reports a lost connection as a network error", async () => {
		const backend = fakeBackend().on("POST", FILES, () => {
			throw new TypeError("Network request failed");
		});
		const error = await failure(
			mediaArea(backend.transport, ALL_CAPABILITIES).upload(file, {
				relativePath: "workouts/a.webp",
			}),
		);
		expect(error.kind).toBe("network");
	});
});

describe("mediaArea: urlFor", () => {
	it("gives the panel's own address of the public file, without a request", () => {
		const backend = fakeBackend();
		const api = mediaArea(backend.transport, SWITCHED_OFF);
		expect(api.urlFor("workouts/mobilnosc.webp")).toBe(
			"/api/files?path=workouts%2Fmobilnosc.webp",
		);
		expect(backend.requests).toEqual([]);
	});

	it("keeps an odd path one query value", () => {
		const api = mediaArea(fakeBackend().transport, SWITCHED_OFF);
		const url = new URL(
			api.urlFor("workouts/a b&x=1#y?.webp"),
			"https://panel.example",
		);
		expect(url.pathname).toBe("/api/files");
		expect([...url.searchParams.keys()]).toEqual(["path"]);
		expect(url.searchParams.get("path")).toBe("workouts/a b&x=1#y?.webp");
		expect(url.hash).toBe("");
	});
});

// ─── The backend as built on 2026-11-13 ─────────────────────────────────────
//
// Answers below are the ones the backend's own tests show
// (tests/handlers/mediaPanelContract.test.ts).

const MB = 1024 * 1024;
/** Produkcja's features, with media accepted. */
const OPEN = production({ writes: { media: "on" } });

describe("toMediaFile: a row of the panel's route", () => {
	it("keeps the size the panel's route sends", () => {
		expect(
			toMediaFile({
				path: "workouts/a.webp",
				type: "image",
				createdAtUtc: "2026-05-01T00:00:00.000Z",
				sizeBytes: 1000,
			}),
		).toEqual({
			path: "workouts/a.webp",
			type: "image",
			createdAtUtc: "2026-05-01T00:00:00.000Z",
			sizeBytes: 1000,
		});
	});

	it("reads a file whose size the storage did not say as one without a size", () => {
		// `sizeBytes: null` is what the DTO allows; the list must not fail on it.
		const file = toMediaFile({
			path: "audio/run.m4a",
			type: "audio",
			createdAtUtc: "2026-02-01T00:00:00.000Z",
			sizeBytes: null,
		});
		expect(file).not.toHaveProperty("sizeBytes");
		expect(file.path).toBe("audio/run.m4a");
	});

	it("still fails loudly for a size that is not a number", () => {
		const error = thrownBy(() =>
			toMediaFile({
				path: "a.webp",
				type: "image",
				createdAtUtc: "2026-02-01T00:00:00.000Z",
				sizeBytes: "1000",
			}),
		);
		expect(error.kind).toBe("server");
	});
});

describe("mediaArea: the panel's route", () => {
	const file = new Blob(["abc"], { type: "image/webp" });

	it("lists the whole container, sizes included", async () => {
		// "the panel gets every file with its size".
		const backend = fakeBackend().on(
			"GET",
			FILES,
			json({
				files: [
					{
						path: "workouts/a.webp",
						type: "image",
						createdAtUtc: "2026-05-01T00:00:00.000Z",
						sizeBytes: 1000,
					},
					{
						path: "audio/run.m4a",
						type: "audio",
						createdAtUtc: "2026-02-01T00:00:00.000Z",
						sizeBytes: null,
					},
				],
			}),
		);
		const files = await mediaArea(backend.transport, production()).list();
		expect(files.map((item) => [item.path, item.sizeBytes])).toEqual([
			["workouts/a.webp", 1000],
			["audio/run.m4a", undefined],
		]);
		// Whole, not a page: no prefix, no page size, no token.
		expect(backend.only("GET", FILES).query).toEqual({});
	});

	it("shows the backend's message when it refuses a file as too large", async () => {
		const size = 5 * MB + 1;
		const text = `The file has ${size} bytes; the limit for image files is ${5 * MB} bytes`;
		const backend = fakeBackend().on("POST", FILES, {
			status: 413,
			body: {
				error: text,
				errorCode: "FILE_TOO_LARGE",
				maxBytes: 5 * MB,
				sizeBytes: size,
				issues: [{ path: "", code: "FILE_TOO_LARGE", message: text }],
			},
		});
		const error = await failure(
			mediaArea(backend.transport, OPEN).upload(file, {
				relativePath: "workouts/huge.webp",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(413);
		expect(error.message).toBe(text);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
	});

	it("shows the backend's message when it refuses a kind of file", async () => {
		// "the panel is refused a file type that is not on the list".
		const text =
			"Files of type '.m4v' cannot be uploaded. Allowed: webp, png, jpg, m4a, mp3, wav, ogg, mp4";
		const backend = fakeBackend().on(
			"POST",
			FILES,
			validationReply(
				[
					{
						path: "relativePath",
						code: "UNSUPPORTED_FILE_TYPE",
						message: text,
					},
				],
				undefined,
				{
					allowedExtensions: [
						"webp",
						"png",
						"jpg",
						"m4a",
						"mp3",
						"wav",
						"ogg",
						"mp4",
					],
				},
			),
		);
		const error = await failure(
			mediaArea(backend.transport, OPEN).upload(file, {
				relativePath: "audio/trening.m4v",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.status).toBe(422);
		expect(error.message).toBe(text);
		expect(error.issues).toEqual([
			{ path: "relativePath", message: error.message },
		]);
	});

	it("keeps the Worker's refusal of a body over its own limit", async () => {
		const backend = fakeBackend().on("POST", FILES, {
			status: 413,
			body: {
				error: "Plik jest za duży, żeby go wysłać.",
				errorCode: "TOO_LARGE",
			},
		});
		const error = await failure(
			mediaArea(backend.transport, OPEN).upload(file, {
				relativePath: "audio/long.mp3",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe("Plik jest za duży, żeby go wysłać.");
	});

	it("is refused without a request in Produkcja as it is", async () => {
		const backend = fakeBackend();
		const error = await failure(
			mediaArea(backend.transport, production()).upload(file, {
				relativePath: "test/a.webp",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.message).toContain("„Media”");
		expect(backend.requests).toEqual([]);
	});
});

// ─── The backend as made strict (second pass) ───────────────────────────────

describe("mediaArea: the stricter backend", () => {
	const OPEN_STRICT = production({ writes: { media: "on" } });
	const picture = new Blob(["RIFFxxxxWEBP"], { type: "image/webp" });

	it("asks for the path the backend would store, so it never has to change it", async () => {
		// "the path must already be clean (PATH_NOT_CLEAN)". The client cleans
		// it by the backend's own rule (domain/mediaRules.ts) and does not
		// send a file twice to find out.
		const backend = fakeBackend().on("POST", FILES, (request) =>
			json(
				uploaded({
					requestedRelativePath: request.query.relativePath,
					relativePath: request.query.relativePath,
					pathSanitized: false,
				}),
			),
		);
		const api = mediaArea(backend.transport, OPEN_STRICT);

		const result = await api.upload(picture, {
			relativePath: "workouts/Moje Zdjęcie (1) .webp",
		});

		expect(backend.only("POST", FILES).query).toEqual({
			relativePath: "workouts/moje-zdjecie-1.webp",
		});
		expect(result.relativePath).toBe("workouts/moje-zdjecie-1.webp");
		expect(backend.requests).toHaveLength(1);
	});

	it.each([
		["audio/weird...name.m4a", "audio/weird.name.m4a"],
		["audio/ spaced name .m4a", "audio/spaced-name.m4a"],
		["workouts/a - .b.webp", "workouts/a.b.webp"],
		["badges/odznaka.webp", "badges/odznaka.webp"],
	])("sends %s as %s", async (given, sent) => {
		const backend = fakeBackend().on("POST", FILES, json(uploaded()));
		await mediaArea(backend.transport, OPEN_STRICT).upload(picture, {
			relativePath: given,
		});
		expect(backend.only("POST", FILES).query.relativePath).toBe(sent);
	});

	it("shows the backend's refusal of a path, and does not send it again under another name", async () => {
		const backend = fakeBackend().on(
			"POST",
			FILES,
			validationReply(
				[
					{
						path: "relativePath",
						code: "PATH_NOT_CLEAN",
						message:
							"relativePath 'workouts/x_.webp' is not a clean path (lower-case letters, digits, '.', '_' and '-', folders separated by '/'). This file could be stored as 'workouts/x.webp'",
					},
				],
				undefined,
				{ cleanPath: "workouts/x.webp" },
			),
		);
		const error = await failure(
			mediaArea(backend.transport, OPEN_STRICT).upload(picture, {
				relativePath: "workouts/x_.webp",
			}),
		);
		expect(error.kind).toBe("validation");
		expect(error.issues).toEqual([
			{
				path: "relativePath",
				message:
					"relativePath 'workouts/x_.webp' is not a clean path (lower-case letters, digits, '.', '_' and '-', folders separated by '/'). This file could be stored as 'workouts/x.webp'",
			},
		]);
		// Not sent again under another name the person did not see.
		expect(backend.requests).toHaveLength(1);
	});

	it("says a file is too large for the panel, whoever stopped it", async () => {
		// The backend's guard above 33 MB, the panel's Worker above 32 MB.
		for (const body of [
			{
				error: "Plik jest za duży, żeby go wysłać przez panel.",
				errorCode: "BODY_TOO_LARGE",
			},
			{ error: "Plik jest za duży, żeby go wysłać.", errorCode: "TOO_LARGE" },
		]) {
			const backend = fakeBackend().on("POST", FILES, { status: 413, body });
			const error = await failure(
				mediaArea(backend.transport, OPEN_STRICT).upload(picture, {
					relativePath: "audio/long.mp3",
				}),
			);
			expect(error.kind).toBe("validation");
			expect(error.status).toBe(413);
			expect(error.message).toBe(body.error);
		}
	});

	it("judges a test file by the path that is sent", async () => {
		const backend = fakeBackend().on("POST", FILES, json(uploaded()));
		const api = mediaArea(
			backend.transport,
			production({ writes: { media: "test-only" } }),
		);
		await api.upload(picture, { relativePath: "workouts/TEST-Okładka.webp" });
		expect(backend.only("POST", FILES).query.relativePath).toBe(
			"workouts/test-okladka.webp",
		);
		const error = await failure(
			api.upload(picture, { relativePath: "workouts/okładka.webp" }),
		);
		expect(error.kind).toBe("validation");
		expect(backend.requests).toHaveLength(1);
	});

	it("sends the path as it was given while the backend does not speak the editing contract", async () => {
		const backend = fakeBackend().on("POST", FILES, json(uploaded()));
		await mediaArea(
			backend.transport,
			production({ etag: false, writes: { media: "on" } }),
		).upload(picture, { relativePath: "workouts/Moje Zdjęcie.webp" });
		expect(backend.only("POST", FILES).query.relativePath).toBe(
			"workouts/Moje Zdjęcie.webp",
		);
	});
});
