/**
 * Puts a text on the clipboard. False when the browser refuses (no
 * permission, an insecure page): say so and let the person copy by hand.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
