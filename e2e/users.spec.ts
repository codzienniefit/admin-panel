import { expect, open, test } from "./support/test";

test("people are found only by a search of three characters or more", async ({
	page,
}) => {
	await open(page, "/users");
	const search = page.getByRole("searchbox", { name: "Kogo szukasz?" });
	// Personal data: nobody is listed until someone is searched for.
	await expect(page.getByRole("table")).toHaveCount(0);

	await search.fill("ag");
	await page.getByRole("button", { name: "Szukaj" }).click();
	await expect(page.getByRole("alert")).toHaveText("Wpisz co najmniej 3 znaki");
	await expect(page.getByRole("table")).toHaveCount(0);

	await search.fill("agnieszka.makietowa55");
	await page.getByRole("button", { name: "Szukaj" }).click();
	await expect(
		page.getByRole("row", { name: /Agnieszka Makietowa/ }),
	).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(2);
});

test("an account opens with its badges and progress", async ({ page }) => {
	await open(page, "/users");
	await page
		.getByRole("searchbox", { name: "Kogo szukasz?" })
		.fill("agnieszka.makietowa55");
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
