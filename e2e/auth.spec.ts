import { SIGNED_OUT } from "./support/environment";
import { expect, open, pick, test } from "./support/test";

test.describe("environment", () => {
	test("the panel works on sample data and production cannot be picked", async ({
		page,
	}) => {
		await open(page, "/challenges");
		const environment = page.getByRole("combobox", { name: "Środowisko" });
		await expect(environment).toHaveText("Test");

		await environment.click();
		await expect(
			page.getByRole("option", { name: /Produkcja/ }),
		).toHaveAttribute("aria-disabled", "true");
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
