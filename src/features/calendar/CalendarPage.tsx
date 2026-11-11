import { useState } from "react";
import type { Challenge } from "@/data/schemas/challenge";
import {
	addDays,
	type Day,
	formatDay,
	formatDayFull,
	monthLabel,
	today,
} from "@/domain/calendarDates";
import {
	calendarField,
	calendarStart,
	toCalendarItem,
	withCalendarDay,
} from "@/domain/calendarItems";
import {
	type DatedItem,
	lastDay,
	splitItems,
} from "@/domain/challengeCalendar";
import { challengeKind, KIND_LABELS } from "@/domain/challengeRules";
import { KIND_TONES } from "@/features/challenges/ChallengeCard";
import { ChallengesViewSwitch } from "@/features/challenges/ChallengesViewSwitch";
import { applyChallengeChange } from "@/features/challenges/challengeActions";
import { useChallengeRules } from "@/features/challenges/useChallengeRules";
import { usePlanningById } from "@/features/planner/usePlanning";
import { saveOrToast } from "@/features/saving/applyChange";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { confirm } from "@/ui/confirm";
import { DateField } from "@/ui/DateField";
import { Dialog } from "@/ui/Dialog";
import { EmptyState } from "@/ui/EmptyState";
import { Loading } from "@/ui/Loading";
import { Segmented } from "@/ui/Segmented";
import { StatusBadge } from "@/ui/StatusBadge";
import { Tag } from "@/ui/Tag";
import { MonthGrid } from "./MonthGrid";
import { YearGrid } from "./YearGrid";

export type CalendarView = "month" | "year";

interface CalendarPageProps {
	view: CalendarView;
	year: number;
	/** 0 for January. */
	month0: number;
	onChange: (patch: {
		view?: CalendarView;
		year?: number;
		month0?: number;
	}) => void;
	onOpen: (challengeId: string) => void;
}

const FIELD_LABELS = {
	liveAtUtc: "Data premiery",
	availableAtUtc: "Widoczne od",
} as const;

/** Challenges over time: when each one runs, and which ones have no date yet. */
export function CalendarPage({
	view,
	year,
	month0,
	onChange,
	onOpen,
}: CalendarPageProps) {
	const { config, context, challenges, ready } = useChallengeRules();
	const planningById = usePlanningById();
	const [dating, setDating] = useState<Challenge | null>(null);

	const visible = challenges.filter((c) => c.status !== "deleted");
	const byId = new Map(visible.map((c) => [c.id, c]));
	const { dated, undated } = splitItems(
		visible.map((c) =>
			toCalendarItem(c, planningById.get(c.id)?.calendarColor),
		),
	);

	const step = (by: number) => {
		if (view === "year") {
			onChange({ year: year + by });
			return;
		}
		const next = new Date(year, month0 + by, 1);
		onChange({ year: next.getFullYear(), month0: next.getMonth() });
	};
	const goToday = () => {
		const now = new Date();
		onChange({ year: now.getFullYear(), month0: now.getMonth() });
	};

	/** Saves a new calendar day for a challenge; asks first. */
	const moveTo = async (challenge: Challenge, day: Day) => {
		const field = calendarField(challenge);
		const from = calendarStart(challenge)?.day;
		const end = lastDay(day, challenge.lengthDays);
		const sure = await confirm({
			title: `Przenieść „${challenge.title || challenge.id}”?`,
			description: [
				`${FIELD_LABELS[field]}: ${from ? `${formatDayFull(from)} → ` : ""}${formatDayFull(day)}. Koniec: ${formatDayFull(end)}.`,
				challenge.status === "published"
					? "Wyzwanie jest opublikowane: nowa data będzie od razu widoczna w aplikacji."
					: challenge.status === "hidden"
						? "Wyzwanie jest ukryte, ale osoby, które je zaczęły, zobaczą zmianę."
						: "",
			]
				.filter(Boolean)
				.join(" "),
			confirmLabel: "Przenieś",
		});
		if (!sure) return;
		// A held save is shown on the challenge's own page.
		await saveOrToast("Nie można zmienić daty", () =>
			applyChallengeChange(
				challenge,
				(draft) => {
					Object.assign(draft, withCalendarDay(draft, day));
				},
				{
					config,
					context: { ...context, ownId: challenge.id },
					done: "Data zmieniona",
				},
			),
		);
	};

	const onMove = (id: string, deltaDays: number) => {
		const challenge = byId.get(id);
		const from = challenge ? calendarStart(challenge)?.day : undefined;
		if (challenge && from) void moveTo(challenge, addDays(from, deltaDays));
	};

	const monthStart = formatDay(new Date(year, month0, 1));
	const monthEnd = formatDay(new Date(year, month0 + 1, 0));
	const inMonth = dated.filter(
		(item) => item.start <= monthEnd && item.end >= monthStart,
	);

	return (
		<div className="mx-auto flex max-w-[1500px] flex-col gap-4">
			<header className="flex flex-wrap items-center gap-3">
				<h1 className="text-3xl font-semibold tracking-tight">Wyzwania</h1>
				<ChallengesViewSwitch />
			</header>

			<div className="flex flex-wrap items-center gap-2">
				<Button onClick={() => step(-1)} aria-label="Wcześniej">
					‹
				</Button>
				<Button onClick={goToday}>Dziś</Button>
				<Button onClick={() => step(1)} aria-label="Później">
					›
				</Button>
				<h2 className="ml-2 text-xl font-semibold">
					{view === "year" ? year : monthLabel(year, month0)}
				</h2>
				<Segmented
					label="Zakres kalendarza"
					className="ml-auto"
					options={[
						{ value: "month", label: "Miesiąc" },
						{ value: "year", label: "Rok" },
					]}
					value={view}
					onChange={(next) => onChange({ view: next })}
				/>
			</div>

			{!ready ? (
				<Loading />
			) : (
				// One column that may shrink: without it a long title in the lists
				// below makes the whole page wider than a phone.
				<div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
					<div className="min-w-0">
						{view === "year" ? (
							<YearGrid
								year={year}
								dated={dated}
								onOpenMonth={(month) =>
									onChange({ view: "month", month0: month })
								}
							/>
						) : (
							<>
								<div className="max-md:hidden">
									<MonthGrid
										year={year}
										month0={month0}
										dated={dated}
										onOpen={onOpen}
										onMove={onMove}
									/>
									<p className="mt-2 text-xs text-muted">
										Przeciągnij pasek, żeby przenieść wyzwanie. Przed zapisaniem
										panel zapyta o potwierdzenie.
									</p>
								</div>
								{/* On a phone: the month as a list. Dates change in the form. */}
								<div className="md:hidden">
									<MonthList items={inMonth} byId={byId} onOpen={onOpen} />
								</div>
							</>
						)}
					</div>

					<aside>
						<Card className="flex flex-col gap-3">
							<h2 className="text-lg font-semibold">
								Bez daty
								<span className="ml-2 rounded-full bg-hover px-2 py-0.5 text-xs font-normal text-muted">
									{undated.length}
								</span>
							</h2>
							{undated.length === 0 ? (
								<p className="text-sm text-muted">
									Każde wyzwanie ma datę premiery albo „Widoczne od”.
								</p>
							) : (
								<ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto pr-1">
									{undated.map((item) => {
										const challenge = byId.get(item.id);
										if (!challenge) return null;
										const kind = challengeKind(challenge);
										return (
											// Two lines: the name in full, then its kind and the
											// button. On one line the name had no room left.
											<li
												key={item.id}
												className="flex flex-col gap-1.5 rounded-control px-1.5 py-2 hover:bg-hover"
											>
												<div className="flex items-start gap-2">
													<span
														aria-hidden="true"
														className="mt-1.5 size-2.5 shrink-0 rounded-full"
														style={{ backgroundColor: item.color }}
													/>
													<button
														type="button"
														onClick={() => onOpen(item.id)}
														className="min-w-0 flex-1 text-left text-sm [overflow-wrap:anywhere] hover:text-primary"
													>
														{item.title}
													</button>
												</div>
												<div className="flex flex-wrap items-center justify-between gap-2 pl-[18px]">
													<Tag tone={KIND_TONES[kind]}>{KIND_LABELS[kind]}</Tag>
													<Button onClick={() => setDating(challenge)}>
														Ustaw datę
													</Button>
												</div>
											</li>
										);
									})}
								</ul>
							)}
						</Card>
					</aside>
				</div>
			)}

			{dating && (
				<SetDateDialog
					challenge={dating}
					onSave={(day) => void moveTo(dating, day)}
					onClose={() => setDating(null)}
				/>
			)}
		</div>
	);
}

