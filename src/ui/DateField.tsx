import { useState } from "react";
import { DayPicker } from "react-day-picker";
import { pl } from "react-day-picker/locale";
import {
	type Day,
	dayOfInstant,
	formatDateTimeText,
	formatDay,
	formatDayFull,
	holidayNamePL,
	instantAt,
	parseDateTimeText,
	parseDay,
	parseDayText,
	parseTimeText,
	shiftTime,
	type Time,
	timeOfInstant,
	today,
} from "@/domain/calendarDates";
import { polishTimeNote, polishTimeProblem } from "@/domain/polishTime";
import { Button } from "./Button";
import { borderFor, controlClass, Field } from "./Field";
import { Popover } from "./Popover";

// The panel's one way to enter a date. Two fields share it:
//
//   DateField       a calendar day ("YYYY-MM-DD")
//   DateTimeField   a moment, edited in Polish time and stored as UTC
//
// Polish time always (Europe/Warsaw, domain/polishTime.ts), whatever time
// zone the computer is set to. A time the clock skips in March is refused
// with a message; the October hour that happens twice is taken the first
// time, with a note.
//
// A date can be typed ("20.11.2026 10:06") or picked from the calendar; both
// read and write the Polish format, whatever language the browser is in. The
// calendar itself is react-day-picker, dressed in the panel's tokens here and
// nowhere else.

interface CommonProps {
	label: string;
	hint?: string;
	error?: string;
	disabled?: boolean;
}

interface DateFieldProps extends CommonProps {
	/** A local calendar day, or null when empty. */
	value: Day | null;
	onChange: (value: Day | null) => void;
}

interface DateTimeFieldProps extends CommonProps {
	/** UTC ISO string, or null when empty. */
	value: string | null;
	onChange: (value: string | null) => void;
	/** How far the arrow keys move the time. */
	stepMinutes?: number;
	/** The time a day gets when it is picked before any time was set. */
	defaultTime?: Time;
}

/** A calendar day. */
export function DateField({ value, onChange, ...common }: DateFieldProps) {
	return (
		<DateControl
			{...common}
			day={value}
			text={value ? formatDayFull(value) : ""}
			placeholder="DD.MM.RRRR"
			mistake="Wpisz datę jako DD.MM.RRRR"
			parse={(text) => parseDayText(text)}
			onCommit={onChange}
			onPickDay={(day) => {
				onChange(day);
				return "close";
			}}
		/>
	);
}

const DATE_TIME_MISTAKE =
	"Wpisz datę i godzinę jako DD.MM.RRRR GG:MM (czas polski).";

/** A date and time, edited in Polish time and stored as UTC. */
export function DateTimeField({
	value,
	onChange,
	stepMinutes = 15,
	defaultTime = "13:00",
	hint,
	...common
}: DateTimeFieldProps) {
	const day = dayOfInstant(value);
	const time = timeOfInstant(value) ?? defaultTime;
	const note = day ? polishTimeNote(day, time) : null;
	return (
		<DateControl
			{...common}
			hint={[hint, note].filter(Boolean).join(" ") || "Czas polski."}
			day={day}
			text={formatDateTimeText(value)}
			placeholder="DD.MM.RRRR GG:MM"
			mistake={(text) => {
				const typed = parseDateTimeText(text);
				if (!typed) {
					const first = text.trim().split(/[\s,]+/)[0] ?? "";
					// written like a date, but no such day (31.02)
					return /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(first) &&
						!parseDayText(first)
						? `Nie ma takiego dnia: ${first}.`
						: DATE_TIME_MISTAKE;
				}
				return (
					polishTimeProblem(typed.day, typed.time ?? time) ?? DATE_TIME_MISTAKE
				);
			}}
			parse={(text) => {
				const typed = parseDateTimeText(text);
				return typed ? instantAt(typed.day, typed.time ?? time) : null;
			}}
			onCommit={onChange}
			onPickDay={(picked) => {
				// a time the clock skips on the picked day moves an hour on
				const instant =
					instantAt(picked, time) ?? instantAt(picked, shiftTime(time, 60));
				if (instant) onChange(instant);
				// Stays open: the time is set in the same panel.
				return "stay";
			}}
			footer={
				<TimeInput
					// A new day or a new time from outside starts the input afresh.
					key={`${day}-${time}`}
					day={day}
					time={time}
					disabled={!day}
					stepMinutes={stepMinutes}
					onChange={(next) => {
						const instant = day ? instantAt(day, next) : null;
						if (instant) onChange(instant);
					}}
				/>
			}
		/>
	);
}

