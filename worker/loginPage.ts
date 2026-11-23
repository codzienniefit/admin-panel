import { SECURITY_HEADERS, safeRedirect } from "./http";

// The sign-in page the Worker itself answers to someone without a pass (gate.ts): the only page
// anyone sees before signing in, so none of the panel's code is downloaded first. Plain HTML and
// inline CSS, no script at all. It looks like the panel's own sign-in page
// (src/features/auth/LoginPage.tsx) and says the same things; like it, nothing on it says what is
// behind it.

/**
 * The same words as src/features/auth/returnProblems.ts, which the panel's page uses;
 * src/features/auth/returnProblems.test.ts keeps the two equal.
 */
export const RETURN_PROBLEMS: Readonly<Record<string, string>> = {
	forbidden: "To konto nie ma dostępu.",
	cancelled: "Logowanie zostało przerwane.",
	disabled: "To konto jest zablokowane.",
	tooManyAttempts: "Za dużo prób. Spróbuj ponownie za kilka minut.",
	unavailable: "Logowanie jest chwilowo niedostępne. Spróbuj za chwilę.",
	misconfigured:
		"Logowanie nie jest poprawnie skonfigurowane. Daj znać administratorowi.",
};
export const SIGN_IN_FAILED = "Nie udało się zalogować";
export const REFUSED_UID_HINT =
	"Żeby dostać dostęp, przekaż ten identyfikator osobie, która go nadaje:";

/** Inline styles and the panel's own icons; nothing else may load, run, frame it or be posted. */
export const LOGIN_PAGE_POLICY =
	"default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

const NO_INDEX =
	"noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai";

/** The code `backToLogin` (auth.ts) sends back with; the panel's /login route accepts the same. */
const PROBLEM_CODE = /^[A-Za-z]{1,32}$/;

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

/** Text made safe for HTML, in an element or in a quoted attribute. */
export const escapeHtml = (text: string): string =>
	text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);

/** What the page shows. */
export interface LoginPageContent {
	/** A path inside the panel, already checked by `safeRedirect`. */
	redirect: string;
	/** The code of a sign-in that came back refused, or null. */
	problem: string | null;
	/** The refused person's own user id, shown only with `forbidden`. */
	refusedUid: string | null;
	/**
	 * A deployed Worker whose sign-in is not fully set up: the names of the values still missing.
	 * The page then says so and offers no way in.
	 */
	missing?: readonly string[];
}

const NOT_CONFIGURED_TITLE = "Logowanie niedostępne";
const NOT_CONFIGURED_TEXT =
	"Logowanie do Produkcji nie jest jeszcze skonfigurowane. Brakuje ustawień Workera (Cloudflare → Workers & Pages → admin-panel → Settings → Variables and Secrets):";

/**
 * Where to go after signing in, and the problem to show, from the address asked for: for
 * `/login?redirect=X` it is X, for any other page the page itself. Only `/login` carries a problem.
 *
 * @param origin the panel's own address
 */
export function loginPageRequest(
	url: URL,
	origin: string,
): { redirect: string; problem: string | null } {
	if (url.pathname !== "/login") {
		return {
			redirect: safeRedirect(`${url.pathname}${url.search}`, origin),
			problem: null,
		};
	}
	const problem = url.searchParams.get("error");
	return {
		redirect: safeRedirect(url.searchParams.get("redirect"), origin),
		problem: problem !== null && PROBLEM_CODE.test(problem) ? problem : null,
	};
}

/** The text of a problem: its own words, or the general one for a code the page does not know. */
function problemText(code: string): string {
	return Object.hasOwn(RETURN_PROBLEMS, code)
		? (RETURN_PROBLEMS[code] ?? `${SIGN_IN_FAILED}.`)
		: `${SIGN_IN_FAILED}.`;
}

