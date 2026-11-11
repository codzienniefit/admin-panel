import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createStore, useStore } from "@/lib/store";

// Loading, the same everywhere: one spinner in the middle of the page, in
// the logo's colours, fading in and out. No grey blocks standing in for tabs
// or content.
//
// A screen says "this part is still loading" by rendering <Loading />. It
// draws nothing itself; while at least one is on screen (or the router is
// loading a page) the overlay mounted in the root route shows the spinner.

const waiting = createStore(0);

/** Marks a part of the screen as still loading. */
export function Loading() {
	useEffect(() => {
		waiting.set((count) => count + 1);
		return () => waiting.set((count) => count - 1);
	}, []);
	return null;
}

/** The ring itself: two arcs in the two colours of the logo. */
export function Spinner({ className = "size-12" }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 48 48"
			aria-hidden="true"
			className={`animate-spin fill-none [animation-duration:0.9s] motion-reduce:[animation-duration:2.4s] ${className}`}
			strokeWidth="5"
			strokeLinecap="round"
		>
			<path d="M24 5a19 19 0 0 1 19 19" className="stroke-brand-pink" />
			<path d="M24 43a19 19 0 0 1-19-19" className="stroke-brand-violet" />
		</svg>
	);
}

/**
 * Mounted once, in the root route. Always there, so that it can fade both
 * ways; it never takes a click. Showing waits a moment, so a load that takes
 * no time does not flash.
 */
export function LoadingOverlay() {
	const marked = useStore(waiting) > 0;
	const navigating = useRouterState({
		select: (state) => state.status === "pending",
	});
	const busy = marked || navigating;
	return (
		<div
			role="status"
			className={`pointer-events-none fixed inset-0 z-[70] flex items-center justify-center transition-opacity duration-300 ease-out ${
				busy ? "opacity-100 delay-150" : "opacity-0"
			}`}
		>
			<Spinner />
			{busy && <span className="sr-only">Wczytywanie…</span>}
		</div>
	);
}

/**
 * Loading rule from docs/PLAN.md §6.8: the loading mark appears only when
 * loading takes longer than `delayMs`, and once shown stays at least `minMs`, so fast
 * responses never flash.
 */
export function useDelayedLoading(
	loading: boolean,
	delayMs = 150,
	minMs = 300,
): boolean {
	const [visible, setVisible] = useState(false);
	const [shownAt, setShownAt] = useState<number | null>(null);

	useEffect(() => {
		if (loading && !visible) {
			const timer = setTimeout(() => {
				setVisible(true);
				setShownAt(Date.now());
			}, delayMs);
			return () => clearTimeout(timer);
		}
		if (!loading && visible) {
			const elapsed = shownAt === null ? minMs : Date.now() - shownAt;
			const timer = setTimeout(
				() => setVisible(false),
				Math.max(0, minMs - elapsed),
			);
			return () => clearTimeout(timer);
		}
	}, [loading, visible, shownAt, delayMs, minMs]);

	return visible;
}
