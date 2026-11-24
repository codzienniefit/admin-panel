import { expect, open, test } from "./support/test";

test("people are found only by a whole e-mail address or an id, never by name", async ({
	page,
}) => {
	await open(page, "/users");
	const search = page.getByRole("searchbox", { name: "Kogo szukasz?" });
	// Personal data: nobody is listed until someone is searched for.
	await expect(page.getByRole("table")).toHaveCount(0);

	await search.fill("Agnieszka Makietowa");
	await page.getByRole("button", { name: "Szukaj" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Szukamy tylko po całym adresie e-mail albo identyfikatorze użytkownika, nie po imieniu ani nazwisku",
	);
	await expect(page.getByRole("table")).toHaveCount(0);

	await search.fill("agnieszka.makietowa55");
	await page.getByRole("button", { name: "Szukaj" }).click();
	await expect(page.getByRole("table")).toHaveCount(0);

	await search.fill("agnieszka.makietowa55@");
	await page.getByRole("button", { name: "Szukaj" }).click();
	await expect(page.getByRole("alert")).toHaveText(
		"Wpisz cały adres e-mail, np. jan.kowalski@example.com",
	);

	await search.fill("Agnieszka.Makietowa55@example.test");
	await page.getByRole("button", { name: "Szukaj" }).click();
	const found = page.getByRole("row", { name: /Agnieszka Makietowa/ });
	await expect(found).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(2);

	// the same person by their id, taken from the address the row opens
	await found.click();
	await expect(page).toHaveURL(/\/users\/test-/);
	const uid = decodeURIComponent(
		new URL(page.url()).pathname.split("/").at(-1) ?? "",
	);
	await open(page, "/users");
	await search.fill(uid);
	await page.getByRole("button", { name: "Szukaj" }).click();
	await expect(found).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(2);
});

test("an account opens with its badges and progress", async ({ page }) => {
	await open(page, "/users");
	await page
		.getByRole("searchbox", { name: "Kogo szukasz?" })
		.fill("agnieszka.makietowa55@example.test");
	await page.getByRole("button", { name: "Szukaj" }).click();
	await page.getByRole("row", { name: /Agnieszka Makietowa/ }).click();

	await expect(
		page.getByRole("heading", { level: 1, name: "Agnieszka Makietowa" }),
	).toBeVisible();
	const tabs = page.getByRole("tablist", { name: "Części profilu" });
	await expect(tabs.getByRole("tab", { name: "Odznaki" })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(
		page.getByRole("heading", { name: "Przyznaj odznakę" }),
	).toBeVisible();

	await tabs.getByRole("tab", { name: "Wykonania" }).click();
	await expect(tabs.getByRole("tab", { name: "Wykonania" })).toHaveAttribute(
		"aria-selected",
		"true",
	);

	await tabs.getByRole("tab", { name: "Dane ogólne" }).click();
	await expect(
		page.getByText("agnieszka.makietowa55@example.test").first(),
	).toBeVisible();
});