interface DateControlProps<T> extends CommonProps {
	/** The day shown as selected in the calendar. */
	day: Day | null;
	/** The value as text, in the format people type. */
	text: string;
	placeholder: string;
	/** Shown when what was typed is not a date: the same text, or one made for what was typed. */
	mistake: string | ((text: string) => string);
	parse: (text: string) => T | null;
	onCommit: (value: T | null) => void;
	onPickDay: (day: Day) => "close" | "stay";
	/** Under the calendar: the time, for a date-and-time field. */
	footer?: React.ReactNode;
}

function DateControl<T>({
	label,
	hint,
	error,
	disabled,
	day,
	text,
	placeholder,
	mistake,
	parse,
	onCommit,
	onPickDay,
	footer,
}: DateControlProps<T>) {
	// What is being typed; null while the field just shows its value.
	const [draft, setDraft] = useState<string | null>(null);
	const [mistaken, setMistaken] = useState(false);
	const [open, setOpen] = useState(false);
	// The month on screen; null follows the selected day.
	const [month, setMonth] = useState<Date | null>(null);

	const commitDraft = () => {
		if (draft === null) return;
		if (draft.trim() === "") {
			setDraft(null);
			setMistaken(false);
			if (text) onCommit(null);
			return;
		}
		const parsed = parse(draft);
		if (parsed === null) {
			// Left as typed, so it can be corrected instead of typed again.
			setMistaken(true);
			return;
		}
		setDraft(null);
		setMistaken(false);
		onCommit(parsed);
	};

	const selected = day ? parseDay(day) : undefined;
	const shownMonth = month ?? selected ?? parseDay(today());

	return (
		<Field
			label={label}
			hint={hint}
			error={
				mistaken
					? typeof mistake === "function"
						? mistake(draft ?? "")
						: mistake
					: error
			}
		>
			{({ id, describedBy, invalid }) => (
				<div className="flex gap-2">
					<div className="relative min-w-0 flex-1">
						<input
							id={id}
							type="text"
							inputMode="numeric"
							autoComplete="off"
							placeholder={placeholder}
							value={draft ?? text}
							onChange={(event) => {
								setDraft(event.target.value);
								setMistaken(false);
							}}
							onBlur={commitDraft}
							onKeyDown={(event) => {
								if (event.key === "Enter") {
									// Not the form's submit: Enter here means "this date".
									event.preventDefault();
									commitDraft();
								}
								if (event.key === "ArrowDown" && event.altKey) setOpen(true);
							}}
							disabled={disabled}
							aria-invalid={invalid || undefined}
							aria-describedby={describedBy}
							className={`h-10 pr-11 tabular-nums ${controlClass} ${borderFor(invalid)}`}
						/>
						{!disabled && (
							<div className="absolute inset-y-0 right-1 flex items-center">
								<Popover
									label={`Kalendarz: ${label}`}
									trigger={<CalendarIcon />}
									triggerClassName="flex size-8 items-center justify-center rounded-chip text-muted hover:bg-hover hover:text-ink"
									align="end"
									open={open}
									onOpenChange={(next) => {
										setOpen(next);
										// Opens on the selected day's month every time.
										if (next) setMonth(null);
									}}
								>
									<Calendar
										selected={selected}
										month={shownMonth}
										onMonthChange={setMonth}
										onPick={(picked) => {
											setDraft(null);
											setMistaken(false);
											if (onPickDay(picked) === "close") setOpen(false);
										}}
									/>
									<div className="mt-3 flex flex-wrap items-end gap-2 border-line border-t pt-3">
										{footer}
										<div className="ml-auto flex gap-2">
											<Button
												onClick={() => {
													setMonth(parseDay(today()));
													setDraft(null);
													setMistaken(false);
													if (onPickDay(today()) === "close") setOpen(false);
												}}
											>
												Dziś
											</Button>
											<Button variant="primary" onClick={() => setOpen(false)}>
												Gotowe
											</Button>
										</div>
									</div>
								</Popover>
							</div>
						)}
					</div>
					{text && !disabled && (
						<button
							type="button"
							aria-label={`Wyczyść: ${label}`}
							onClick={() => {
								setDraft(null);
								setMistaken(false);
								onCommit(null);
							}}
							className="flex size-10 shrink-0 items-center justify-center rounded-control border border-line-input text-muted hover:border-primary hover:text-ink"
						>
							×
						</button>
					)}
				</div>
			)}
		</Field>
	);
}

const navButton =
	"flex size-10 cursor-pointer items-center justify-center rounded-control text-subtle outline-none hover:bg-hover hover:text-ink focus-visible:shadow-focus";

