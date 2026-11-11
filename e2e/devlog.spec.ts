import {
	choose,
	dialog,
	expect,
	open,
	pick,
	test,
	toast,
} from "./support/test";

// Developer mode: the register of every call the panel makes to the backend.

test("every call is listed with its parameters, answer and status", async ({
	page,
}) => {
	await open(page, "/challenges/C1/content");
	await page.getByRole("textbox", { name: "Komentarz" }).fill("z rejestru");
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();

	await page.getByRole("button", { name: "Rejestr wywołań" }).click();
	const register = dialog(page, "Rejestr wywołań");
	const calls = register.getByRole("list", { name: "Wywołania" });
	// Loading the page asked for the lists.
	await expect(
		calls.getByRole("button", { name: /challenges\.list.*200 OK/ }),
	).toBeVisible();

	// The save, newest first, with what was sent and what came back.
	const save = calls.getByRole("button", { name: /challenges\.save/ }).first();
	await expect(save).toContainText("200 OK");
	await save.click();
	await expect(
		register.getByRole("textbox", { name: "Parametry: challenges.save" }),
	).toHaveValue(/"internalTitle": "z rejestru"/);
	await expect(
		register.getByRole("textbox", { name: "Odpowiedź: challenges.save" }),
	).toHaveValue(/"etag"/);
});

test("a failed call turns the button red until someone looks", async ({
	page,
}) => {
	await open(page, "/challenges/C1/content");
	await expect(
		page.getByRole("button", { name: "Rejestr wywołań" }),
	).toBeVisible();

	// Someone else renames the challenge just before this save: a 409.
	await pick(page, "Konto: Ada Adminowska", "Dane testowe…");
	const controls = dialog(page, "Dane testowe");
	await choose(
		controls,
		"Konflikt przy następnym zapisie",
		"Ktoś zmienia inne pole",
	);
	await controls.getByRole("button", { name: "Zamknij" }).last().click();
	await page.getByRole("textbox", { name: "Komentarz" }).fill("moja zmiana");
	await page.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Zapisano")).toBeVisible();

	const button = page.getByRole("button", {
		name: "Rejestr wywołań: 1 nieudane",
	});
	await expect(button).toBeVisible();
	await button.click();

	const register = dialog(page, "Rejestr wywołań");
	await register.getByRole("switch", { name: "Tylko nieudane" }).click();
	const failed = register
		.getByRole("list", { name: "Wywołania" })
		.getByRole("button");
	await expect(failed).toHaveCount(1);
	await expect(failed).toContainText("challenges.save");
	await expect(failed).toContainText("409 konflikt wersji");

	// Looked at: the button is calm again.
	await register.getByRole("button", { name: "Zamknij" }).last().click();
	await expect(
		page.getByRole("button", { name: "Rejestr wywołań", exact: true }),
	).toBeVisible();
});

test("developer mode can be switched off, and stays off", async ({ page }) => {
	await open(page, "/challenges");
	await pick(page, "Konto: Ada Adminowska", "Tryb deweloperski: wyłącz");
	await expect(
		page.getByRole("button", { name: /Rejestr wywołań/ }),
	).toHaveCount(0);

	await page.reload();
	await expect(
		page.getByRole("link", { name: /Wiosenny start/ }),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: /Rejestr wywołań/ }),
	).toHaveCount(0);

	await pick(page, "Konto: Ada Adminowska", "Tryb deweloperski: włącz");
	await expect(
		page.getByRole("button", { name: /Rejestr wywołań/ }),
	).toBeVisible();
});
