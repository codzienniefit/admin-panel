import { confirm, dialog, expect, open, test, toast } from "./support/test";

test("a new message is saved as a draft", async ({ page }) => {
	await open(page, "/messages");
	await page.getByRole("button", { name: "Nowa wiadomość" }).click();
	const editor = dialog(page, "Nowa wiadomość");
	await editor
		.getByRole("textbox", { name: "Opis" })
		.fill("[TEST] Wiadomość z testu");
	await editor.getByRole("button", { name: "Zapisz jako roboczą" }).click();
	await expect(toast(page, "Zapisano jako roboczą")).toBeVisible();

	await open(page, "/messages");
	const row = page.getByRole("row", { name: /\[TEST\] Wiadomość z testu/ });
	await expect(row).toBeVisible();
	await expect(row.getByText("Robocza")).toBeVisible();
});

test("a draft is sent once, after the question names who gets it", async ({
	page,
}) => {
	await open(page, "/messages");
	const row = page.getByRole("row", {
		name: /Zapowiedź wyzwania Wiosenny start/,
	});
	await row.click();
	const editor = dialog(page, "Zapowiedź wyzwania Wiosenny start");
	await editor.getByRole("button", { name: "Wyślij…" }).click();

	const question = dialog(page, "Wysłać wiadomość?");
	await expect(question).toContainText(/wszys/i);
	await confirm(page, "Wysłać wiadomość?", "Wyślij teraz");
	await expect(toast(page, /wysłana/i)).toBeVisible();

	// A sent message cannot be sent again or edited.
	await open(page, "/messages");
	await expect(row.getByText("Wysłana")).toBeVisible();
	await row.click();
	await expect(editor.getByText("Ta wiadomość została wysłana")).toBeVisible();
	await expect(editor.getByRole("button", { name: "Wyślij…" })).toHaveCount(0);
});

test("a message with no recipients is not sent, and says why", async ({
	page,
}) => {
	await open(page, "/messages");
	await page.getByRole("row", { name: /Nowy plan uzupełniający/ }).click();
	const editor = dialog(page, "Nowy plan uzupełniający");
	await editor.getByRole("button", { name: "Wyślij…" }).click();

	await expect(dialog(page, "Wysłać wiadomość?")).toHaveCount(0);
	await expect(editor.getByRole("alert").first()).toBeVisible();
	await expect(editor.getByRole("button", { name: "Wyślij…" })).toBeVisible();
});
