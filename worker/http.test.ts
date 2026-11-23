import { describe, expect, it } from "vitest";
import {
	clearCookie,
	cookie,
	failure,
	fromOwnPage,
	json,
	loadedByOwnPage,
	navigatedFromPanel,
	PANEL_HEADER,
	readCookies,
	redirect,
	SECURITY_HEADERS,
	safeRedirect,
} from "./http";
import { ORIGIN } from "./testSupport";

const request = (
	headers: Record<string, string> = {},
	method = "GET",
): Request => new Request(`${ORIGIN}/api/x`, { method, headers });

describe("answers", () => {
	it("json carries the body, the status and every header a data answer needs", async () => {
		const response = json({ a: 1, text: "zażółć" }, 201);
		expect(response.status).toBe(201);
		expect(await response.json()).toEqual({ a: 1, text: "zażółć" });
		expect(Object.fromEntries(response.headers)).toEqual({
			"content-type": "application/json; charset=utf-8",
			"cache-control": "no-store",
			"content-security-policy": "default-src 'none'; frame-ancestors 'none'",
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "same-origin",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
		});
	});

	it("json answers 200 without cookies unless told otherwise", () => {
		const response = json({});
		expect(response.status).toBe(200);
		expect(response.headers.getSetCookie()).toEqual([]);
	});

	it("json sets each cookie in a header of its own", () => {
		const response = json({}, 200, [
			"__Host-a=1; Path=/",
			"__Host-b=2; Path=/",
		]);
		expect(response.headers.getSetCookie()).toEqual([
			"__Host-a=1; Path=/",
			"__Host-b=2; Path=/",
		]);
	});

	it("failure is the envelope the panel's client reads", async () => {
		const response = failure(403, "Nie wolno.", "FOREIGN_REQUEST", [
			"__Host-a=; Path=/",
		]);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "Nie wolno.",
			errorCode: "FOREIGN_REQUEST",
		});
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.getSetCookie()).toEqual(["__Host-a=; Path=/"]);
	});

	it("redirect is a 303 with no body, never stored, with the same headers", async () => {
		const response = redirect("/challenges", ["__Host-a=1; Path=/"]);
		expect(response.status).toBe(303);
		expect(await response.text()).toBe("");
		expect(Object.fromEntries(response.headers)).toEqual({
			location: "/challenges",
			"cache-control": "no-store",
			"content-security-policy": "default-src 'none'; frame-ancestors 'none'",
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "same-origin",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
			"set-cookie": "__Host-a=1; Path=/",
		});
	});

	it("the shared headers are the ones the rules name", () => {
		expect(SECURITY_HEADERS).toEqual({
			"x-content-type-options": "nosniff",
			"cross-origin-resource-policy": "same-origin",
			"referrer-policy": "no-referrer",
			"x-frame-options": "DENY",
		});
	});
});

describe("readCookies", () => {
	const read = (header: string | null) =>
		Object.fromEntries(
			readCookies(header === null ? request() : request({ cookie: header })),
		);

	it("reads none from a request without cookies", () => {
		expect(read(null)).toEqual({});
		expect(read("")).toEqual({});
	});

	it("reads each name and value", () => {
		expect(read("__Host-cf_session=abc.def-ghi_; other=1")).toEqual({
			"__Host-cf_session": "abc.def-ghi_",
			other: "1",
		});
	});

	it("allows any spacing and keeps `=` inside a value", () => {
		expect(read("a=1;b=2;  c = 3 ; d=x=y==")).toEqual({
			a: "1",
			b: "2",
			c: "3",
			d: "x=y==",
		});
	});

	it("skips what has no name or no `=`", () => {
		expect(read("=1; flag; ; a=1;  =2")).toEqual({ a: "1" });
	});

	it("keeps the first of two cookies with one name", () => {
		expect(read("a=first; a=second")).toEqual({ a: "first" });
	});

	it("reads an empty value as empty", () => {
		expect(read("__Host-cf_session=; a=1")).toEqual({
			"__Host-cf_session": "",
			a: "1",
		});
	});

	it("tells names apart by case", () => {
		expect(read("__host-cf_session=lower; __Host-cf_session=right")).toEqual({
			"__host-cf_session": "lower",
			"__Host-cf_session": "right",
		});
	});
});

