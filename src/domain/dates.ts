// Dates are stored as UTC ISO strings and shown in the browser's time zone
// (the team works in Europe/Warsaw).

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO UTC → the "YYYY-MM-DDTHH:mm" a datetime-local input wants, local time. */
export function toLocalInput(iso: string | null): string {
	if (!iso) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The reverse; an empty input is null. */
export function fromLocalInput(value: string): string | null {
	if (!value) return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const dateFormat = new Intl.DateTimeFormat("pl-PL", {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
});
const dateTimeFormat = new Intl.DateTimeFormat("pl-PL", {
	day: "2-digit",
	month: "2-digit",
	year: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

export function formatDate(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "—" : dateFormat.format(date);
}

export function formatDateTime(iso: string | null): string {
	if (!iso) return "—";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "—" : dateTimeFormat.format(date);
}