// The Codziennie Fit logotype, as in src/assets/codziennie-fit.svg.
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Codziennie Fit" viewBox="0 0 1044.78 106.90"><path fill="#FFB6DC" d="M133.69 69.31C133.69 47.83 149.44 32.08 171.78 32.08C191.40 32.08 205.72 44.25 208.72 61.72L186.96 61.72C184.52 55.85 178.94 52.13 171.78 52.13C162.04 52.13 155.45 59.14 155.45 69.31C155.45 79.48 162.04 86.49 171.78 86.49C178.94 86.49 184.52 82.77 186.96 76.90L208.72 76.90C205.72 94.37 191.40 106.54 171.78 106.54C149.44 106.54 133.69 90.79 133.69 69.31"/><path fill="#FFB6DC" d="M269.09 69.31C269.09 59.14 262.50 52.13 252.76 52.13C243.02 52.13 236.44 59.14 236.44 69.31C236.44 79.48 243.02 86.49 252.76 86.49C262.50 86.49 269.09 79.48 269.09 69.31M214.67 69.31C214.67 47.83 230.42 32.08 252.76 32.08C275.10 32.08 290.85 47.83 290.85 69.31C290.85 90.79 275.10 106.54 252.76 106.54C230.42 106.54 214.67 90.79 214.67 69.31"/><path fill="#FFB6DC" d="M351.88 69.31C351.88 59.14 345.29 52.13 335.55 52.13C325.81 52.13 319.23 59.14 319.23 69.31C319.23 79.48 325.81 86.49 335.55 86.49C345.29 86.49 351.88 79.48 351.88 69.31M297.46 68.45C297.46 43.82 315.79 32.08 331.83 32.08C340.28 32.08 347.44 35.37 351.88 41.67L351.88 3.01L373.36 3.01L373.36 68.59C373.36 92.37 357.32 106.54 335.69 106.54C313.21 106.54 297.46 91.22 297.46 68.45"/><path fill="#FFB6DC" d="M382.45 86.78L417.97 52.56L384.60 52.56L384.60 33.94L446.17 33.94L446.17 51.84L410.66 86.06L447.61 86.06L447.61 104.68L382.45 104.68L382.45 86.78"/><path fill="#FFB6DC" d="M459.72 33.94H481.20V104.68H459.72ZM456.71 13.75C456.71 5.87 462.58 0.00 470.46 0.00C478.33 0.00 484.20 5.87 484.20 13.75C484.20 21.62 478.33 27.49 470.46 27.49C462.58 27.49 456.71 21.62 456.71 13.75"/><path fill="#FFB6DC" d="M545.33 61.72C542.89 54.42 537.17 51.27 529.72 51.27C522.27 51.27 516.55 54.56 514.40 61.72L545.33 61.72M491.63 69.31C491.63 47.83 507.38 32.08 529.72 32.08C552.06 32.08 567.38 47.83 567.38 69.31L567.38 75.32L513.97 75.32C515.69 83.63 521.99 87.35 529.72 87.35C535.88 87.35 540.46 86.06 543.18 82.20L565.38 82.20C560.79 96.80 547.33 106.54 529.72 106.54C507.38 106.54 491.63 90.79 491.63 69.31"/><path fill="#FFB6DC" d="M576.59 68.02C576.59 44.25 590.63 32.08 611.53 32.08C632.44 32.08 646.47 44.11 646.47 68.02L646.47 104.68L624.99 104.68L624.99 68.02C624.99 56.85 619.55 52.12 611.53 52.12C603.51 52.12 598.07 56.85 598.07 68.02L598.07 104.68L576.59 104.68L576.59 68.02"/><path fill="#FFB6DC" d="M659.18 68.02C659.18 44.25 673.22 32.08 694.12 32.08C715.03 32.08 729.06 44.11 729.06 68.02L729.06 104.68L707.58 104.68L707.58 68.02C707.58 56.85 702.14 52.12 694.12 52.12C686.10 52.12 680.66 56.85 680.66 68.02L680.66 104.68L659.18 104.68L659.18 68.02"/><path fill="#FFB6DC" d="M742.55 33.94H764.03V104.68H742.55ZM739.54 13.75C739.54 5.87 745.41 0.00 753.28 0.00C761.16 0.00 767.03 5.87 767.03 13.75C767.03 21.62 761.16 27.49 753.28 27.49C745.41 27.49 739.54 21.62 739.54 13.75"/><path fill="#FFB6DC" d="M828.16 61.72C825.72 54.42 820.00 51.27 812.55 51.27C805.10 51.27 799.38 54.56 797.23 61.72L828.16 61.72M774.46 69.31C774.46 47.83 790.21 32.08 812.55 32.08C834.89 32.08 850.21 47.83 850.21 69.31L850.21 75.32L796.80 75.32C798.52 83.63 804.82 87.35 812.55 87.35C818.71 87.35 823.29 86.06 826.01 82.20L848.21 82.20C843.62 96.80 830.16 106.54 812.55 106.54C790.21 106.54 774.46 90.79 774.46 69.31"/><path fill="#838BC5" d="M949.85 34.15H971.33V104.89H949.85ZM946.85 13.96C946.85 6.08 952.72 0.21 960.59 0.21C968.47 0.21 974.34 6.08 974.34 13.96C974.34 21.84 968.47 27.71 960.59 27.71C952.72 27.71 946.85 21.84 946.85 13.96M877.82 33.29C877.82 11.81 890.71 1.36 909.61 1.36C928.66 1.36 941.40 11.96 941.40 33.29L919.92 33.29C919.92 24.27 915.63 21.41 909.61 21.41C903.60 21.41 899.30 24.41 899.30 33.29L899.30 44.03L932.67 44.03L932.67 63.36L899.30 63.36L899.30 104.89L877.82 104.89L877.82 33.29"/><path fill="#838BC5" d="M985.50 76.97L985.50 9.09L1006.98 9.09L1006.98 34.15L1040.49 34.15L1040.49 53.48L1006.98 53.48L1006.98 76.97C1006.98 84.42 1010.41 86.71 1015.14 86.71C1019.87 86.71 1023.30 84.42 1023.30 76.97L1023.30 74.82L1044.78 74.82L1044.78 76.97C1044.78 97.16 1032.75 106.76 1015.14 106.76C997.52 106.76 985.50 97.16 985.50 76.97"/><path fill="#838BC5" d="M106.90 31.72L106.90 106.90L31.72 106.90C25.42 106.90 19.86 105.59 15.23 103.24C14.93 103.09 14.63 102.93 14.34 102.78C5.96 97.78 0.27 88.72 0.01 78.31C0.00 78.08 0.00 77.84 0.00 77.60C0.00 77.30 0.00 76.99 0.01 76.69C0.24 68.93 3.47 61.92 8.60 56.80C10.88 54.52 13.53 52.61 16.46 51.18C16.47 51.18 16.47 51.18 16.48 51.17C19.81 49.65 23.58 48.64 27.73 48.25C29.02 48.13 30.35 48.07 31.72 48.07L48.07 48.07L48.07 31.72C48.07 30.35 48.13 29.02 48.26 27.73C48.65 23.58 49.65 19.81 51.18 16.48C51.18 16.47 51.18 16.47 51.18 16.46C52.62 13.53 54.52 10.88 56.81 8.59C61.93 3.47 68.93 0.24 76.69 0.01C77.00 0.00 77.30 0.00 77.61 0.00C77.84 0.00 78.08 0.00 78.32 0.01C88.72 0.27 97.78 5.96 102.78 14.34C103.25 15.20 103.69 16.10 104.09 17.03C105.90 21.28 106.90 26.21 106.90 31.72"/><path fill="#FFB6DC" d="M29.42 48.07C13.17 48.07 0.00 61.24 0.00 77.48C0.00 93.73 13.17 106.90 29.42 106.90L106.90 106.90C106.90 74.41 80.56 48.07 48.07 48.07L29.42 48.07"/></svg>`;

