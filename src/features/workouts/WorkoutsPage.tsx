import { useLiveQuery } from "@tanstack/react-db";
import { useState } from "react";
import { mediaUrl } from "@/data/collections/media";
import { workoutsCollection } from "@/data/collections/workouts";
import type { ContentStatus } from "@/data/schemas/challenge";
import type { Workout } from "@/data/schemas/workout";
import { formatDate } from "@/domain/dates";
import { plural } from "@/domain/text";
import {
	filterWorkouts,
	type WorkoutFilters,
	type WorkoutSort,
} from "@/domain/workoutFilters";
import { useConfig } from "@/features/config/useConfig";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta, STATUS_META, trainingTypeMeta } from "@/ui/enums";
import { Select, type SelectOption } from "@/ui/Select";
import { Skeleton, useDelayedLoading } from "@/ui/Skeleton";
import { StatusBadge } from "@/ui/StatusBadge";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";

const PAGE = 50;

const STATUS_OPTIONS: SelectOption<ContentStatus>[] = (
	["draft", "published", "hidden", "deleted"] as const
).map((status) => ({
	value: status,
	label: status === "deleted" ? "Kosz" : STATUS_META[status].label,
	tone: STATUS_META[status].tone,
}));

const SORT_OPTIONS: SelectOption<WorkoutSort>[] = [
	{ value: "added", label: "Najnowsze" },
	{ value: "updated", label: "Ostatnio zmieniane" },
	{ value: "title", label: "Nazwa A–Z" },
];

interface WorkoutsPageProps {
	filters: WorkoutFilters;
	onFiltersChange: (patch: Partial<WorkoutFilters>) => void;
	onOpen: (workoutId: string) => void;
	onCreate: () => void;
}

