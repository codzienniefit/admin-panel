// Refuses a commit-to-be that carries a secret or an environment file.
//
// Looks at every file git would take (tracked, plus new files that are not
// ignored) and fails on: file names that hold secrets by convention, and
// text that looks like a key, token or connection string. Part of
// `npm run check`, so it runs before every push. It reads files only.

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const FORBIDDEN_NAMES = [
	/(^|\/)\.env(\.|$)/,
	/(^|\/)\.dev\.vars/,
	/(^|\/)local\.settings\.json$/,
	/(^|\/)\.npmrc$/,
	/(^|\/)id_(rsa|ed25519|ecdsa)/,
	/\.(pem|key|p12|pfx|jks|keystore)$/i,
	/service[-_]?account.*\.json$/i,
	/credentials.*\.json$/i,
];
// Example files hold placeholders and are meant to be committed.
const ALLOWED_NAMES = [/\.example$/];

const PATTERNS = [
	["AWS access key", /AKIA[0-9A-Z]{16}/],
	["Google API key", /AIza[0-9A-Za-z_-]{35}/],
	["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
	[
		"API secret key",
		/\bsk-[A-Za-z0-9_-]{20,}|\bsk_(live|test)_[A-Za-z0-9]{16,}/,
	],
	["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
	["JSON web token", /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./],
	["private key", /-----BEGIN [A-Z ]*PRIVATE KEY/],
	[
		"Azure storage secret",
		/AccountKey=[A-Za-z0-9+/=]{20,}|SharedAccessSignature=|[?&]sig=[A-Za-z0-9%]{20,}/,
	],
	["Azure Functions key in a URL", /[?&]code=[A-Za-z0-9_=-]{20,}/],
	["RevenueCat key", /\b(goog|appl|rcb|strp)_[A-Za-z0-9]{20,}/],
	[
		"hard-coded credential",
		/(api[_-]?key|apikey|secret|password|passwd|client[_-]?secret|auth[_-]?token|access[_-]?token)["' ]*[:=] *["'][^"' ${}<>]{12,}["']/i,
	],
];

// Generated or third-party text where long random strings are expected.
const SKIP_CONTENT = [
	/^package-lock\.json$/,
	/^worker-configuration\.d\.ts$/,
	/^src\/routeTree\.gen\.ts$/,
	/^scripts\/check-secrets\.mjs$/,
];
const MAX_BYTES = 2_000_000;

const files = execFileSync(
	"git",
	["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
	{ encoding: "utf8" },
)
	.split("\0")
	.filter(Boolean);

const problems = [];
let scanned = 0;

for (const file of files) {
	let size;
	try {
		size = statSync(file).size;
	} catch {
		continue; // Deleted in the working tree.
	}

	if (
		FORBIDDEN_NAMES.some((rule) => rule.test(file)) &&
		!ALLOWED_NAMES.some((rule) => rule.test(file))
	) {
		problems.push(`${file}: this kind of file must not be committed`);
		continue;
	}
	if (size > MAX_BYTES || SKIP_CONTENT.some((rule) => rule.test(file)))
		continue;

	const text = readFileSync(file, "utf8");
	if (text.includes("\u0000")) continue; // Binary.
	scanned += 1;

	text.split("\n").forEach((line, index) => {
		for (const [label, pattern] of PATTERNS) {
			if (pattern.test(line)) {
				// The value itself is not printed.
				problems.push(`${file}:${index + 1}: looks like a ${label}`);
			}
		}
	});
}

if (problems.length > 0) {
	console.error("Possible secrets found. Nothing here may be committed:\n");
	for (const problem of problems) console.error(`  ${problem}`);
	console.error(
		"\nRemove the value (and rotate it if it was ever pushed). If it is a false alarm, adjust scripts/check-secrets.mjs.",
	);
	process.exit(1);
}

console.log(`No secrets found in ${scanned} files.`);
