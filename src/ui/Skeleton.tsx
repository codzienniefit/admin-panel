import { useEffect, useState } from "react";

export function Skeleton({ className = "" }: { className?: string }) {
	return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

/**
 * Loading rule from docs/PLAN.md §6.8: a skeleton appears only when loading
 * takes longer than `delayMs`, and once shown stays at least `minMs`, so fast
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