const STYLE = `
*,*::before,*::after{box-sizing:border-box}
html,body{height:100%;margin:0}
body{background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;font-size:15px;font-weight:500;line-height:1.5;-webkit-font-smoothing:antialiased;display:flex;align-items:center;justify-content:center;padding:16px}
main{width:100%;max-width:28rem;background:#fff;border:1px solid #e5e5e7;border-radius:20px;box-shadow:0 4px 12px rgb(0 0 0 / 0.1);padding:24px}
@media (min-width:768px){main{padding:32px}}
h1{margin:0;font-size:inherit;line-height:0}
h1 svg{height:24px;width:auto;display:block}
.notice{margin-top:20px;border:1px solid #ff3b30;background:#ffecea;border-radius:16px;padding:16px}
.notice h2{margin:0;font-size:inherit;font-weight:600;color:#c41c12}
.notice p{margin:4px 0 0;font-size:14px;color:#6e6e73}
.notice p+p{margin-top:8px}
.uid{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;word-break:break-all;user-select:all}
.button{margin-top:24px;display:flex;width:100%;align-items:center;justify-content:center;border-radius:10px;background:#0071e3;color:#fff;padding:8px 16px;font-size:14px;font-weight:500;text-decoration:none;transition:background-color .15s}
.button:hover{background:#0077ed}
:focus-visible{outline:2px solid #0071e3;outline-offset:2px}
`;

/** The page's HTML. Every value from outside is escaped. */
export function loginPageHtml(content: LoginPageContent): string {
	const start = `/auth/google/start?${new URLSearchParams({ redirect: content.redirect })}`;
	const uid = content.problem === "forbidden" ? content.refusedUid : null;
	const notice =
		content.problem === null
			? ""
			: `
<div class="notice" role="alert">
<h2>${escapeHtml(SIGN_IN_FAILED)}</h2>
<p>${escapeHtml(problemText(content.problem))}</p>${
					uid
						? `
<p>${escapeHtml(REFUSED_UID_HINT)} <span class="uid">${escapeHtml(uid)}</span></p>`
						: ""
				}
</div>`;
	return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${NO_INDEX}">
<meta name="googlebot" content="${NO_INDEX}">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#f5f5f7">
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" type="image/png" href="/favicon-32.png" sizes="32x32">
<link rel="icon" type="image/png" href="/favicon-192.png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>Logowanie</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${LOGO}</h1>${notice}${
		content.missing && content.missing.length > 0
			? `
<div class="notice" role="status">
<h2>${escapeHtml(NOT_CONFIGURED_TITLE)}</h2>
<p>${escapeHtml(NOT_CONFIGURED_TEXT)} ${escapeHtml(content.missing.join(", "))}.</p>
</div>`
			: `
<a class="button" href="${escapeHtml(start)}">Zaloguj się przez Google</a>`
	}
</main>
</body>
</html>
`;
}

/** The page as an answer: never stored, never framed, never indexed. */
export function loginPage(content: LoginPageContent, method = "GET"): Response {
	const headers = new Headers({
		...SECURITY_HEADERS,
		"content-type": "text/html; charset=utf-8",
		"cache-control": "no-store",
		"content-security-policy": LOGIN_PAGE_POLICY,
	});
	const body = method === "HEAD" ? null : loginPageHtml(content);
	return new Response(body, { status: 200, headers });
}