describe("cookie", () => {
	it("is HttpOnly, Secure, for the whole site and for no other host", () => {
		expect(
			cookie("__Host-cf_session", "value", { maxAge: 600, sameSite: "Strict" }),
		).toBe(
			"__Host-cf_session=value; Path=/; Max-Age=600; HttpOnly; Secure; SameSite=Strict",
		);
	});

	it("never names a Domain, which `__Host-` forbids", () => {
		const made = cookie("__Host-a", "v", { maxAge: 1, sameSite: "Lax" });
		expect(made.toLowerCase()).not.toContain("domain");
		expect(made).toContain("SameSite=Lax");
	});

	it("writes whole seconds, never below zero", () => {
		const maxAge = (seconds: number) =>
			/Max-Age=([^;]+)/.exec(
				cookie("__Host-a", "v", { maxAge: seconds, sameSite: "Strict" }),
			)?.[1];
		expect(maxAge(172800)).toBe("172800");
		expect(maxAge(599.9)).toBe("599");
		expect(maxAge(0)).toBe("0");
		expect(maxAge(-5)).toBe("0");
	});

	it("refuses to make a cookie without the `__Host-` name", () => {
		for (const name of ["cf_session", "__Secure-cf_session", "__host-a", ""]) {
			expect(
				() => cookie(name, "v", { maxAge: 1, sameSite: "Strict" }),
				name,
			).toThrow();
		}
	});

	it("clearCookie empties it at once, Strict unless told otherwise", () => {
		expect(clearCookie("__Host-cf_session")).toBe(
			"__Host-cf_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict",
		);
		expect(clearCookie("__Host-cf_oauth", "Lax")).toBe(
			"__Host-cf_oauth=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax",
		);
	});
});

describe("fromOwnPage", () => {
	const own = {
		[PANEL_HEADER]: "1",
		"sec-fetch-site": "same-origin",
		origin: ORIGIN,
	};
	const check = (headers: Record<string, string>, method = "GET") =>
		fromOwnPage(request(headers, method), ORIGIN);

	it("the panel's header is `x-cf-panel`", () => {
		expect(PANEL_HEADER).toBe("x-cf-panel");
	});

	it("accepts a request with all three signs, for every method", () => {
		for (const method of ["GET", "POST", "PUT", "DELETE"]) {
			expect(check(own, method), method).toBe(true);
		}
	});

	it("accepts a GET or a POST without Origin: browsers leave it out on same-origin reads", () => {
		const { origin: _, ...rest } = own;
		expect(check(rest)).toBe(true);
		expect(check(rest, "POST")).toBe(true);
	});

	it("refuses without the panel's header, or with another value in it", () => {
		const { [PANEL_HEADER]: _, ...rest } = own;
		expect(check(rest)).toBe(false);
		expect(check(rest, "POST")).toBe(false);
		for (const value of ["0", "true", "1 ", "11", "yes"]) {
			// A trailing space is trimmed by Headers itself; "1 " is "1".
			const expected = value.trim() === "1";
			expect(check({ ...own, [PANEL_HEADER]: value }), value).toBe(expected);
		}
	});

	it("refuses every Sec-Fetch-Site but same-origin", () => {
		for (const site of ["cross-site", "same-site", "none", "", "SAME-ORIGIN"]) {
			for (const method of ["GET", "POST"]) {
				expect(
					check({ ...own, "sec-fetch-site": site }, method),
					`${method} ${site}`,
				).toBe(false);
			}
		}
	});

	it("without Sec-Fetch-Site: a GET passes, anything that changes something does not", () => {
		const { "sec-fetch-site": _, ...rest } = own;
		expect(check(rest, "GET")).toBe(true);
		for (const method of [
			"POST",
			"PUT",
			"DELETE",
			"PATCH",
			"HEAD",
			"OPTIONS",
		]) {
			expect(check(rest, method), method).toBe(false);
		}
	});

	it("refuses an Origin that is not exactly the panel's", () => {
		for (const sent of [
			"https://evil.example.test",
			"null",
			"",
			`${ORIGIN}.evil.example.test`,
			`${ORIGIN}:8443`,
			ORIGIN.replace("https://", "http://"),
			`${ORIGIN}/`,
			ORIGIN.toUpperCase(),
			"https://sub.panel.example.test",
		]) {
			expect(check({ ...own, origin: sent }), sent).toBe(false);
			expect(check({ ...own, origin: sent }, "POST"), sent).toBe(false);
		}
	});

	it("judges by the origin it is given, not by the request's own address", () => {
		const elsewhere = new Request("https://other.example.test/api/x", {
			headers: { ...own, origin: "https://other.example.test" },
		});
		expect(fromOwnPage(elsewhere, ORIGIN)).toBe(false);
		expect(fromOwnPage(elsewhere, "https://other.example.test")).toBe(true);
	});
});

