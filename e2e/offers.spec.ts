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

test("an offer is created switched off, completed, and then switched on", async ({
	page,
}) => {
	await open(page, "/offers");
	await page.getByRole("button", { name: "Nowa oferta" }).first().click();
	const editor = dialog(page, "Nowa oferta");

	await editor.getByRole("textbox", { name: "Kod" }).fill("jesien2026");
	await choose(editor, "Offering z RevenueCat", "pro_promo_black_friday");
	await editor.getByRole("button", { name: "Utwórz ofertę" }).click();
	await expect(toast(page, "Oferta utworzona")).toBeVisible();

	// Saved in capitals, switched off, and saying what it still lacks.
	const created = dialog(page, "JESIEN2026");
	await expect(
		created.getByText("Żeby włączyć ofertę, uzupełnij"),
	).toBeVisible();
	await created.getByRole("button", { name: "Włącz ofertę" }).click();
	await expect(created.getByRole("alert").first()).toBeVisible();

	await created
		.getByRole("textbox", { name: "Tytuł", exact: true })
		.fill("Jesień z Pro");
	await created
		.getByRole("textbox", { name: "Podtytuł" })
		.fill("Pierwszy miesiąc za darmo");
	const play = created.getByRole("region", { name: "Google Play" });
	await play.getByRole("textbox", { name: "Produkt" }).fill("cf_pro");
	await play.getByRole("textbox", { name: "Plan bazowy" }).fill("monthly");
	await play
		.getByRole("textbox", { name: "Oferta w Google Play" })
		.fill("free-month");
	await created
		.getByRole("region", { name: "App Store" })
		.getByRole("textbox", { name: "Produkt" })
		.fill("cf.pro.monthly");
	await created.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Oferta zapisana")).toBeVisible();

	await page.getByRole("row", { name: /JESIEN2026/ }).click();
	const ready = dialog(page, "JESIEN2026");
	await expect(
		ready.getByText("Oferta jest gotowa do włączenia"),
	).toBeVisible();
	await ready.getByRole("button", { name: "Włącz ofertę" }).click();
	await confirm(page, "Włączyć ofertę?", "Włącz");
	await expect(toast(page, "Oferta włączona")).toBeVisible();
	await expect(ready.getByText("Aktywna", { exact: true })).toBeVisible();
});

test("a live offer is switched off only after a confirmation", async ({
	page,
}) => {
	await open(page, "/offers");
	await page.getByRole("row", { name: /LATO2026/ }).click();
	const editor = dialog(page, "LATO2026");

	await pick(editor, "Więcej akcji", "Wyłącz ofertę");
	await confirm(page, "Wyłączyć ofertę?", "Wyłącz");
	await expect(toast(page, "Oferta wyłączona")).toBeVisible();
	await expect(editor.getByText("Wyłączona", { exact: true })).toBeVisible();
});

test("a code another offer has is refused next to its field", async ({
	page,
}) => {
	await open(page, "/offers");
	await page.getByRole("button", { name: "Nowa oferta" }).first().click();
	const editor = dialog(page, "Nowa oferta");

	await editor.getByRole("textbox", { name: "Kod" }).fill("lato2026");
	await choose(editor, "Offering z RevenueCat", "pro_promo_black_friday");
	await editor.getByRole("button", { name: "Utwórz ofertę" }).click();

	await expect(editor.getByRole("textbox", { name: "Kod" })).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(
		editor.getByText(/Tego kodu używa już oferta o_1/),
	).toBeVisible();
});