function MonthList({
	items,
	byId,
	onOpen,
}: {
	items: readonly DatedItem[];
	byId: ReadonlyMap<string, Challenge>;
	onOpen: (id: string) => void;
}) {
	if (items.length === 0) {
		return (
			<EmptyState title="Nic w tym miesiącu">
				Żadne wyzwanie nie trwa w tym miesiącu.
			</EmptyState>
		);
	}
	return (
		<ul className="flex flex-col gap-2">
			{items.map((item) => {
				const challenge = byId.get(item.id);
				return (
					<li key={item.id}>
						<button
							type="button"
							onClick={() => onOpen(item.id)}
							className="flex w-full items-center gap-3 rounded-card border border-line bg-surface p-3 text-left"
						>
							<span
								aria-hidden="true"
								className="h-10 w-1.5 shrink-0 rounded-full"
								style={{ backgroundColor: item.color }}
							/>
							<span className="min-w-0 flex-1">
								<span className="block truncate font-semibold">
									{item.title}
								</span>
								<span className="block text-xs text-muted">
									{formatDayFull(item.start)} – {formatDayFull(item.end)}
								</span>
							</span>
							{challenge && <StatusBadge status={challenge.status} />}
						</button>
					</li>
				);
			})}
		</ul>
	);
}

/** Gives an undated challenge its "visible from" date. */
function SetDateDialog({
	challenge,
	onSave,
	onClose,
}: {
	challenge: Challenge;
	onSave: (day: Day) => void;
	onClose: () => void;
}) {
	const [day, setDay] = useState<Day | null>(today());
	return (
		<Dialog
			open
			onClose={onClose}
			title="Ustaw datę"
			description={`„${challenge.title || challenge.id}” dostanie datę „Widoczne od”. Datę premiery ustawia się w zakładce Treść: zmienia ona plan w wyzwanie.`}
			size="sm"
			footer={
				<>
					<Button size="md" onClick={onClose}>
						Anuluj
					</Button>
					<Button
						size="md"
						variant="primary"
						disabled={!day}
						onClick={() => {
							onClose();
							if (day) onSave(day);
						}}
					>
						Dalej
					</Button>
				</>
			}
		>
			<DateField
				label="Widoczne od"
				value={day}
				onChange={setDay}
				hint={
					day
						? `Koniec: ${formatDayFull(lastDay(day, challenge.lengthDays))}`
						: "Wybierz dzień"
				}
			/>
		</Dialog>
	);
}
