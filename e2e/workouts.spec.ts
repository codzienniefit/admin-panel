import { confirm, dialog, expect, open, test, toast } from "./support/test";

test("search ignores Polish letters and stays in the address", async ({
	page,
}) => {
	await open(page, "/workouts");
	const search = page.getByRole("searchbox", { name: "Szukaj treningu" });
	await search.fill("mobilnosc bioder");

	const found = page.getByRole("row", { name: /Poranna mobilność bioder/ });
	await expect(found).toBeVisible();
	await expect(page.getByRole("row", { name: /Interwały HIIT/ })).toHaveCount(
		0,
	);
	await expect(page).toHaveURL(/q=mobilnosc/);

	// A filtered list can be sent to a colleague: it survives a reload.
	await page.reload();
	await expect(search).toHaveValue("mobilnosc bioder");
	await expect(found).toBeVisible();
});

test("a new workout needs a name, then is saved as a draft", async ({
	page,
}) => {
	await open(page, "/workouts");
	await page.getByRole("button", { name: "Nowy trening" }).click();
	const editor = dialog(page, "Nowy trening");

	await editor.getByRole("button", { name: "Zapisz szkic" }).click();
	await expect(editor.getByRole("textbox", { name: "Nazwa" })).toHaveAttribute(
		"aria-invalid",
		"true",
	);

	await editor
		.getByRole("textbox", { name: "Nazwa" })
		.fill("[TEST] Nowy trening z testu");
	await editor.getByRole("button", { name: "Zapisz szkic" }).click();
	await expect(toast(page, "Trening utworzony")).toBeVisible();

	await open(page, "/workouts?q=%5BTEST%5D&status=draft");
	await expect(
		page.getByRole("row", { name: /\[TEST\] Nowy trening z testu/ }),
	).toBeVisible();
});

test("an edited workout is saved and is still there after a reload", async ({
	page,
}) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	await editor
		.getByRole("textbox", { name: "Komentarz" })
		.fill("sprawdzone w teście");
	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Trening zapisany")).toBeVisible();

	await open(page, "/workouts/W1");
	await expect(
		dialog(page, "Poranna mobilność bioder").getByRole("textbox", {
			name: "Komentarz",
		}),
	).toHaveValue("sprawdzone w teście");
});

test("closing an editor with unsaved input asks first", async ({ page }) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	await editor.getByRole("textbox", { name: "Nazwa" }).fill("Zmieniona nazwa");
	await editor.getByRole("button", { name: "Anuluj" }).click();

	// Staying keeps what was typed.
	const question = dialog(page, "Zamknąć bez zapisywania?");
	await question.getByRole("button", { name: "Anuluj" }).click();
	await expect(editor.getByRole("textbox", { name: "Nazwa" })).toHaveValue(
		"Zmieniona nazwa",
	);

	// Leaving throws it away.
	await editor.getByRole("button", { name: "Anuluj" }).click();
	await confirm(page, "Zamknąć bez zapisywania?", "Zamknij bez zapisu");
	await expect(editor).toBeHidden();
	await expect(page).toHaveURL(/\/workouts$/);

	// Nothing was saved.
	await open(page, "/workouts/W1");
	await expect(dialog(page, "Poranna mobilność bioder")).toBeVisible();
});
