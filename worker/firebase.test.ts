import { describe, expect, it } from "vitest";
import { signInWithGoogle } from "./firebase";
import {
	ADMIN,
	type Call,
	FIREBASE_KEY,
	fakeIdToken,
	firebaseError,
	IDP_URL,
	jsonAnswer,
	makeWorld,
	ORIGIN,
	refreshTokenOf,
	type World,
} from "./testSupport";

const RETURN_ADDRESS = `${ORIGIN}/auth/google/callback`;

/** A token of Google's that the fake Firebase knows. */
function googleToken(world: World): string {
	const token = fakeIdToken({ sub: ADMIN.googleSub, email: ADMIN.email });
	world.google.issued.push(token);
	return token;
}

const exchange = (world: World, token: string, key = FIREBASE_KEY) =>
	signInWithGoogle(world.deps, key, token, RETURN_ADDRESS);

describe("signInWithGoogle", () => {
	it("exchanges Google's token for a Firebase token of the same person", async () => {
		const world = makeWorld();
		const result = await exchange(world, googleToken(world));
		expect(result).toEqual({ ok: true, value: world.firebase.issued[0] });
		expect(world.firebase.issued).toHaveLength(1);
	});

	it("makes one call, to Firebase's signInWithIdp, with the web key and nothing secret", async () => {
		const world = makeWorld();
		const token = googleToken(world);
		await exchange(world, token);
		expect(world.calls).toHaveLength(1);
		const call = world.calls[0] as Call;
		expect(call.url).toBe(`${IDP_URL}?key=${FIREBASE_KEY}`);
		expect(call.method).toBe("POST");
		expect(Object.fromEntries(call.headers)).toEqual({
			"content-type": "application/json",
		});
		const sent = JSON.parse(call.body ?? "") as Record<string, unknown>;
		expect(sent).toEqual({
			postBody: expect.any(String),
			requestUri: RETURN_ADDRESS,
			returnSecureToken: true,
			returnIdpCredential: false,
		});
		expect(
			Object.fromEntries(new URLSearchParams(String(sent.postBody))),
		).toEqual({ id_token: token, providerId: "google.com" });
	});

	it("encodes the key into the address", async () => {
		const world = makeWorld();
		world.on(IDP_URL, () => firebaseError("API key not valid."));
		await exchange(world, "t", "a key&with=odd characters");
		expect(world.calls[0]?.url).toBe(
			`${IDP_URL}?key=a%20key%26with%3Dodd%20characters`,
		);
	});

	it("returns the id token and never the refresh token that comes with it", async () => {
		const world = makeWorld();
		const result = await exchange(world, googleToken(world));
		expect(JSON.stringify(result)).not.toContain(refreshTokenOf(ADMIN));
		expect(Object.keys(result)).toEqual(["ok", "value"]);
	});

	const refused = async (answer: () => Response) => {
		const world = makeWorld();
		world.firebase.answer = answer;
		const result = await exchange(world, "a-google-token");
		return result.ok ? "ok" : result.reason;
	};

	it("is a refusal when Firebase answers without a token", async () => {
		// An e-mail already used with another way of signing in, or an account
		// with Firebase's own second factor.
		for (const body of [
			{ needConfirmation: true, email: ADMIN.email },
			{ mfaPendingCredential: "pending", mfaInfo: [] },
			{ idToken: "" },
			{ idToken: 7 },
			{ refreshToken: refreshTokenOf(ADMIN) },
			{},
			[],
			null,
		]) {
			expect(await refused(() => jsonAnswer(body)), JSON.stringify(body)).toBe(
				"rejected",
			);
		}
		expect(await refused(() => new Response("not json"))).toBe("rejected");
	});

	it("names why Firebase refused", async () => {
		for (const [message, status, reason] of [
			[
				"INVALID_IDP_RESPONSE : The supplied auth credential is malformed",
				400,
				"rejected",
			],
			["INVALID_ID_TOKEN", 400, "rejected"],
			["EMAIL_EXISTS", 400, "rejected"],
			["FEDERATED_USER_ID_ALREADY_LINKED", 400, "rejected"],
			["", 400, "rejected"],
			["USER_DISABLED", 400, "disabled"],
			["USER_DISABLED : The user account has been disabled", 400, "disabled"],
			["TOO_MANY_ATTEMPTS_TRY_LATER : Try again later", 400, "tooManyAttempts"],
			["QUOTA_EXCEEDED", 429, "tooManyAttempts"],
			["OPERATION_NOT_ALLOWED", 400, "misconfigured"],
			["CONFIGURATION_NOT_FOUND", 400, "misconfigured"],
			["INVALID_IDP_RESPONSE_CONFIG", 400, "misconfigured"],
			["PROJECT_NOT_FOUND", 400, "misconfigured"],
			["API_KEY_SERVICE_BLOCKED", 400, "misconfigured"],
			["API key not valid. Please pass a valid API key.", 400, "misconfigured"],
			["PERMISSION_DENIED", 403, "misconfigured"],
			["INTERNAL", 500, "unavailable"],
			["UNAVAILABLE", 503, "unavailable"],
		] as const) {
			expect(
				await refused(() => firebaseError(message, status)),
				`${status} ${message}`,
			).toBe(reason);
		}
	});

	it("names a refusal it cannot read by its status", async () => {
		for (const [status, reason] of [
			[400, "rejected"],
			[401, "rejected"],
			[403, "misconfigured"],
			[429, "tooManyAttempts"],
			[500, "unavailable"],
			[502, "unavailable"],
		] as const) {
			expect(
				await refused(() => new Response("<html></html>", { status })),
				String(status),
			).toBe(reason);
			expect(
				await refused(() => jsonAnswer({ error: "text" }, status)),
				String(status),
			).toBe(reason);
		}
	});

	it("is unavailable when Firebase cannot be reached", async () => {
		const world = makeWorld();
		world.on(IDP_URL, () => {
			throw new TypeError("fetch failed");
		});
		expect(await exchange(world, "a-google-token")).toEqual({
			ok: false,
			reason: "unavailable",
		});
	});

	it("is refused by Firebase for a token Google did not issue", async () => {
		const world = makeWorld();
		const forged = fakeIdToken({ sub: ADMIN.googleSub, email: ADMIN.email });
		expect(await exchange(world, forged)).toEqual({
			ok: false,
			reason: "rejected",
		});
		expect(world.firebase.issued).toEqual([]);
	});

	it("is misconfigured with a key Firebase does not know", async () => {
		const world = makeWorld();
		expect(await exchange(world, googleToken(world), "another-key")).toEqual({
			ok: false,
			reason: "misconfigured",
		});
	});
});
