import type { Page } from "@playwright/test";
import {
	choose,
	confirm,
	dialog,
	expect,
	open,
	pick,
	test,
	toast,
} from "./support/test";

// The pretend server of the Test environment can be told to fail or to meet
// someone else's change on the next save ("Dane testowe" in the account
// menu). These tests use that to check that nobody's work is lost.

const CONTENT = "/challenges/C1/content";

async function sampleData(page: Page) {
	await pick(page, "Konto: Ada Adminowska", "Dane testowe…");
	return dialog(page, "Dane testowe");
}

test("a change someone else made to another field is kept", async ({
	page,
}) => {
	await open(page, CONTENT);
	const controls = await sampleData(page);
	await choose(
		controls,
		"Konflikt przy następnym zapisie",
		"Ktoś zmienia inne pole",
	);
	await controls.getByRole("button", { name: "Zamknij" }).last().click();

	// The other person renames the challenge; this one edits the comment.
	await page.getByRole("textbox", { name: "Komentarz" }).fill("moja zmiana");
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();

	await expect(toast(page, "Zapisano")).toContainText(
		"Połączono ze zmianami innej osoby.",
	);
	// Both changes are there.
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Wiosenny start (zmienione przez innego admina)",
		}),
	).toBeVisible();
	await expect(page.getByRole("textbox", { name: "Komentarz" })).toHaveValue(
		"moja zmiana",
	);
});

test("a clash on the same field stops the save and lets the person choose", async ({
	page,
}) => {
	await open(page, CONTENT);
	const controls = await sampleData(page);
	// The other person renames the challenge, and so does this one.
	await choose(
		controls,
		"Konflikt przy następnym zapisie",
		"Ktoś zmienia inne pole",
	);
	await controls.getByRole("button", { name: "Zamknij" }).last().click();

	await page
		.getByRole("textbox", { name: "Nazwa" })
		.fill("Wiosenny start (moja zmiana)");
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();

	// Not saved silently over the other person's version.
	const notice = page
		.getByRole("alert")
		.filter({ hasText: "Ktoś inny zmienił to samo w międzyczasie" });
	await expect(notice).toContainText(
		"Twoje zmiany nie przepadły. Różnice: Nazwa.",
	);
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Wiosenny start (zmienione przez innego admina)",
		}),
	).toBeVisible();

	// Choosing mine saves it on top.
	await notice.getByRole("button", { name: "Nadpisz moimi zmianami" }).click();
	await expect(
		page.getByRole("heading", {
			level: 1,
			name: "Wiosenny start (moja zmiana)",
		}),
	).toBeVisible();
	await expect(notice).toHaveCount(0);
});

test("sample data keeps changes across a reload until it is reset", async ({
	page,
}) => {
	await open(page, "/settings/folders");
	await page
		.getByRole("textbox", { name: "Nowy folder" })
		.fill("[TEST] Do skasowania");
	await page.getByRole("button", { name: "Dodaj folder" }).click();
	await expect(toast(page, "Folder dodany")).toBeVisible();

	const added = page.locator('input[value="[TEST] Do skasowania"]');
	await page.reload();
	await expect(added).toHaveCount(1);

	const controls = await sampleData(page);
	await controls
		.getByRole("button", { name: "Przywróć dane początkowe" })
		.click();
	await confirm(page, "Przywrócić dane początkowe?", "Przywróć");

	await expect(page.locator('input[value="Archiwum"]')).toHaveCount(1);
	await expect(added).toHaveCount(0);
});
