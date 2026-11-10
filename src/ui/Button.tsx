import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
	variant?: ButtonVariant;
	size?: ButtonSize;
}

const VARIANTS: Record<ButtonVariant, string> = {
	primary:
		"bg-primary text-white hover:bg-primary-hover disabled:hover:bg-primary",
	secondary:
		"border border-line-input bg-surface text-ink hover:border-primary hover:text-primary disabled:hover:border-line-input disabled:hover:text-ink",
	ghost:
		"text-subtle hover:bg-hover hover:text-ink disabled:hover:bg-transparent",
	danger: "bg-danger text-white hover:brightness-95",
};

const SIZES: Record<ButtonSize, string> = {
	sm: "px-3 py-1.5 text-sm",
	md: "px-4 py-2 text-sm",
};

export function Button({
	variant = "secondary",
	size = "sm",
	className = "",
	type = "button",
	...rest
}: ButtonProps) {
	return (
		<button
			type={type}
			className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
			{...rest}
		/>
	);
}
