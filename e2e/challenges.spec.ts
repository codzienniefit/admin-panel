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

test("the list is narrowed by search and by status", async ({ page }) => {
	await open(page, "/challenges");
	await page.getByRole("searchbox", { name: "Szukaj wyzwania" }).fill("plecy");
	await expect(
		page.getByRole("link", { name: /Mocne plecy w 7 dni/ }),
	).toBeVisible();
	await expect(page.getByRole("link", { name: /Wiosenny start/ })).toHaveCount(
		0,
	);

	// The published one is not a draft.
	await choose(page, "Status", "Szkic");
	await expect(
		page.getByRole("link", { name: /Mocne plecy w 7 dni/ }),
	).toHaveCount(0);
	await expect(page).toHaveURL(/status=draft/);
});

test("a challenge is created as a draft and gets its first variant", async ({
	page,
}) => {
	await open(page, "/challenges");
	await page.getByRole("button", { name: "Nowe wyzwanie" }).click();
	await page
		.getByRole("textbox", { name: "Nazwa" })
		.fill("[TEST] Wyzwanie z testu");
	await page.getByRole("spinbutton", { name: "Liczba tygodni" }).fill("2");
	await page.getByRole("button", { name: "Utwórz szkic" }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "[TEST] Wyzwanie z testu" }),
	).toBeVisible();
	await expect(page.getByText("Szkic", { exact: true }).first()).toBeVisible();

	// A new challenge opens on its content; variants are on the overview.
	await page.getByRole("link", { name: "Przegląd" }).click();
	await expect(page.getByText("Brak wariantów")).toBeVisible();
	await page.getByRole("button", { name: "Dodaj wariant" }).click();
	const variant = dialog(page, "Nowy wariant");
	await choose(variant, "Poziom", "Początkujący");
	await variant.getByRole("button", { name: "Dodaj wariant" }).click();

	await expect(toast(page, "Wariant dodany")).toBeVisible();
	await expect(
		page.getByRole("heading", { name: "Warianty (1)" }),
	).toBeVisible();
	await expect(page.getByText("14 dni · 0 treningów")).toBeVisible();
});

test("an unfinished draft cannot be published, and says why", async ({
	page,
}) => {
	await open(page, "/challenges/new");
	await page.getByRole("textbox", { name: "Nazwa" }).fill("[TEST] Niegotowe");
	await page.getByRole("button", { name: "Utwórz szkic" }).click();
	await expect(
		page.getByRole("heading", { level: 1, name: "[TEST] Niegotowe" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Opublikuj" }).click();

	const refusal = page
		.getByRole("alert")
		.filter({ hasText: "Nie można opublikować" });
	await expect(refusal).toBeVisible();
	await expect(refusal.getByRole("listitem").first()).toBeVisible();
	// Nothing was asked and nothing changed.
	await expect(dialog(page, "Opublikować wyzwanie?")).toHaveCount(0);
	await expect(page.getByText("Szkic", { exact: true }).first()).toBeVisible();
});

test("content is edited, saved, and still there after a reload", async ({
	page,
}) => {
	await open(page, "/challenges/C1/content");
	const save = page.getByRole("button", { name: "Zapisz zmiany" });
	await expect(save).toBeDisabled();

	await page
		.getByRole("textbox", { name: "Nazwa" })
		.fill("Wiosenny start 2027");
	await save.click();
	await expect(toast(page, "Zapisano")).toBeVisible();
	await expect(
		page.getByRole("heading", { level: 1, name: "Wiosenny start 2027" }),
	).toBeVisible();

	await page.reload();
	await expect(page.getByRole("textbox", { name: "Nazwa" })).toHaveValue(
		"Wiosenny start 2027",
	);
});

test("content can be saved the moment the page opens", async ({ page }) => {
	// The rules need the full workout list. Saving before it arrived used to
	// be refused, with every workout of the plan called unknown.
	await page.goto("/challenges/C1/content");
	await page.getByRole("textbox", { name: "Nazwa" }).fill("Szybka zmiana");
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();
});

test("a published challenge is hidden only after a confirmation", async ({
	page,
}) => {
	// C7 is published and not the promoted one.
	await open(page, "/challenges/C7");
	await pick(page, "Więcej akcji", "Ukryj");

	// Saying no changes nothing.
	const question = dialog(page, "Ukryć wyzwanie?");
	await question.getByRole("button", { name: "Anuluj" }).click();
	await expect(
		page.getByText("Opublikowane", { exact: true }).first(),
	).toBeVisible();

	await pick(page, "Więcej akcji", "Ukryj");
	await confirm(page, "Ukryć wyzwanie?", "Ukryj");
	await expect(toast(page, "Wyzwanie ukryte")).toBeVisible();
	await expect(page.getByText("Ukryte", { exact: true }).first()).toBeVisible();
});
