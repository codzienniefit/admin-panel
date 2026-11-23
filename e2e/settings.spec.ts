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

test("a folder is added, given to a challenge, and filters the list", async ({
	page,
}) => {
	await open(page, "/settings/folders");
	await page.getByRole("textbox", { name: "Nowy folder" }).fill("[TEST] Zima");
	await page.getByRole("button", { name: "Dodaj folder" }).click();
	await expect(toast(page, "Folder dodany")).toBeVisible();

	await open(page, "/challenges/C1");
	await choose(page, "Folder", "[TEST] Zima");
	await expect(toast(page, "Zapisano")).toBeVisible();

	await open(page, "/challenges");
	await choose(page, "Folder", "[TEST] Zima");
	await expect(page.getByText("1 pozycja")).toBeVisible();
	await expect(
		page.getByRole("link", { name: /Wiosenny start/ }),
	).toBeVisible();
});

test("a plan type is added and removed", async ({ page }) => {
	await open(page, "/settings/plan-types");
	await page.getByRole("button", { name: "Nowy rodzaj planu" }).click();
	const editor = dialog(page, "Nowy rodzaj planu");

	// The name is required.
	await editor.getByRole("button", { name: "Zapisz" }).click();
	await expect(editor.getByRole("alert")).toBeVisible();

	await editor
		.getByRole("textbox", { name: "Nazwa" })
		.fill("[TEST] Regeneracyjny");
	await editor.getByRole("button", { name: "Zapisz" }).click();
	await expect(toast(page, "Rodzaj planu zapisany")).toBeVisible();
	const added = page.getByRole("heading", { name: "[TEST] Regeneracyjny" });
	await expect(added).toBeVisible();

	// The newest one is last on the page.
	await page.getByRole("button", { name: "Usuń" }).last().click();
	await confirm(page, /Usunąć rodzaj planu „\[TEST\] Regeneracyjny”/, "Usuń");
	await expect(toast(page, "Rodzaj planu usunięty")).toBeVisible();
	await expect(added).toHaveCount(0);
});

test("the app's cache is cleared after a confirmation, and a failure says so", async ({
	page,
}) => {
	await open(page, "/settings");
	await page.getByRole("link", { name: "Aplikacja" }).click();
	await expect(
		page.getByRole("heading", { name: "Pamięć podręczna backendu" }),
	).toBeVisible();
	const clear = page.getByRole("button", { name: "Wyczyść cache backendu" });

	// Saying no clears nothing.
	await clear.click();
	await confirm(page, "Wyczyścić cache backendu?", "Anuluj");
	await expect(page.getByText(/Ostatnio wyczyszczono/)).toHaveCount(0);

	await clear.click();
	await confirm(page, "Wyczyścić cache backendu?", "Wyczyść cache");
	await expect(
		page.getByText(/Ostatnio wyczyszczono: \d\d\.\d\d\.\d{4}/),
	).toBeVisible();
	// The Test environment has no CDN, and says so.
	await expect(page.getByText(/nic nie zostało wyczyszczone/)).toBeVisible();
	await expect(clear).toBeEnabled();

	// A purge that fails shows why.
	await pick(page, "Konto: Ada Adminowska", "Dane testowe…");
	const controls = dialog(page, "Dane testowe");
	await controls
		.getByRole("switch", { name: "Następny zapis się nie uda" })
		.click();
	await controls.getByRole("button", { name: "Zamknij" }).last().click();
	await clear.click();
	await confirm(page, "Wyczyścić cache backendu?", "Wyczyść cache");
	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: "Nie udało się wyczyścić cache" }),
	).toBeVisible();
});