describe("navigatedFromPanel and loadedByOwnPage", () => {
	it("a navigation counts from the panel itself or the address bar", () => {
		expect(
			navigatedFromPanel(request({ "sec-fetch-site": "same-origin" })),
		).toBe(true);
		expect(navigatedFromPanel(request({ "sec-fetch-site": "none" }))).toBe(
			true,
		);
	});

	it("a navigation from anywhere else, or one that does not say, does not", () => {
		for (const site of ["cross-site", "same-site", "", "None"]) {
			expect(
				navigatedFromPanel(request({ "sec-fetch-site": site })),
				site,
			).toBe(false);
		}
		expect(navigatedFromPanel(request())).toBe(false);
	});

	it("a file counts as loaded by the panel only with same-origin", () => {
		expect(loadedByOwnPage(request({ "sec-fetch-site": "same-origin" }))).toBe(
			true,
		);
		for (const site of ["none", "cross-site", "same-site", ""]) {
			expect(loadedByOwnPage(request({ "sec-fetch-site": site })), site).toBe(
				false,
			);
		}
		expect(loadedByOwnPage(request())).toBe(false);
		// The panel's header does not stand in for the browser's word.
		expect(loadedByOwnPage(request({ [PANEL_HEADER]: "1" }))).toBe(false);
	});
});

