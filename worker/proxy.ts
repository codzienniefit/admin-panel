import { clearSession, SESSION_COOKIE } from "./auth";
import { callBackend, errorCodeOf, PANEL_PREFIX } from "./backend";
import { tokenClaims } from "./codec";
import {
	apiOrigin,
	canReachBackend,
	type Deps,
	mediaOrigins,
	type PanelEnv,
} from "./env";
import {
	failure,
	fromOwnPage,
	loadedByOwnPage,
	readCookies,
	SECURITY_HEADERS,
} from "./http";

// Forwards /api/* to the backend.
//
// The browser talks to the panel's own address and never to the backend. What
// is forwarded is decided here, not by the request: one fixed host, the
// calls in the table below and no others, a fixed list of headers, a query
// rebuilt from its parts. The backend then checks the session and the
// Worker's signature itself (backend.ts); nothing here lets anyone in.

// ─── The table of allowed calls ─────────────────────────────────────────────

/**
 * What a call writes to, in the panel's own words: the same names as
 * `WriteArea` in src/data/api/capabilities.ts. A section is opened in both
 * places, here and there.
 */
export type WriteArea =
	| "workouts"
	| "challenges"
	| "badges"
	| "messages"
	| "media"
	| "sendMessage"
	| "promotedChallenge"
	| "users"
	| "userBadges"
	| "planning"
	/** Special offers: campaign codes, and switching them on and off. */
	| "offers"
	/** Clearing the app's CDN cache. Changes no data. */
	| "cache";

/**
 * The areas of Produkcja that can be written to. Only `cache`: clearing the
 * app's CDN cache changes no data (the backend does the same after every
 * admin save), so it is open while everything else stays read-only on the
 * server, whatever the page or anything running in it sends. Opening a
 * section is adding its name here, in a commit of its own.
 */
export const OPEN_FOR_WRITING: ReadonlySet<WriteArea> = new Set<WriteArea>([
	"cache",
]);

type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface Route {
	method: Method;
	/** The path after `/api/`, with `:id` for one segment that is an identifier. */
	path: string;
	/** `panel`: an admin call, sent to `/api/panel/…`, signed, with the session. */
	to: "panel" | "public";
	/** Present on a call that changes something. */
	writes?: WriteArea;
}

const read = (path: string): Route => ({ method: "GET", path, to: "panel" });
const write = (
	method: Exclude<Method, "GET">,
	path: string,
	writes: WriteArea,
): Route => ({ method, path, to: "panel", writes });

/**
 * Every call the panel may make. A call that is not here is answered 404
 * without reaching the backend. worker/proxy.test.ts lists this table, so a
 * new row is a visible change in review.
 */
export const ROUTES: readonly Route[] = [
	read("manageChallenges"),
	read("manageChallenges/:id"),
	read("manageWorkouts"),
	read("manageWorkouts/:id"),
	read("manageBadges"),
	read("manageBadges/:id"),
	read("manageMessageDrafts/list"),
	read("manageUsers"),
	read("accounts/:id"),
	read("manageUserBadges/:id"),
	read("manageUserBadges/:id/grants"),
	read("manageUserProgress/:id"),
	read("manageMedia/files"),
	read("manageOffers"),
	read("manageOffers/:id"),
	// What RevenueCat knows: the offerings and entitlements an offer can name.
	read("manageOfferChoices"),
	// The panel's own documents (planning notes, planner settings) and the
	// record of changes made through the panel.
	read("manage/panelDocs/:id"),
	read("manage/panelDocs/:id/:id"),
	read("manageAudit"),
	// The two configuration documents are public on the backend.
	{ method: "GET", path: "internalConfig", to: "public" },
	{ method: "GET", path: "workoutsConfig", to: "public" },

	write("POST", "manageChallenges", "challenges"),
	write("POST", "manageChallenges/promotedChallenge", "promotedChallenge"),
	// Publish, hide, delete, restore: without sending the whole item again.
	write("POST", "manageChallenges/:id/status", "challenges"),
	write("POST", "manageWorkouts", "workouts"),
	write("POST", "manageWorkouts/:id/status", "workouts"),
	write("POST", "manageBadges", "badges"),
	write("DELETE", "manageBadges/:id", "badges"),
	write("POST", "manageBadges/grantManual", "userBadges"),
	write("POST", "manageBadges/revokeManual", "userBadges"),
	write("POST", "manageMessageDrafts/upsert", "messages"),
	write("POST", "manageMessageDrafts/archive", "messages"),
	write("POST", "manageMessageDrafts/unarchive", "messages"),
	write("POST", "manageMessageDrafts/publish", "sendMessage"),
	write("PUT", "accounts/:id", "users"),
	write("POST", "manageMedia/files", "media"),
	write("PUT", "manage/panelDocs/:id/:id", "planning"),
	write("DELETE", "manage/panelDocs/:id/:id", "planning"),
	write("POST", "manageOffers", "offers"),
	// Switching an offer on or off without sending it again.
	write("POST", "manageOffers/:id/status", "offers"),
	// "Wyczyść cache aplikacji": asks Cloudflare to drop its copy of the
	// catalogue. No body; the backend refuses one within 30 s of the last.
	write("POST", "manageCache/purge", "cache"),
];

