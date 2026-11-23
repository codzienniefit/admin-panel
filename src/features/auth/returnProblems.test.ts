import { describe, expect, it } from "vitest";
import {
	REFUSED_UID_HINT,
	RETURN_PROBLEMS,
	returnProblem,
	SIGN_IN_FAILED,
} from "./returnProblems";

// The Worker's own sign-in page (worker/loginPage.ts) says the same as this page, before any of
// the panel's code is downloaded. It is read through Vite rather than imported: the app and the
// Worker are separate TypeScript projects.
const worker = import.meta.glob<Record<string, unknown>>(
	"../../../worker/loginPage.ts",
	{ eager: true },
);
const workerPage = worker["../../../worker/loginPage.ts"];

describe("what a refused sign-in says", () => {
	it("is worded the same on the Worker's sign-in page", () => {
		expect(workerPage).toBeDefined();
		expect(workerPage?.RETURN_PROBLEMS).toEqual(RETURN_PROBLEMS);
		expect(workerPage?.SIGN_IN_FAILED).toBe(SIGN_IN_FAILED);
		expect(workerPage?.REFUSED_UID_HINT).toBe(REFUSED_UID_HINT);
	});

	it("has its own words for each code the Worker sends back with, and the general text otherwise", () => {
		expect(returnProblem(undefined)).toBeNull();
		expect(returnProblem("")).toBeNull();
		expect(returnProblem("forbidden")).toBe("To konto nie ma dostępu.");
		expect(returnProblem("failed")).toBe("Nie udało się zalogować.");
		expect(returnProblem("constructor")).toBe("Nie udało się zalogować.");
	});
});
