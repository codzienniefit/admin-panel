import { confirm, dialog, expect, open, test, toast } from "./support/test";

const NOVEMBER = "/challenges/calendar?y=2026&m=11";

test("the calendar shows when challenges run, by month and by year", async ({
	page,
}) => {
	await open(page, NOVEMBER);
	await expect(
		page.getByRole("heading", { name: "Listopad 2026" }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Poranki z jogą 28 dni" }).first(),
	).toBeVisible();

	await page.getByRole("button", { name: "Później" }).click();
	await expect(
		page.getByRole("heading", { name: "Grudzień 2026" }),
	).toBeVisible();

	await page.getByRole("button", { name: "Rok", exact: true }).click();
	await expect(page).toHaveURL(/view=year/);
	await expect(
		page.getByRole("heading", { level: 2, name: "2026" }),
	).toBeVisible();
});

test("a challenge without a date gets one, after a confirmation", async ({
	page,
}) => {
	await open(page, NOVEMBER);
	const undated = page
		.getByRole("listitem")
		.filter({ hasText: "Powrót po przerwie 14 dni" });
	await expect(undated).toHaveCount(1);
	await expect(
		page.getByRole("button", { name: "Powrót po przerwie 14 dni" }),
	).toHaveCount(1);

	await undated.getByRole("button", { name: "Ustaw datę" }).click();
	const picker = dialog(page, "Ustaw datę");
	const from = picker.getByRole("textbox", { name: "Widoczne od" });
	await from.fill("17.11.2026");
	await from.press("Enter");
	await expect(picker.getByText("Koniec: 30.11.2026")).toBeVisible();
	await picker.getByRole("button", { name: "Dalej" }).click();

	await confirm(page, /Przenieść „Powrót po przerwie 14 dni”/, "Przenieś");
	await expect(toast(page, "Data zmieniona")).toBeVisible();

	// Off the "no date" list, and on the grid as a bar.
	await expect(undated).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Powrót po przerwie 14 dni" }).first(),
	).toBeVisible();
});
