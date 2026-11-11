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
import { Button } from "./Button";
import { borderFor, controlClass, Field } from "./Field";
import { Popover } from "./Popover";

// The panel's one way to enter a date. Two fields share it:
//
//   DateField       a calendar day ("YYYY-MM-DD")
//   DateTimeField   a moment, edited in local time and stored as UTC
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

/** A date and time, edited in local time and stored as UTC. */
export function DateTimeField({
	value,
	onChange,
	stepMinutes = 15,
	defaultTime = "13:00",
	...common
}: DateTimeFieldProps) {
	const day = dayOfInstant(value);
	const time = timeOfInstant(value) ?? defaultTime;
	return (
		<DateControl
			{...common}
			day={day}
			text={formatDateTimeText(value)}
			placeholder="DD.MM.RRRR GG:MM"
			mistake="Wpisz datę jako DD.MM.RRRR GG:MM"
			parse={(text) => {
				const typed = parseDateTimeText(text);
				return typed ? instantAt(typed.day, typed.time ?? time) : null;
			}}
			onCommit={onChange}
			onPickDay={(picked) => {
				onChange(instantAt(picked, time));
				// Stays open: the time is set in the same panel.
				return "stay";
			}}
			footer={
				<TimeInput
					// A new day or a new time from outside starts the input afresh.
					key={`${day}-${time}`}
					time={time}
					disabled={!day}
					stepMinutes={stepMinutes}
					onChange={(next) => {
						if (day) onChange(instantAt(day, next));
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
	/** Shown when what was typed is not a date. */
	mistake: string;
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
		<Field label={label} hint={hint} error={mistaken ? mistake : error}>
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
	time: Time;
	disabled: boolean;
	stepMinutes: number;
	onChange: (time: Time) => void;
}

/** The time of day under the calendar: typed, or stepped with the arrow keys. */
function TimeInput({ time, disabled, stepMinutes, onChange }: TimeInputProps) {
	const [draft, setDraft] = useState<string | null>(null);
	const typed = draft === null ? time : parseTimeText(draft);

	const commit = () => {
		if (draft === null) return;
		setDraft(null);
		if (typed && typed !== time) onChange(typed);
	};

	return (
		<label className="flex flex-col gap-1 text-xs font-semibold">
			Godzina
			<input
				type="text"
				inputMode="numeric"
				autoComplete="off"
				placeholder="GG:MM"
				title={disabled ? "Najpierw wybierz dzień" : undefined}
				value={draft ?? time}
				onChange={(event) => setDraft(event.target.value)}
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
					if (step !== 0 && typed) {
						event.preventDefault();
						setDraft(null);
						onChange(shiftTime(typed, step));
					}
				}}
				disabled={disabled}
				aria-invalid={typed === null || undefined}
				className={`h-9 w-24 text-center font-normal tabular-nums ${controlClass} ${borderFor(typed === null)}`}
			/>
		</label>
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
