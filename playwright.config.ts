import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SERVER_COMMAND, SIGNED_IN } from "./e2e/support/environment";

// UI tests: a real browser clicking through the panel as a person would.
// Run with `npm run test:ui`. How to write one: e2e/README.md.
//
// They run against the production build, served locally, in the panel's
// TEST environment (sample data that lives in the browser). That is decided
// once, here and in e2e/support, for every test:
//
//   - every browser starts with the Test environment selected and the demo
//     administrator signed in (`storageState` below);
//   - e2e/support/test.ts refuses any request that would leave this machine.
//
// Each test gets a fresh browser profile: it starts from the same sample
// data, and nothing one test does is seen by another.
export default defineConfig({
	testDir: "./e2e",
	tsconfig: "./e2e/tsconfig.json",
	outputDir: "./e2e/.results",
	fullyParallel: true,
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: [
		["list"],
		["html", { open: "never", outputFolder: "e2e/.report" }],
	],
	timeout: 30_000,
	expect: { timeout: 7_000 },
	use: {
		baseURL: BASE_URL,
		storageState: SIGNED_IN,
		locale: "pl-PL",
		timezoneId: "Europe/Warsaw",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: {
		command: SERVER_COMMAND,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 180_000,
	},
});