/** One identifier in a path: a challenge, workout, badge or user id. */
const IDENTIFIER = "[A-Za-z0-9_-][A-Za-z0-9._~-]{0,127}";

const compiled = ROUTES.map((route) => ({
	route,
	pattern: new RegExp(
		`^/api/${route.path
			.split("/")
			.map((part) => (part === ":id" ? IDENTIFIER : part))
			.join("/")}$`,
	),
}));

/** The row for this call, or null when the panel has no such call. */
export function routeFor(method: string, pathname: string): Route | null {
	if (pathname.includes("..")) return null;
	return (
		compiled.find(
			({ route, pattern }) => route.method === method && pattern.test(pathname),
		)?.route ?? null
	);
}

// ─── Headers and sizes ──────────────────────────────────────────────────────

/** Request headers passed on. Cookies and everything else stay here. */
const REQUEST_HEADERS = ["accept", "content-type", "if-match", "if-none-match"];
/** Response headers passed back. The length is the runtime's to state. */
const RESPONSE_HEADERS = ["content-type", "etag"];
/** For files only: a player asks for a part of a recording at a time. */
const FILE_REQUEST_HEADERS = [
	"range",
	"if-range",
	// So a file the browser already has is not sent again.
	"if-none-match",
	"if-modified-since",
];
const FILE_RESPONSE_HEADERS = [
	"content-type",
	"etag",
	"content-range",
	"accept-ranges",
	"last-modified",
];

/** The largest body forwarded. A picture or a short recording fits; more is not a panel call. */
export const MAX_BODY_BYTES = 32 * 1024 * 1024;

/**
 * Files a browser only shows or plays. Anything else (a script, HTML, SVG,
 * XML, no type at all) is refused: served from the panel's own address it
 * would be trusted as the panel's own code.
 */
const INERT_FILE =
	/^\s*((image|audio|video)\/(?!svg)[a-z0-9.+-]+|application\/pdf)\s*(;|$)/i;

/**
 * A file is named by its path inside the public container. Anything that
 * could point elsewhere is refused: a full address, a leading slash, a
 * backslash, a `..` step, a control character, or a `%` that would mean
 * something to a server that decodes once more.
 */
export function isFilePath(path: string | null): path is string {
	if (!path || path.length > 1024) return false;
	if (path.startsWith("/") || path.includes("\\") || path.includes("://")) {
		return false;
	}
	if (path.includes("%")) return false;
	if ([...path].some((character) => character.charCodeAt(0) < 32)) return false;
	return !path.split("/").some((part) => part === ".." || part === ".");
}

const TEXT = {
	notFound: "Not found",
	foreign: "Odrzucono żądanie z innej strony.",
	signedOut: "Sesja wygasła. Zaloguj się ponownie.",
	readOnly:
		"Produkcja jest tylko do odczytu: ta część panelu nie jest jeszcze otwarta do zapisu.",
	notConfigured: "Panel nie jest jeszcze połączony z backendem.",
	unreachable: "Backend nie odpowiada.",
	misconfigured: "Backend odrzucił panel. Daj znać administratorowi.",
	tooLarge: "Plik jest za duży, żeby go wysłać.",
	fileType: "Tego rodzaju pliku panel nie pokazuje.",
};

/** The path as it is logged: identifiers replaced, never a query. */
const logged = (route: Route) => `/api/${route.path}`;

/** Who a session says it is, for the log only, and only after the backend accepted it. */
const uidClaimed = (session: string): string | null => {
	const claims = tokenClaims(session);
	const uid = claims?.sub ?? claims?.user_id;
	return typeof uid === "string" ? uid : null;
};

// ─── Files ──────────────────────────────────────────────────────────────────

