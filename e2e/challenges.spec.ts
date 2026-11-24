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
	await page.getByRole("link", { name: "Podgląd" }).click();
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

test("recommended next keeps the order it is given, through a save and a reload", async ({
	page,
}) => {
	await open(page, "/challenges/C1/content");
	const list = page.getByRole("list", { name: "Polecane dalej" });

	await choose(page, "Dodaj: Polecane dalej", /Mocne plecy w 7 dni/);
	await choose(page, "Dodaj: Polecane dalej", /Plan spokojny/);
	await expect(list.getByRole("listitem")).toHaveText([
		/1\.\s*Mocne plecy w 7 dni/,
		/2\.\s*Plan spokojny/,
	]);

	// the second becomes the first
	await page
		.getByRole("button", { name: /^Przesuń wyżej: Plan spokojny/ })
		.click();
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();

	await page.reload();
	await expect(list.getByRole("listitem")).toHaveText([
		/1\.\s*Plan spokojny/,
		/2\.\s*Mocne plecy w 7 dni/,
	]);

	// removed, and can be added again at the end
	await page
		.getByRole("button", { name: /^Usuń z listy: Plan spokojny/ })
		.click();
	await expect(list.getByRole("listitem")).toHaveText([/1\.\s*Mocne plecy/]);
	await choose(page, "Dodaj: Polecane dalej", /Plan spokojny/);
	await expect(list.getByRole("listitem")).toHaveText([
		/1\.\s*Mocne plecy/,
		/2\.\s*Plan spokojny/,
	]);
});

test("recommended next starts from the backend's defaults and stores only a real change", async ({
	page,
}) => {
	// C3 has nothing of its own; the backend's defaults are C2, then C1.
	await open(page, "/challenges/C3/content");
	const list = page.getByRole("list", { name: "Polecane dalej" });
	await expect(list.getByRole("listitem")).toHaveText([
		/1\.\s*Mocne plecy w 7 dni/,
		/2\.\s*Wiosenny start/,
	]);
	await expect(
		page.getByText(/To domyślne polecenia z listy treści/),
	).toBeVisible();
	// left as they are, they are no change to save
	await expect(
		page.getByRole("button", { name: "Zapisz zmiany" }),
	).toBeDisabled();

	// another order is the challenge's own list
	await page
		.getByRole("button", { name: /^Przesuń wyżej: Wiosenny start/ })
		.click();
	await expect(page.getByText(/Własne polecenia tego wyzwania/)).toBeVisible();
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();
	await page.reload();
	await expect(list.getByRole("listitem")).toHaveText([
		/1\.\s*Wiosenny start/,
		/2\.\s*Mocne plecy w 7 dni/,
	]);

	// put back in the defaults' order: saved as nothing of its own
	await page
		.getByRole("button", { name: /^Przesuń wyżej: Mocne plecy w 7 dni/ })
		.click();
	await expect(
		page.getByText(/To domyślne polecenia z listy treści/),
	).toBeVisible();
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();
	await page.reload();
	await expect(list.getByRole("listitem")).toHaveText([
		/1\.\s*Mocne plecy w 7 dni/,
		/2\.\s*Wiosenny start/,
	]);
	await expect(
		page.getByText(/To domyślne polecenia z listy treści/),
	).toBeVisible();
	await page.getByRole("link", { name: "Podgląd" }).click();
	await expect(
		page.getByText("Mocne plecy w 7 dni, Wiosenny start (domyślne)"),
	).toBeVisible();
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

test("something once published is never a draft again, and comes back from the bin hidden", async ({
	page,
}) => {
	// C7 is published and not the promoted one.
	await open(page, "/challenges/C7");
	await pick(page, "Więcej akcji", "Ukryj");
	await confirm(page, "Ukryć wyzwanie?", "Ukryj");
	await expect(toast(page, "Wyzwanie ukryte")).toBeVisible();

	// hidden: no way back to a draft
	await page.getByRole("button", { name: "Więcej akcji", exact: true }).click();
	await expect(
		page.getByRole("menuitem", { name: "Cofnij do szkicu" }),
	).toHaveCount(0);
	await page.getByRole("menuitem", { name: /^Usuń/ }).click();
	await confirm(page, "Usunąć wyzwanie?", "Usuń");
	await expect(toast(page, "Wyzwanie w koszu")).toBeVisible();

	await expect(
		page.getByText(/Było już opublikowane, więc wraca jako ukryte/),
	).toBeVisible();
	await page.getByRole("button", { name: "Przywróć jako ukryte" }).click();
	await expect(toast(page, "Wyzwanie przywrócone jako ukryte")).toBeVisible();
	await expect(page.getByText("Ukryte", { exact: true }).first()).toBeVisible();
});
