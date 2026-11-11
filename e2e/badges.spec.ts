import { dialog, expect, open, test, toast } from "./support/test";

test("a badge is created and found on the list", async ({ page }) => {
	await open(page, "/badges");
	await page.getByRole("button", { name: "Nowa odznaka" }).click();
	const editor = dialog(page, "Nowa odznaka");

	await editor.getByRole("button", { name: "Utwórz odznakę" }).click();
	await expect(editor.getByRole("textbox", { name: "Nazwa" })).toHaveAttribute(
		"aria-invalid",
		"true",
	);

	await editor
		.getByRole("textbox", { name: "Nazwa" })
		.fill("[TEST] Odznaka z testu");
	// The picture comes from the media library.
	await editor.getByRole("button", { name: "Grafika" }).click();
	await dialog(page, "Wybierz grafikę")
		.getByRole("listitem")
		.first()
		.getByRole("button")
		.click();
	await editor.getByRole("button", { name: "Utwórz odznakę" }).click();
	await expect(toast(page, "Odznaka utworzona")).toBeVisible();

	await open(page, "/badges?q=%5BTEST%5D");
	await expect(
		page.getByRole("row", { name: /\[TEST\] Odznaka z testu/ }),
	).toBeVisible();
});

test("a badge that workouts still use cannot be hidden", async ({ page }) => {
	await open(page, "/badges");
	await page.getByRole("row", { name: /Pierwszy trening/ }).click();
	const editor = dialog(page, "Pierwszy trening");
	await expect(editor.getByText(/Przypisana do/)).toBeVisible();

	await editor.getByRole("switch", { name: /Ukryta/ }).click();
	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();

	await expect(editor.getByRole("alert").first()).toBeVisible();
	await open(page, "/badges");
	await expect(
		page.getByRole("row", { name: /Pierwszy trening/ }).getByText("Widoczna"),
	).toBeVisible();
});
