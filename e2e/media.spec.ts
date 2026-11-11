import type { Locator, Page } from "@playwright/test";
import { dialog, expect, open, test, toast } from "./support/test";

// Uploading a file where it is needed: in a form's media field and in an
// image block of the content editor, without a detour through the library.

/** The smallest real picture: one pixel of WebP, so the panel can measure it. */
const PIXEL = Buffer.from(
	"UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
	"base64",
);

/**
 * Clicks an upload button and answers the file chooser it opens, as a person
 * does. (The file input itself is hidden; the button is what is on screen.)
 */
async function chooseFile(
	page: Page,
	button: Locator,
	file: { name: string; mimeType: string },
): Promise<void> {
	const chooser = page.waitForEvent("filechooser");
	await button.click();
	await (await chooser).setFiles({ ...file, buffer: PIXEL });
}

test("a picture uploaded in a form field is saved with the form", async ({
	page,
}) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	const thumbnail = editor.getByRole("group", { name: "Miniaturka" });

	await chooseFile(
		page,
		thumbnail.getByRole("button", { name: "Wybierz z komputera" }),
		{ name: "test-okladka.webp", mimeType: "image/webp" },
	);
	await expect(toast(page, "Plik dodany")).toBeVisible();
	await expect(thumbnail.getByText("workouts/test-okladka.webp")).toBeVisible();

	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Trening zapisany")).toBeVisible();

	await open(page, "/workouts/W1");
	await expect(
		dialog(page, "Poranna mobilność bioder")
			.getByRole("group", { name: "Miniaturka" })
			.getByText("workouts/test-okladka.webp"),
	).toBeVisible();
});

test("a file the folder does not take is refused and the field keeps its picture", async ({
	page,
}) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	const thumbnail = editor.getByRole("group", { name: "Miniaturka" });
	const current = thumbnail.getByText(/^workouts\/.+-w1\.webp$/);
	await expect(current).toBeVisible();

	await chooseFile(
		page,
		thumbnail.getByRole("button", { name: "Wybierz z komputera" }),
		{ name: "test-okladka.png", mimeType: "image/png" },
	);

	await expect(thumbnail.getByRole("alert")).toHaveText(
		"Do folderu „Treningi” można dodać tylko pliki: webp.",
	);
	await expect(current).toBeVisible();
	await expect(thumbnail.getByText("test-okladka")).toHaveCount(0);
	await expect(toast(page, "Plik dodany")).toHaveCount(0);
});

test("an image block takes a picture uploaded in place", async ({ page }) => {
	await open(page, "/workouts/W1");
	const editor = dialog(page, "Poranna mobilność bioder");
	// The content editor is part of the form: the "Opis" field.
	const description = editor.getByRole("group", { name: "Opis", exact: true });

	await description.getByRole("button", { name: "+ Obraz" }).click();
	const picture = description.getByRole("group", {
		name: /^Obraz, blok \d+$/,
	});
	await expect(
		description.getByText("Nie wybrano obrazu").first(),
	).toBeVisible();

	await chooseFile(
		page,
		picture.getByRole("button", { name: "Wybierz z komputera" }),
		{
			name: "test-w-tresci.webp",
			mimeType: "image/webp",
		},
	);
	await expect(toast(page, "Plik dodany")).toBeVisible();
	await expect(picture.getByText("workouts/test-w-tresci.webp")).toBeVisible();
	// The picture was measured too: nothing is left to fix.
	await expect(
		description.getByText("Wszystkie bloki są poprawne (3)"),
	).toBeVisible();

	await editor.getByRole("button", { name: "Zapisz zmiany" }).click();
	await expect(toast(page, "Trening zapisany")).toBeVisible();

	await open(page, "/workouts/W1");
	await expect(
		dialog(page, "Poranna mobilność bioder")
			.getByRole("group", { name: "Opis", exact: true })
			.getByRole("group", { name: /^Obraz, blok \d+$/ })
			.getByText("workouts/test-w-tresci.webp"),
	).toBeVisible();
});
