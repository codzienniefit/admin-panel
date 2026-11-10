import { createStore, useStore } from "@/lib/store";
import type { Tone } from "./tones";

// Short messages that appear at the bottom of the screen and go away by
// themselves. `toast(...)` works from anywhere, including outside React.
// <ToastViewport /> is mounted once, in the root route.

export interface ToastOptions {
	title: string;
	description?: string;
	tone?: Tone;
	/** Milliseconds on screen; 0 keeps it until dismissed. */
	duration?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "title" | "tone">> {
	id: number;
	description?: string;
}

const MAX_VISIBLE = 4;
const toasts = createStore<readonly ToastItem[]>([]);
let nextId = 1;

function dismiss(id: number) {
	toasts.set((list) => list.filter((item) => item.id !== id));
}

export function toast(options: ToastOptions): void {
	const id = nextId++;
	const duration = options.duration ?? (options.tone === "red" ? 8000 : 4000);
	toasts.set((list) =>
		[
			...list,
			{
				id,
				title: options.title,
				description: options.description,
				tone: options.tone ?? "grey",
			},
		].slice(-MAX_VISIBLE),
	);
	if (duration > 0) setTimeout(() => dismiss(id), duration);
}

export function ToastViewport() {
	const list = useStore(toasts);
	return (
		<div
			aria-live="polite"
			className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 md:items-end md:p-6"
		>
			{list.map((item) => (
				<div
					key={item.id}
					data-tone={item.tone}
					role="status"
					className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-cell border border-line bg-surface p-3 shadow-menu"
				>
					<span className="mt-1.5 size-2 shrink-0 rounded-full bg-(--tone)" />
					<div className="min-w-0 flex-1">
						<div className="text-sm font-semibold">{item.title}</div>
						{item.description && (
							<div className="mt-0.5 text-sm text-subtle">
								{item.description}
							</div>
						)}
					</div>
					<button
						type="button"
						aria-label="Zamknij powiadomienie"
						onClick={() => dismiss(item.id)}
						className="-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-control text-lg text-muted hover:bg-hover hover:text-ink"
					>
						×
					</button>
				</div>
			))}
		</div>
	);
}