// Every class the calendar has. The package's own stylesheet is not loaded.
const CALENDAR_CLASSES = {
	root: "select-none",
	month: "grid grid-cols-[auto_1fr_auto] items-center gap-y-1",
	month_caption: "text-center text-base font-semibold first-letter:uppercase",
	button_previous: navButton,
	button_next: navButton,
	chevron: "size-4 fill-current",
	month_grid: "col-span-3 border-collapse",
	weekday: "size-11 text-center text-xs font-semibold text-muted",
	day: "p-0 text-center",
	day_button:
		"size-11 cursor-pointer rounded-control text-[15px] outline-none hover:bg-hover focus-visible:shadow-focus",
	today: "font-bold text-primary",
	selected:
		"[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-white [&>button]:hover:bg-primary-hover",
	outside: "text-muted opacity-60",
	disabled: "opacity-30",
};

interface CalendarProps {
	selected: Date | undefined;
	month: Date;
	onMonthChange: (month: Date) => void;
	onPick: (day: Day) => void;
}

/** One month, Monday first, with Polish public holidays in red. */
function Calendar({ selected, month, onMonthChange, onPick }: CalendarProps) {
	return (
		<DayPicker
			mode="single"
			required
			locale={pl}
			weekStartsOn={1}
			showOutsideDays
			fixedWeeks
			navLayout="around"
			selected={selected}
			onSelect={(date) => onPick(formatDay(date))}
			month={month}
			onMonthChange={onMonthChange}
			modifiers={{
				holiday: (date) => holidayNamePL(formatDay(date)) !== null,
			}}
			modifiersClassNames={{ holiday: "text-danger" }}
			classNames={CALENDAR_CLASSES}
		/>
	);
}

interface TimeInputProps {
	/** The day the time is on: decides whether the time exists in Poland. */
	day: Day | null;
	time: Time;
	disabled: boolean;
	stepMinutes: number;
	onChange: (time: Time) => void;
}

/** What is wrong with a typed time on this day; null when it can be used. */
function timeProblem(day: Day | null, draft: string): string | null {
	const typed = parseTimeText(draft);
	if (!typed) return "Wpisz godzinę jako GG:MM, od 00:00 do 23:59.";
	return day ? polishTimeProblem(day, typed) : null;
}

/**
 * The time of day under the calendar, in Polish time: typed, or stepped with
 * the arrow keys. A time that cannot be used stays as typed, with the reason
 * under it, and is not saved.
 */
function TimeInput({
	day,
	time,
	disabled,
	stepMinutes,
	onChange,
}: TimeInputProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const [shown, setShown] = useState(false);
	const problem = draft === null ? null : timeProblem(day, draft);

	const commit = () => {
		if (draft === null) return;
		if (problem) {
			setShown(true);
			return;
		}
		const typed = parseTimeText(draft);
		setDraft(null);
		setShown(false);
		if (typed && typed !== time) onChange(typed);
	};

	/** The next time the arrows reach, stepping over an hour the clock skips. */
	const stepFrom = (from: Time, step: number): Time => {
		let next = shiftTime(from, step);
		for (
			let tries = 0;
			tries < 8 && day && polishTimeProblem(day, next);
			tries++
		) {
			next = shiftTime(next, step);
		}
		return next;
	};

	const note = draft === null && day ? polishTimeNote(day, time) : null;
	const message = shown ? problem : null;
	return (
		<div className="flex max-w-64 flex-col gap-1">
			<label className="flex flex-col gap-1 text-xs font-semibold">
				Godzina (czas polski)
				<input
					type="text"
					inputMode="numeric"
					autoComplete="off"
					placeholder="GG:MM"
					title={disabled ? "Najpierw wybierz dzień" : undefined}
					value={draft ?? time}
					onChange={(event) => {
						setDraft(event.target.value);
						setShown(false);
					}}
					onBlur={commit}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							commit();
						}
						const step =
							event.key === "ArrowUp"
								? stepMinutes
								: event.key === "ArrowDown"
									? -stepMinutes
									: 0;
						const from = draft === null ? time : parseTimeText(draft);
						if (step !== 0 && from) {
							event.preventDefault();
							setDraft(null);
							setShown(false);
							onChange(stepFrom(from, step));
						}
					}}
					disabled={disabled}
					aria-invalid={message ? true : undefined}
					className={`h-9 w-24 text-center font-normal tabular-nums ${controlClass} ${borderFor(Boolean(message))}`}
				/>
			</label>
			{message && (
				<p role="alert" className="text-xs text-danger">
					{message}
				</p>
			)}
			{note && <p className="text-xs text-muted">{note}</p>}
		</div>
	);
}

function CalendarIcon() {
	return (
		<svg
			viewBox="0 0 20 20"
			aria-hidden="true"
			className="size-[18px] fill-none stroke-current"
			strokeWidth="1.6"
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			<rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
			<path d="M3 8.5h14M7 3v3M13 3v3" />
		</svg>
	);
}
