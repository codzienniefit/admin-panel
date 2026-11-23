import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "@/data/api/capabilities";
import { ApiError } from "@/data/api/errors";
import { failureFrom } from "./failures";
import { fromMessage, toMessage } from "./messages";
import { conflict, withCurrent } from "./shared";
import {
	failure,
	fakeBackend,
	firebaseRecord,
	wireMessage,
} from "./testSupport";
import { toSearchResult } from "./users";

// Points raised when the client's tests were written (2026-11-11) and
// settled afterwards. Each group says what would have gone wrong.

describe("a success that is not JSON is never taken for a save", () => {
	it("fails also when the call checks no schema", async () => {
		const backend = fakeBackend();
		backend.on("PUT", "accounts/u1", {
			status: 200,
			text: "<!doctype html><title>Sign in</title>",
		});
		const error = await failure(
			backend.transport.request({
				method: "PUT",
				path: ["accounts", "u1"],
				body: { email: "a@example.test" },
			}),
		);
		expect(error.kind).toBe("server");
		expect(error.message).toMatch(/to nie jest JSON/);
		expect(error.status).toBe(200);
	});

	it("still accepts an empty answer", async () => {
		const backend = fakeBackend();
		backend.on("DELETE", "manageBadges/b1", { status: 204, text: "" });
		await expect(
			backend.transport.request({
				method: "DELETE",
				path: ["manageBadges", "b1"],
			}),
		).resolves.toBeUndefined();
	});
});

describe("a file too large for the backend says so", () => {
	it("reads 413 as a refusal, not as the backend failing", () => {
		const error = failureFrom(413, undefined);
		expect(error.kind).toBe("validation");
		expect(error.message).toBe(
			"Plik jest za duży, żeby go wysłać. (Szczegóły: HTTP 413, odpowiedź bez treści)",
		);
		expect(error.issues).toEqual([{ path: "", message: error.message }]);
		expect(error.status).toBe(413);
	});
});

describe("a 409 keeps what the backend said", () => {
	it("uses the backend's words when it gave some", async () => {
		const thrown = new ApiError("conflict", "Workout W1 is used by C3, C7", {
			status: 409,
			current: { id: "W1" },
		});
		const error = await failure(
			withCurrent(
				async () => {
					throw thrown;
				},
				(raw) => raw,
				async () => ({ id: "reread" }),
			),
		);
		expect(error.kind).toBe("conflict");
		expect(error.message).toBe("Workout W1 is used by C3, C7");
		expect(error.current).toEqual({ id: "W1" });
		expect(error.status).toBe(409);
	});

	it("has its own words when the backend gave none", () => {
		expect(conflict(undefined).message).toBe("Ktoś zmienił to w międzyczasie.");
		expect(conflict(undefined, 409, "").message).toBe("");
	});
});

describe("a message keeps fields this build does not know", () => {
	it("sends them back, and never what the backend owns", () => {
		const message = toMessage(
			wireMessage({ futureField: { kept: true }, targetGroupValue: "C1" }),
		);
		const body = fromMessage(message);
		expect(body.futureField).toEqual({ kept: true });
		expect(body.targetGroupValue).toBe("C1");
		expect(body.createdAtUtc).toBe(message.createdAtUtc);
		expect(body.id).toBe(message.id);
		for (const owned of [
			"etag",
			"status",
			"sentAtUtc",
			"archivedAtUtc",
			"updatedAtUtc",
		]) {
			expect(body, owned).not.toHaveProperty(owned);
		}
	});

	it("leaves out an empty group value and the id of a new message", () => {
		const { id: _id, etag: _etag, ...fresh } = toMessage(wireMessage());
		const body = fromMessage({ ...fresh, targetGroupValue: null });
		expect(body).not.toHaveProperty("id");
		expect(body).not.toHaveProperty("targetGroupValue");
	});
});

describe("search rows carry only what the list shows", () => {
	it("drops anything else the backend puts on a row", () => {
		const result = toSearchResult({
			users: [
				{
					uid: "u1",
					email: "ada@example.test",
					displayName: "Ada",
					emailVerified: true,
					disabled: false,
					providers: ["password"],
					createdAtUtc: "2026-01-02T03:04:05.000Z",
					lastSignInAtUtc: null,
					phoneNumber: "+48 600 000 000",
					customClaims: { admin: true },
					passwordHash: "not-for-the-panel",
				},
			],
			totalMatches: 7,
			truncated: true,
			indexedAtUtc: "2026-11-11T10:00:00.000Z",
		});
		expect(result.totalMatches).toBe(7);
		expect(result.truncated).toBe(true);
		expect(Object.keys(result.users[0] ?? {}).sort()).toEqual([
			"createdAtUtc",
			"disabled",
			"displayName",
			"email",
			"emailVerified",
			"lastSignInAtUtc",
			"providers",
			"uid",
		]);
		expect(JSON.stringify(result)).not.toContain("not-for-the-panel");
		expect(JSON.stringify(result)).not.toContain("600 000 000");
	});

	it("reads a raw Firebase record as a row too", () => {
		const result = toSearchResult({ users: [firebaseRecord()] });
		expect(result.users).toHaveLength(1);
		expect(result.totalMatches).toBe(1);
		expect(result.users[0]).not.toHaveProperty("hasProSubscription");
		expect(result.users[0]).not.toHaveProperty("passwordHash");
	});

	it("fails loudly on a row without an id", () => {
		expect(() =>
			toSearchResult({ users: [{ email: "x@example.test" }] }),
		).toThrow(ApiError);
	});
});

describe("the capability table used above exists", () => {
	it("has every write on in Test", () => {
		expect(
			Object.values(ALL_CAPABILITIES.writes).every((m) => m === "on"),
		).toBe(true);
	});
});
