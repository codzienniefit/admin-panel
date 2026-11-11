import { useLiveQuery } from "@tanstack/react-db";
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
import { MediaImage } from "@/features/media/MediaImage";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { levelMeta, STATUS_META, trainingTypeMeta } from "@/ui/enums";
import { ListPage, SearchInput } from "@/ui/ListPage";
import { Select, type SelectOption } from "@/ui/Select";
import { StatusBadge } from "@/ui/StatusBadge";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";

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

	// Every workout that matches, never a first page of them: what the filters
	// find is what is on screen.
	const workouts = filterWorkouts(data ?? [], filters);
	const equipmentTitle = new Map(
		config.equipmentTypes.map((item) => [item.id, item.title]),
	);
	const change = onFiltersChange;
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
					<MediaImage
						path={workout.imageRelativePath}
						className="h-10 w-15 shrink-0 rounded-chip"
						imageClassName="bg-hover object-cover"
					/>
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
		<ListPage
			title="Treningi"
			action={
				<Button variant="primary" size="md" onClick={onCreate}>
					Nowy trening
				</Button>
			}
			loading={isLoading}
			summary={
				filters.status === "deleted"
					? `${workouts.length} w koszu`
					: plural(workouts.length, "trening", "treningi", "treningów")
			}
			filters={
				<>
					<SearchInput
						label="Szukaj treningu"
						placeholder="Szukaj po nazwie, komentarzu lub ID…"
						value={filters.q ?? ""}
						onChange={(q) => change({ q: q || undefined })}
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
				</>
			}
		>
			<Table
				columns={columns}
				rows={workouts}
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
		</ListPage>
	);
}
