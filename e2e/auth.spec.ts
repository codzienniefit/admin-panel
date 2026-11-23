import { SIGNED_OUT } from "./support/environment";
import { choose, expect, open, pick, test } from "./support/test";

test.describe("environment", () => {
	test("the panel works on sample data by default", async ({ page }) => {
		await open(page, "/challenges");
		await expect(page.getByRole("combobox", { name: "Środowisko" })).toHaveText(
			"Test",
		);
	});

	test("Produkcja asks for a real sign-in and leads back to Test", async ({
		page,
	}) => {
		await open(page, "/challenges");
		await choose(page, "Środowisko", /Produkcja/);

		// The demo session does not count there, and no keys are set here.
		await expect(page).toHaveURL(/\/login/);
		await expect(
			page.getByRole("heading", { name: "Logowanie niedostępne" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: /Wejdź jako/ })).toHaveCount(
			0,
		);

		// Nothing behind sign-in opens by typing its address.
		await page.goto("/workouts");
		await expect(page).toHaveURL(/\/login/);

		// Back in Test the demo session is still there, and so is the panel.
		await choose(page, "Środowisko", /Test/);
		await expect(page).toHaveURL(/\/challenges/);
		await expect(
			page.getByRole("navigation", { name: "Główne" }),
		).toBeVisible();
		await expect(page.getByRole("combobox", { name: "Środowisko" })).toHaveText(
			"Test",
		);
	});
});

test.describe("signing in", () => {
	test.use({ storageState: SIGNED_OUT });

	test("a visitor signs in and lands on the page they asked for", async ({
		page,
	}) => {
		await page.goto("/workouts?q=joga");
		await expect(page).toHaveURL(/\/login/);
		await expect(
			page.getByRole("heading", { name: "Codziennie Fit" }),
		).toBeVisible();

		await page
			.getByRole("button", { name: "Wejdź jako administratorka" })
			.click();

		await expect(page).toHaveURL(/\/workouts\?q=joga/);
		await expect(page.getByRole("heading", { name: "Treningi" })).toBeVisible();
	});

	test("an account without admin rights is refused", async ({ page }) => {
		await page.goto("/challenges");
		await page
			.getByRole("button", { name: "Wejdź jako osoba bez dostępu" })
			.click();

		await expect(page).toHaveURL(/\/forbidden/);
		await expect(
			page.getByRole("heading", { name: "Brak dostępu" }),
		).toBeVisible();
		await expect(page.getByRole("navigation", { name: "Główne" })).toHaveCount(
			0,
		);
	});
});

test("signing out closes the panel", async ({ page }) => {
	await open(page, "/challenges");
	await pick(page, "Konto: Ada Adminowska", "Wyloguj");
	await expect(page).toHaveURL(/\/login/);

	await page.goto("/workouts");
	await expect(page).toHaveURL(/\/login/);
});