async function serveFile(
	request: Request,
	env: PanelEnv,
	deps: Deps,
): Promise<Response> {
	const url = new URL(request.url);
	const refuse = (status: number, text: string, code: string) => {
		deps.log({
			event: "refused",
			method: "GET",
			route: "/api/files",
			status,
			reason: code,
			ray: request.headers.get("cf-ray"),
		});
		return failure(status, text, code);
	};
	// A picture is loaded by <img>, which cannot set the panel's header. The
	// browser still says where the request came from.
	if (!loadedByOwnPage(request)) {
		return refuse(403, TEXT.foreign, "FOREIGN_REQUEST");
	}
	const params = [...url.searchParams.entries()];
	const path =
		params.length === 1 && params[0]?.[0] === "path" ? params[0][1] : null;
	if (!isFilePath(path)) return refuse(404, TEXT.notFound, "NOT_FOUND");
	// Not a check of who it is (the files are public on the backend): only
	// that the panel's address is not a file server for the signed-out.
	if (!readCookies(request).get(SESSION_COOKIE)) {
		return refuse(401, TEXT.signedOut, "SIGNED_OUT");
	}
	const origin = apiOrigin(env);
	if (!origin) return refuse(503, TEXT.notConfigured, "NOT_CONFIGURED");

	const headers = new Headers();
	for (const name of FILE_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}

	// The stored name, each segment encoded the way the backend writes it
	// (its MediaService.encodeBlobPath).
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	let upstream: Response | null = null;
	try {
		// Where files are stored is known from an earlier redirect: straight
		// there, one call instead of two, and none counted against the API's
		// rate limit. A file the storage does not have there is asked of the
		// backend after all, in case the storage moved.
		const known = deps.fileBase?.get() ?? null;
		if (known && mediaOrigins(env).has(new URL(known).origin)) {
			const direct = await deps.fetch(`${known}/${encoded}`, {
				method: "GET",
				headers,
				redirect: "manual",
			});
			if (direct.ok || direct.status === 304) upstream = direct;
			else deps.fileBase?.forget();
		}
	} catch {
		deps.fileBase?.forget();
	}
	try {
		if (upstream === null) {
			upstream = await deps.fetch(
				`${origin}/api/files?path=${encodeURIComponent(path)}`,
				{ method: "GET", headers, redirect: "manual" },
			);
		}
		// The backend answers with a redirect to where the file is stored.
		// It is followed once, and only to a storage address that is set.
		if (upstream.status >= 300 && upstream.status < 400) {
			const location = upstream.headers.get("location");
			let target: URL | null = null;
			try {
				target = location ? new URL(location) : null;
			} catch {
				target = null;
			}
			if (!target || !mediaOrigins(env).has(target.origin)) {
				return refuse(502, TEXT.unreachable, "FILE_REDIRECT_REFUSED");
			}
			// remembered for the next files: everything before the name
			const href = target.toString();
			if (href.endsWith(`/${encoded}`)) {
				deps.fileBase?.set(href.slice(0, -(encoded.length + 1)));
			}
			upstream = await deps.fetch(target.toString(), {
				method: "GET",
				headers,
				redirect: "manual",
			});
		}
	} catch {
		return refuse(502, TEXT.unreachable, "BACKEND_UNREACHABLE");
	}

	// "Not changed since you last asked" is an answer, not a redirect.
	if (upstream.status === 304) {
		return new Response(null, {
			status: 304,
			headers: { ...SECURITY_HEADERS, "cache-control": "private, max-age=300" },
		});
	}
	if (upstream.status >= 300 && upstream.status < 400) {
		return refuse(502, TEXT.unreachable, "FILE_REDIRECT_REFUSED");
	}
	if (!upstream.ok) {
		return refuse(
			upstream.status === 404 ? 404 : 502,
			TEXT.notFound,
			upstream.status === 404 ? "NOT_FOUND" : "BACKEND_UNREACHABLE",
		);
	}
	if (!INERT_FILE.test(upstream.headers.get("content-type") ?? "")) {
		return refuse(415, TEXT.fileType, "FILE_TYPE_REFUSED");
	}

	const answer = new Headers({
		...SECURITY_HEADERS,
		// By this browser only, for a few minutes.
		"cache-control": "private, max-age=300",
		"content-disposition": "inline",
		// Opened on its own, a file is shut in a sandbox.
		"content-security-policy":
			"default-src 'none'; style-src 'unsafe-inline'; sandbox",
	});
	for (const name of FILE_RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value !== null) answer.set(name, value);
	}
	return new Response(upstream.body, {
		status: upstream.status,
		headers: answer,
	});
}

// ─── Everything else ────────────────────────────────────────────────────────

/** The body of a call that changes something, or a refusal when it is too large. */
async function bodyOf(
	request: Request,
): Promise<ArrayBuffer | null | "tooLarge"> {
	if (request.body === null) return null;
	const declared = Number(request.headers.get("content-length") ?? "0");
	if (declared > MAX_BODY_BYTES) return "tooLarge";
	// Read whole before sending, so the signature's timestamp is fresh when
	// the backend sees it, however slowly the browser uploads.
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel();
			return "tooLarge";
		}
		chunks.push(value);
	}
	const whole = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		whole.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return whole.buffer;
}

