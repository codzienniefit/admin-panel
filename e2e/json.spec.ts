import type { Locator, Page } from "@playwright/test";
import { dialog, expect, open, pick, test, toast } from "./support/test";

// "Podgląd JSON…" in an editor's menu: the JSON on the server now, the JSON
// a save would send, and only what differs between the two.

const changed = (preview: Locator) =>
	preview
		.getByRole("list", { name: "Zmienione właściwości" })
		.getByRole("listitem");

async function openPreview(scope: Page | Locator, title: string) {
	await pick(scope, "Więcej akcji", "Podgląd JSON…");
	const page = "page" in scope ? scope.page() : scope;
	const preview = dialog(page, title);
	await expect(preview).toBeVisible();
	return preview;
}

const show = (preview: Locator, view: "Różnice" | "Przed" | "Po") =>
	preview.getByRole("button", { name: view, exact: true }).click();

test("a challenge with nothing changed has no differences", async ({
	page,
}) => {
	await open(page, "/challenges/C1");
	const preview = await openPreview(page, "JSON wyzwania");
	await expect(preview.getByText("Brak różnic")).toBeVisible();

	await show(preview, "Przed");
	const before = preview.getByRole("textbox", { name: "JSON przed zapisem" });
	await expect(before).toHaveValue(/"id": "C1"/);
	await expect(before).toHaveValue(/"title": "Wiosenny start"/);
	// Nothing of the panel's own bookkeeping is shown as data.
	await expect(before).not.toHaveValue(/\$origin|\$key/);
});

test("unsaved content shows only the properties that will change", async ({
	page,
}) => {
	await open(page, "/challenges/C1/content");
	await page
		.getByRole("textbox", { name: "Nazwa" })
		.fill("Wiosenny start 2027");
	await page.getByRole("textbox", { name: "Komentarz" }).fill("");

	const preview = await openPreview(page, "JSON wyzwania");
	await expect(changed(preview)).toHaveText(["title", "internalTitle"]);
	await expect(
		preview.getByRole("textbox", { name: "Zmienione: było" }),
	).toHaveValue(
		'{\n  "title": "Wiosenny start",\n  "internalTitle": "premiera w marcu"\n}',
	);
	await expect(
		preview.getByRole("textbox", { name: "Zmienione: będzie" }),
	).toHaveValue(
		'{\n  "title": "Wiosenny start 2027",\n  "internalTitle": null\n}',
	);

	// The whole document that would be sent keeps what this panel does not know.
	await show(preview, "Po");
	const after = preview.getByRole("textbox", { name: "JSON po zapisie" });
	await expect(after).toHaveValue(/"title": "Wiosenny start 2027"/);
	await expect(after).toHaveValue(/"x_addedByNewerBackend": "challenge:C1"/);
	await show(preview, "Przed");
	await expect(
		preview.getByRole("textbox", { name: "JSON przed zapisem" }),
	).toHaveValue(/"title": "Wiosenny start"/);
	await preview.getByRole("button", { name: "Zamknij" }).last().click();

	// Once saved, "before" is the new version and nothing differs.
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();
	const saved = await openPreview(page, "JSON wyzwania");
	await expect(saved.getByText("Brak różnic")).toBeVisible();
	await show(saved, "Przed");
	await expect(
		saved.getByRole("textbox", { name: "JSON przed zapisem" }),
	).toHaveValue(/"title": "Wiosenny start 2027"/);
});

test("a staged plan change is shown down to the day", async ({ page }) => {
	// A published challenge: plan changes wait for "Zapisz zmiany".
	await open(page, "/challenges/C2/plan/p-main");
	await pick(
		page.getByRole("group", { name: "Dzień 1", exact: true }),
		/^Akcje: /,
		"Usuń z dnia",
	);

	const preview = await openPreview(page, "JSON wyzwania");
	await expect(changed(preview)).toHaveText([
		"paths[p-main].days[1].workoutIds",
	]);
	const will = preview.getByRole("textbox", { name: "Zmienione: będzie" });
	await expect(will).toHaveValue(/"pathId": "p-main"/);
	await expect(will).toHaveValue(/"dayIndex": 1/);
	await expect(will).toHaveValue(/"workoutIds": \[\]/);
	// The other days are not there.
	await expect(will).not.toHaveValue(/"dayIndex": 2/);
});

test("a workout shows its one changed property", async ({ page }) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	await editor
		.getByRole("textbox", { name: "Komentarz" })
		.fill("do sprawdzenia");

	const preview = await openPreview(editor, "JSON treningu");
	await expect(changed(preview)).toHaveText(["internalTitle"]);
	await expect(
		preview.getByRole("textbox", { name: "Zmienione: będzie" }),
	).toHaveValue('{\n  "internalTitle": "do sprawdzenia"\n}');
	await preview.getByRole("button", { name: "Zamknij" }).last().click();

	// The preview changed nothing: the editor still has the unsaved input.
	await expect(editor.getByRole("textbox", { name: "Komentarz" })).toHaveValue(
		"do sprawdzenia",
	);
});

test("something new shows everything that will be sent", async ({ page }) => {
	await open(page, "/workouts/new");
	const editor = dialog(page, "Nowy trening");
	await editor.getByRole("textbox", { name: "Nazwa" }).fill("[TEST] Podgląd");

	const preview = await openPreview(editor, "JSON treningu");
	await expect(
		preview.getByText("Tego jeszcze nie ma na serwerze"),
	).toBeVisible();
	await expect(preview.getByRole("textbox", { name: "Nowy JSON" })).toHaveValue(
		/"title": "\[TEST\] Podgląd"/,
	);
	await show(preview, "Przed");
	await expect(
		preview.getByText("Tego jeszcze nie ma na serwerze."),
	).toBeVisible();
});

test("a badge shows its one changed property", async ({ page }) => {
	await open(page, "/badges");
	await page.getByRole("row", { name: /Mocne plecy/ }).click();
	const editor = dialog(page, "Mocne plecy");
	await editor.getByRole("switch", { name: /Ukryta/ }).click();

	const preview = await openPreview(editor, "JSON odznaki");
	await expect(changed(preview)).toHaveText(["isHidden"]);
	await expect(
		preview.getByRole("textbox", { name: "Zmienione: będzie" }),
	).toHaveValue('{\n  "isHidden": true\n}');
});