export function WorkoutsPage({
	filters,
	onFiltersChange,
	onOpen,
	onCreate,
}: WorkoutsPageProps) {
	const config = useConfig().workouts;
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ workout: workoutsCollection }),
	});
	const showSkeleton = useDelayedLoading(isLoading);
	const [limit, setLimit] = useState(PAGE);

	const workouts = filterWorkouts(data ?? [], filters);
	const shown = workouts.slice(0, limit);
	const equipmentTitle = new Map(
		config.equipmentTypes.map((item) => [item.id, item.title]),
	);
	const change = (patch: Partial<WorkoutFilters>) => {
		setLimit(PAGE);
		onFiltersChange(patch);
	};
	const filtered = Boolean(
		filters.q || filters.status || filters.type || filters.level,
	);

	const columns: Column<Workout>[] = [
		{
			key: "title",
			header: "Nazwa",
			primary: true,
			cell: (workout) => (
				<span className="flex items-center gap-3">
					{workout.imageRelativePath ? (
						<img
							src={mediaUrl(workout.imageRelativePath)}
							alt=""
							loading="lazy"
							className="h-10 w-15 shrink-0 rounded-chip bg-hover object-cover"
						/>
					) : (
						<span className="h-10 w-15 shrink-0 rounded-chip border border-line-input border-dashed" />
					)}
					<span className="min-w-0">
						<span className="block truncate">
							{workout.title || "Bez nazwy"}
						</span>
						<span className="block truncate text-xs font-normal text-muted">
							{workout.id}
							{workout.internalTitle ? ` · ${workout.internalTitle}` : ""}
						</span>
					</span>
				</span>
			),
		},
		{
			key: "status",
			header: "Status",
			cell: (workout) => (
				<span className="flex flex-wrap gap-1">
					<StatusBadge status={workout.status} />
					{workout.pro && <Tag tone="indigo">Pro</Tag>}
					{workout.liveAtUtc && <Tag tone="red">LIVE</Tag>}
					{workout.availableAtUtc && <Tag tone="orange">PREMIERA</Tag>}
				</span>
			),
		},
		{
			key: "level",
			header: "Poziom",
			cell: (workout) => {
				if (!workout.levelId) return <span className="text-muted">—</span>;
				const level = levelMeta(workout.levelId);
				return <Tag tone={level.tone}>{level.label}</Tag>;
			},
		},
		{
			key: "types",
			header: "Typ",
			cell: (workout) => (
				<span className="flex flex-wrap gap-1">
					{workout.trainingTypeIds.map((id) => {
						const type = trainingTypeMeta(id);
						return (
							<Tag key={id} tone={type.tone}>
								{type.label}
							</Tag>
						);
					})}
				</span>
			),
		},
		{
			key: "equipment",
			header: "Sprzęt",
			cell: (workout) => (
				<span className="text-subtle">
					{workout.equipmentIds
						.map((id) => equipmentTitle.get(id) ?? id)
						.join(", ") || "—"}
				</span>
			),
		},
		{
			key: "duration",
			header: "Czas",
			align: "end",
			cell: (workout) => `${workout.durationMinutes} min`,
		},
		{
			key: "updated",
			header: "Zmieniono",
			align: "end",
			cell: (workout) => (
				<span className="text-subtle">{formatDate(workout.updatedAtUtc)}</span>
			),
		},
	];

	return (
		<div className="mx-auto max-w-[1400px]">
			<header className="mb-5 flex flex-wrap items-center justify-between gap-3">
				<h1 className="text-3xl font-semibold tracking-tight">Treningi</h1>
				<Button variant="primary" size="md" onClick={onCreate}>
					Nowy trening
				</Button>
			</header>

			<div className="mb-3 flex flex-wrap gap-2">
				<input
					type="search"
					aria-label="Szukaj treningu"
					placeholder="Szukaj po nazwie, komentarzu lub ID…"
					value={filters.q ?? ""}
					onChange={(event) => change({ q: event.target.value || undefined })}
					className="h-10 min-w-56 flex-[2] rounded-control border border-line-input bg-surface px-3 text-sm outline-none placeholder:text-muted hover:border-primary focus:border-primary focus:shadow-focus any-pointer-coarse:text-base"
				/>
				<Select
					label="Status"
					placeholder="Status: aktywne"
					options={STATUS_OPTIONS}
					value={filters.status ?? null}
					onChange={(status) => change({ status: status ?? undefined })}
					clearable
					className="min-w-40 flex-1"
				/>
				<Select
					label="Typ treningu"
					placeholder="Typ: wszystkie"
					options={config.trainingTypes.map((type) => ({
						value: type.id,
						label: type.title,
						tone: trainingTypeMeta(type.id).tone,
					}))}
					value={filters.type ?? null}
					onChange={(type) => change({ type: type ?? undefined })}
					clearable
					className="min-w-40 flex-1"
				/>
				<Select
					label="Poziom"
					placeholder="Poziom: wszystkie"
					options={config.trainingLevels.map((level) => ({
						value: level.id,
						label: level.title,
						tone: levelMeta(level.id).tone,
					}))}
					value={filters.level ?? null}
					onChange={(level) => change({ level: level ?? undefined })}
					clearable
					className="min-w-40 flex-1"
				/>
				<Select
					label="Kolejność"
					options={SORT_OPTIONS}
					value={filters.sort ?? "added"}
					onChange={(sort) => change({ sort: sort ?? undefined })}
					className="min-w-40 flex-1"
				/>
			</div>

			<p className="mb-3 text-xs text-muted">
				{isLoading
					? "Wczytywanie…"
					: filters.status === "deleted"
						? `${workouts.length} w koszu`
						: plural(workouts.length, "trening", "treningi", "treningów")}
			</p>

			{isLoading ? (
				showSkeleton && (
					<div className="flex flex-col gap-2">
						{[1, 2, 3, 4, 5, 6].map((n) => (
							<Skeleton key={n} className="h-14" />
						))}
					</div>
				)
			) : (
				<Table
					columns={columns}
					rows={shown}
					rowKey={(workout) => workout.id}
					onRowClick={(workout) => onOpen(workout.id)}
					empty={
						<EmptyState
							title={filtered ? "Nic nie pasuje do filtrów" : "Brak treningów"}
							action={
								filtered ? (
									<Button
										onClick={() =>
											change({
												q: undefined,
												status: undefined,
												type: undefined,
												level: undefined,
											})
										}
									>
										Wyczyść filtry
									</Button>
								) : (
									<Button variant="primary" onClick={onCreate}>
										Nowy trening
									</Button>
								)
							}
						>
							{filtered
								? "Zmień wyszukiwanie albo wyczyść filtry."
								: "Dodaj pierwszy trening, żeby móc układać plany."}
						</EmptyState>
					}
				/>
			)}

			{workouts.length > shown.length && (
				<div className="mt-4 flex justify-center">
					<Button onClick={() => setLimit(limit + PAGE)}>
						Pokaż kolejne ({workouts.length - shown.length} pozostało)
					</Button>
				</div>
			)}
		</div>
	);
}