function answerFrom(upstream: Response, cookies: readonly string[]): Response {
	const headers = new Headers({
		...SECURITY_HEADERS,
		// Admin data is never kept by a browser or a proxy.
		"cache-control": "no-store",
		"content-security-policy": "default-src 'none'; frame-ancestors 'none'",
	});
	for (const name of RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	for (const cookie of cookies) headers.append("set-cookie", cookie);
	return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * @param origin the panel's own address, or null while Produkcja is not
 *   configured; then nothing is forwarded
 */
export async function handleApi(
	request: Request,
	env: PanelEnv,
	deps: Deps,
	origin: string | null,
): Promise<Response> {
	const url = new URL(request.url);
	if (origin === null)
		return failure(503, TEXT.notConfigured, "NOT_CONFIGURED");

	if (request.method === "GET" && url.pathname === "/api/files") {
		return serveFile(request, env, deps);
	}

	const route = routeFor(request.method, url.pathname);
	if (!route) {
		deps.log({
			event: "refused",
			method: request.method,
			reason: "notInTable",
			ray: request.headers.get("cf-ray"),
		});
		return failure(404, TEXT.notFound, "NOT_FOUND");
	}
	const refuse = (
		status: number,
		text: string,
		code: string,
		cookies: string[] = [],
	) => {
		deps.log({
			event: "refused",
			method: route.method,
			route: logged(route),
			status,
			reason: code,
			ray: request.headers.get("cf-ray"),
		});
		return failure(status, text, code, cookies);
	};

	// Every call has to come from our own code.
	if (!fromOwnPage(request, origin))
		return refuse(403, TEXT.foreign, "FOREIGN_REQUEST");
	if (route.writes && !OPEN_FOR_WRITING.has(route.writes)) {
		return refuse(403, TEXT.readOnly, "READ_ONLY");
	}

	if (route.to === "public") {
		const backend = apiOrigin(env);
		if (!backend) return refuse(503, TEXT.notConfigured, "NOT_CONFIGURED");
		let answer: Response;
		try {
			answer = await deps.fetch(`${backend}${url.pathname}`, {
				method: "GET",
				headers: { accept: "application/json" },
				redirect: "manual",
			});
		} catch {
			return refuse(502, TEXT.unreachable, "BACKEND_UNREACHABLE");
		}
		if (answer.status >= 300 && answer.status < 400) {
			return refuse(502, TEXT.unreachable, "BACKEND_UNREACHABLE");
		}
		return answerFrom(answer, []);
	}

	const session = readCookies(request).get(SESSION_COOKIE);
	if (!session) return refuse(401, TEXT.signedOut, "SIGNED_OUT");
	if (!canReachBackend(env))
		return refuse(503, TEXT.notConfigured, "NOT_CONFIGURED");

	const headers = new Headers();
	for (const name of REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	const body = route.method === "GET" ? null : await bodyOf(request);
	if (body === "tooLarge") return refuse(413, TEXT.tooLarge, "TOO_LARGE");

	const upstream = await callBackend(env, deps, {
		method: route.method,
		path: `${PANEL_PREFIX}${url.pathname.slice("/api".length)}`,
		query: url.searchParams,
		credential: session,
		headers,
		body,
	});
	if (upstream === "notConfigured")
		return refuse(503, TEXT.notConfigured, "NOT_CONFIGURED");
	if (upstream === "unreachable")
		return refuse(502, TEXT.unreachable, "BACKEND_UNREACHABLE");
	// The panel's routes never redirect. "Not changed" (304) is an answer.
	if (
		upstream.status >= 300 &&
		upstream.status < 400 &&
		upstream.status !== 304
	) {
		return refuse(502, TEXT.unreachable, "BACKEND_UNREACHABLE");
	}

	if (
		upstream.status === 401 ||
		upstream.status === 403 ||
		upstream.status === 503
	) {
		const code = await errorCodeOf(upstream);
		if (code === "BAD_SIGNATURE" || code === "PANEL_NOT_CONFIGURED") {
			deps.log({
				event: "backendRefusedWorker",
				route: logged(route),
				reason: code,
			});
			return failure(502, TEXT.misconfigured, "BACKEND_REFUSED_PANEL");
		}
		if (
			code === "SESSION_INVALID" ||
			code === "NOT_PANEL_ADMIN" ||
			code === "WRONG_SIGN_IN_METHOD"
		) {
			// Over, or the person was taken off the list: the cookie goes too.
			return refuse(401, TEXT.signedOut, "SIGNED_OUT", clearSession());
		}
	}

	if (route.method !== "GET") {
		deps.log({
			event: "forwarded",
			method: route.method,
			route: logged(route),
			status: upstream.status,
			uid: upstream.ok ? uidClaimed(session) : null,
			ray: request.headers.get("cf-ray"),
		});
	}
	return answerFrom(upstream, []);
}