describe("safeRedirect", () => {
	const safe = (target: string | null) => safeRedirect(target, ORIGIN);

	it("keeps a path inside the panel, with its query and fragment", () => {
		for (const target of [
			"/",
			"/challenges",
			"/challenges/abc-123",
			"/users?query=ada&page=2",
			"/messages/draft-7#preview",
			"/planner?week=2026-11-09#friday",
			// Only the whole first segment makes an address the Worker's own.
			"/apiary",
			"/authors",
			"/loginx",
			"/x/login",
			"/x/api/files",
		]) {
			expect(safe(target), target).toBe(target);
		}
	});

	it("answers `/` for nothing at all", () => {
		expect(safe(null)).toBe("/");
		expect(safe("")).toBe("/");
	});

	it("answers `/` for anything that is not a path from the root", () => {
		for (const target of [
			"challenges",
			"./challenges",
			"../challenges",
			"?x=1",
			"#x",
			"https://evil.example.test/",
			"http://evil.example.test/",
			`${ORIGIN}/challenges`,
			"javascript:alert(1)",
			"data:text/html,x",
			" /challenges",
		]) {
			expect(safe(target), target).toBe("/");
		}
	});

	it("answers `/` for an address on another host", () => {
		for (const target of [
			"//evil.example.test",
			"//evil.example.test/challenges",
			"///evil.example.test",
			"/\\evil.example.test",
			"/\\/evil.example.test",
			"\\\\evil.example.test",
			"\\/evil.example.test",
		]) {
			expect(safe(target), target).toBe("/");
		}
	});

	it("answers `/` for a backslash or a control character anywhere", () => {
		for (const target of [
			"/a\\b",
			"/challenges\\..\\api",
			"/a\tb",
			"/a\nb",
			"/a\rb",
			"/\t/evil.example.test",
			"/a\u0000b",
			"/a\u001fb",
		]) {
			expect(safe(target), JSON.stringify(target)).toBe("/");
		}
	});

	it("answers `/` for the sign-in page itself", () => {
		for (const target of ["/login", "/login?error=failed", "/login#x"]) {
			expect(safe(target), target).toBe("/");
		}
	});

	it("answers `/` for the Worker's own addresses", () => {
		for (const target of [
			"/api",
			"/api/",
			"/api/files?path=x",
			"/api/manageUsers",
			"/auth",
			"/auth/google/start",
			"/auth/signout",
			"/API/files",
			"/Auth/google/start",
		]) {
			expect(safe(target), target).toBe("/");
		}
	});

	it("resolves dot segments before judging (finding 13 of the review)", () => {
		for (const target of [
			"/x/../api/files",
			"/x/../api/files?path=a.js",
			"/./auth/google/start",
			"/x/y/../../auth/signout",
			"/x/./../login",
			"/challenges/../login",
			"/../api/files",
			"/..",
		]) {
			expect(safe(target), target).toBe("/");
		}
	});

	it("returns the resolved address, not the text it was given", () => {
		expect(safe("/x/../challenges")).toBe("/challenges");
		expect(safe("/./challenges/./abc")).toBe("/challenges/abc");
		expect(safe("/a/b/../../users?query=x")).toBe("/users?query=x");
	});

	it("answers `/` for a dot, a slash or a backslash written as %xx", () => {
		for (const target of [
			"/%2e%2e/api",
			"/%2E%2E/api",
			"/x/%2e%2e/api/files",
			"/.%2e/api",
			"/%2e/auth/google/start",
			"/x%2f..%2fapi",
			"/x%2Fapi",
			"/x%5c..%5capi",
			"/x%5Capi",
			"/challenges?next=%2Fapi",
		]) {
			expect(safe(target), target).toBe("/");
		}
	});

	it("returns plain ASCII for a path with other letters in it", () => {
		expect(safe("/zażółć")).toBe("/za%C5%BC%C3%B3%C5%82%C4%87");
		expect(safe("/users?query=żaneta#ś")).toBe(
			"/users?query=%C5%BCaneta#%C5%9B",
		);
		for (const target of [
			"/zażółć",
			"/\u202e/x",
			"/\u2028",
			"/ｘ/．．/api",
			"/a b",
		]) {
			expect(safe(target), target).toMatch(/^\/[\x21-\x7e]*$/);
		}
	});

	it("judges by the origin it is given", () => {
		expect(safeRedirect("/challenges", "http://localhost:5173")).toBe(
			"/challenges",
		);
		expect(safeRedirect("//localhost:5173/x", "http://localhost:5173")).toBe(
			"/",
		);
	});

	// A browser's resolver drops a `.` or `x/..` step and keeps the empty
	// segment after it, so `/.//evil.example.test` resolves to the path
	// `//evil.example.test` on the panel's own origin. The origin is right,
	// and the bare path, in a `Location` header, is another host. This got
	// past the first version of the check (rule 19).
	it("never returns an address that starts with `//`", () => {
		for (const target of [
			"/..//evil.example.test",
			"/x/y/../..//evil.example.test",
			"/.//evil.example.test?next=/users#top",
			"/.//login",
			"/.//evil.example.test",
			"/.//evil.example.test/login",
			"/x/..//evil.example.test",
			"/././/evil.example.test",
			"/.///evil.example.test",
			"/.//",
		]) {
			const returned = safe(target);
			expect(returned, target).toBe("/");
			// What a browser makes of it as a `Location`.
			expect(new URL(returned, ORIGIN).origin, target).toBe(ORIGIN);
		}
	});

	it("keeps an empty segment that is not at the start", () => {
		// `//` further in is a path of the panel like any other.
		expect(safe("/a//b")).toBe("/a//b");
		expect(safe("/a/.//b")).toBe("/a//b");
	});
});
