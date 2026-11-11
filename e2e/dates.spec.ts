import { dialog, expect, open, test, toast } from "./support/test";

// Every date in the panel is entered through one field (src/ui/DateField):
// typed the Polish way, or picked from the panel's own calendar.

const CONTENT = "/challenges/C1/content";

test("a date is picked from the calendar, with its time", async ({ page }) => {
	await open(page, CONTENT);
	const field = page.getByRole("textbox", { name: "Data ukrycia" });
	await expect(field).toHaveValue("");

	await page.getByRole("button", { name: "Kalendarz: Data ukrycia" }).click();
	// Opens on today's month; "today" is fixed in the tests.
	await expect(page.getByRole("grid", { name: "listopad 2026" })).toBeVisible();
	await page.getByRole("button", { name: "piątek, 20 listopada 2026" }).click();
	await expect(field).toHaveValue("20.11.2026 13:00");

	// The time is set in the same panel.
	const time = page.getByRole("textbox", { name: "Godzina" });
	await time.fill("9:05");
	await time.press("Enter");
	await expect(field).toHaveValue("20.11.2026 09:05");
	await page.getByRole("button", { name: "Gotowe" }).click();
	await expect(page.getByRole("grid")).toHaveCount(0);

	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();
	await page.reload();
	await expect(field).toHaveValue("20.11.2026 09:05");
});

test("the calendar moves between months and jumps back to today", async ({
	page,
}) => {
	await open(page, CONTENT);
	// This field holds 10 March 2027, so the calendar opens there.
	await page.getByRole("button", { name: "Kalendarz: Data premiery" }).click();
	await expect(page.getByRole("grid", { name: "marzec 2027" })).toBeVisible();

	await page
		.getByRole("button", { name: "Przejdź do następnego miesiąca" })
		.click();
	await expect(page.getByRole("grid", { name: "kwiecień 2027" })).toBeVisible();

	await page.getByRole("button", { name: "Dziś" }).click();
	await expect(page.getByRole("grid", { name: "listopad 2026" })).toBeVisible();
	// The hour that was set stays.
	await expect(
		page.getByRole("textbox", { name: "Data premiery" }),
	).toHaveValue("12.11.2026 10:00");
});

test("a date can be typed, and a date that does not exist is refused", async ({
	page,
}) => {
	await open(page, CONTENT);
	const field = page.getByRole("textbox", { name: "Data ukrycia" });

	await field.fill("31.02.2027 10:00");
	await field.press("Enter");
	await expect(field).toHaveAttribute("aria-invalid", "true");
	await expect(
		page.getByText("Wpisz datę jako DD.MM.RRRR GG:MM"),
	).toBeVisible();
	// Nothing was taken: the form has no change to save.
	await expect(
		page.getByRole("button", { name: "Zapisz zmiany" }),
	).toBeDisabled();

	// Short forms are completed.
	await field.fill("1.3.2027 9");
	await field.press("Enter");
	await expect(field).toHaveValue("01.03.2027 09:00");
	await expect(
		page.getByRole("button", { name: "Zapisz zmiany" }),
	).toBeEnabled();
});

test("a date is cleared with one click", async ({ page }) => {
	await open(page, CONTENT);
	const field = page.getByRole("textbox", { name: "Data premiery" });
	await expect(field).toHaveValue("10.03.2027 10:00");
	await page.getByRole("button", { name: "Wyczyść: Data premiery" }).click();
	await expect(field).toHaveValue("");
	await expect(
		page.getByRole("button", { name: "Wyczyść: Data premiery" }),
	).toHaveCount(0);
});

test("the same calendar works inside an editor window", async ({ page }) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	await editor.getByRole("button", { name: "Kalendarz: Data live" }).click();
	await page.getByRole("button", { name: "środa, 25 listopada 2026" }).click();
	await page.getByRole("button", { name: "Gotowe" }).click();
	await expect(editor.getByRole("textbox", { name: "Data live" })).toHaveValue(
		"25.11.2026 13:00",
	);

	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Trening zapisany")).toBeVisible();
	await open(page, "/workouts/W1");
	await expect(editor.getByRole("textbox", { name: "Data live" })).toHaveValue(
		"25.11.2026 13:00",
	);
});
