import type { ReactNode } from "react";
import { plural } from "@/domain/text";
import type { WeekResult } from "@/domain/weekValidation";
import { Popover } from "@/ui/Popover";
import type { Tone } from "@/ui/tones";

interface WeekSectionProps {
	number: number;
	workouts: number;
	minutes: number;
	result: WeekResult;
	/** Hidden on a phone, where one week shows at a time. */
	hiddenOnPhone: boolean;
	children: ReactNode;
}

const FRAME: Record<WeekResult["state"], { tone?: Tone; className: string }> = {
	valid: { tone: "green", className: "border-(--tone) bg-(--tone-soft)/40" },
	invalid: { tone: "red", className: "border-(--tone) bg-(--tone-soft)/40" },
	neutral: { className: "border-line bg-surface" },
};

/** One week of the plan, framed green or red by the plan type's rules. */
export function WeekSection({
	number,
	workouts,
	minutes,
	result,
	hiddenOnPhone,
	children,
}: WeekSectionProps) {
	const failed = result.results.filter((r) => !r.pass).length;
	return (
		<section
			aria-label={`Tydzień ${number}`}
			data-tone={FRAME[result.state].tone}
			className={`rounded-card border p-3 md:p-4 ${FRAME[result.state].className} ${hiddenOnPhone ? "max-md:hidden" : ""}`}
		>
			<header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 px-0.5">
				<h3 className="text-lg font-semibold">Tydzień {number}</h3>
				<span className="text-sm text-muted">
					{plural(workouts, "trening", "treningi", "treningów")}
					{minutes > 0 ? ` · ${minutes} min` : ""}
				</span>
				{result.state !== "neutral" && (
					<Popover
						label={`Wymagania tygodnia ${number}`}
						title="Wymagania rodzaju planu"
						align="end"
						trigger={
							<span
								data-tone={result.state === "valid" ? "green" : "red"}
								className="inline-flex items-center gap-1 rounded-full bg-(--tone-soft) px-2.5 py-0.5 text-xs font-semibold text-(--tone-ink)"
							>
								{result.state === "valid"
									? "✓ Spełnia wymagania"
									: `⚠ ${plural(failed, "wymaganie niespełnione", "wymagania niespełnione", "wymagań niespełnionych")}`}
							</span>
						}
						triggerClassName="ml-auto rounded-full"
					>
						<ul className="flex flex-col gap-1.5">
							{result.results.map((item) => (
								<li key={item.label} className="flex items-start gap-2">
									<span
										aria-hidden="true"
										data-tone={item.pass ? "green" : "red"}
										className="font-semibold text-(--tone-ink)"
									>
										{item.pass ? "✓" : "✗"}
									</span>
									<span>
										{item.label}
										<span className="sr-only">
											{item.pass ? " (spełnione)" : " (niespełnione)"}
										</span>
									</span>
								</li>
							))}
						</ul>
					</Popover>
				)}
			</header>
			<div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
				{children}
			</div>
		</section>
	);
}
