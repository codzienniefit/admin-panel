import logo from "@/assets/codziennie-fit.svg";

/**
 * The Codziennie Fit logotype. Its name for screen readers is the brand
 * name, so a link or a heading that holds it is called "Codziennie Fit".
 */
export function Logo({ className = "h-5" }: { className?: string }) {
	return (
		<img
			src={logo}
			alt="Codziennie Fit"
			// The file is about ten times wider than tall; the height sets the size.
			className={`w-auto shrink-0 ${className}`}
		/>
	);
}

/** The square "cf" sign, where the full logotype does not fit. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
	return (
		<img
			src="/favicon-192.png"
			alt="Codziennie Fit"
			className={`shrink-0 ${className}`}
		/>
	);
}
