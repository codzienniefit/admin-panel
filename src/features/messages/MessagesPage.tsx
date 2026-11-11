import { useLiveQuery } from "@tanstack/react-db";
import { messagesCollection } from "@/data/collections/messages";
import type { Message, MessageStatus } from "@/data/schemas/message";
import { contentExcerpt } from "@/domain/contentBlocks";
import { formatDateTime } from "@/domain/dates";
import {
	filterMessages,
	type MessageFilters,
	type MessageSort,
} from "@/domain/messageFilters";
import { plural } from "@/domain/text";
import { useConfig } from "@/features/config/useConfig";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { ListPage, SearchInput } from "@/ui/ListPage";
import { Select, type SelectOption } from "@/ui/Select";
import { type Column, Table } from "@/ui/Table";
import { Tag } from "@/ui/Tag";
import {
	MESSAGE_STATUSES,
	messageStatusMeta,
	targetGroupMeta,
} from "./messageMeta";

const SORT_OPTIONS: SelectOption<MessageSort>[] = [
	{ value: "created", label: "Najnowsze" },
	{ value: "sent", label: "Ostatnio wysłane" },
	{ value: "title", label: "Opis A–Z" },
];

interface MessagesPageProps {
	filters: MessageFilters;
	onFiltersChange: (patch: Partial<MessageFilters>) => void;
	onOpen: (messageId: string) => void;
	onCreate: () => void;
}

export function MessagesPage({
	filters,
	onFiltersChange,
	onOpen,
	onCreate,
}: MessagesPageProps) {
	const { draftMessageStates: states, draftMessageTargetGroups: groups } =
		useConfig().internal;
	const { data, isLoading } = useLiveQuery({
		query: (q) => q.from({ message: messagesCollection }),
	});

	const messages = filterMessages(data ?? [], filters);
	const change = onFiltersChange;
	const filtered = Boolean(filters.q || filters.status || filters.group);
	const emptyArchive =
		filters.status === "archived" && !filters.q && !filters.group;

	const statusOptions: SelectOption<MessageStatus>[] = MESSAGE_STATUSES.map(
		(status) => {
			const meta = messageStatusMeta(status, states);
			return {
				value: status,
				label: status === "archived" ? "Archiwum" : meta.label,
				tone: meta.tone,
			};
		},
	);

	const columns: Column<Message>[] = [
		{
			key: "title",
			header: "Opis",
			primary: true,
			cell: (message) => (
				<span className="block min-w-0 max-w-xl">
					<span className="block [overflow-wrap:anywhere]">
						{message.title || "Bez opisu"}
					</span>
					<span className="block truncate text-xs font-normal text-muted">
						{contentExcerpt(message.fancyContent, 90) || "Brak treści"}
					</span>
				</span>
			),
		},
		{
			key: "status",
			header: "Status",
			cell: (message) => {
				const meta = messageStatusMeta(message.status, states);
				return <Tag tone={meta.tone}>{meta.label}</Tag>;
			},
		},
		{
			key: "group",
			header: "Odbiorcy",
			cell: (message) => {
				if (!message.targetGroup) {
					return <span className="text-muted">nie wybrano</span>;
				}
				const meta = targetGroupMeta(message.targetGroup, groups);
				return (
					<Tag tone={meta.tone} variant="dot">
						{meta.label}
					</Tag>
				);
			},
		},
		{
			key: "from",
			header: "Nadawca",
			cell: (message) => (
				<span className="text-subtle [overflow-wrap:anywhere]">
					{message.from || "—"}
				</span>
			),
		},
		{
			key: "created",
			header: "Utworzono",
			align: "end",
			cell: (message) => (
				<span className="text-subtle">
					{formatDateTime(message.createdAtUtc)}
				</span>
			),
		},
		{
			key: "sent",
			header: "Wysłano",
			align: "end",
			cell: (message) => (
				<span className="text-subtle">{formatDateTime(message.sentAtUtc)}</span>
			),
		},
	];

	return (
		<ListPage
			title="Wiadomości"
			action={
				<Button variant="primary" size="md" onClick={onCreate}>
					Nowa wiadomość
				</Button>
			}
			filters={
				<>
					<SearchInput
						label="Szukaj wiadomości"
						placeholder="Szukaj po opisie lub nadawcy…"
						value={filters.q ?? ""}
						onChange={(q) => change({ q: q || undefined })}
					/>
					<Select
						label="Status"
						placeholder="Status: bez archiwum"
						options={statusOptions}
						value={filters.status ?? null}
						onChange={(status) => change({ status: status ?? undefined })}
						clearable
						className="min-w-44 flex-1"
					/>
					<Select
						label="Odbiorcy"
						placeholder="Odbiorcy: wszyscy"
						options={groups.map((group) => ({
							value: group.state,
							label: group.label,
							tone: targetGroupMeta(group.state, groups).tone,
						}))}
						value={filters.group ?? null}
						onChange={(group) => change({ group: group ?? undefined })}
						clearable
						className="min-w-44 flex-1"
					/>
					<Select
						label="Kolejność"
						options={SORT_OPTIONS}
						value={filters.sort ?? "created"}
						onChange={(sort) => change({ sort: sort ?? undefined })}
						className="min-w-44 flex-1"
					/>
				</>
			}
			summary={
				filters.status === "archived"
					? `${messages.length} w archiwum`
					: plural(messages.length, "wiadomość", "wiadomości", "wiadomości")
			}
			loading={isLoading}
		>
			<Table
				columns={columns}
				rows={messages}
				rowKey={(message) => message.id}
				onRowClick={(message) => onOpen(message.id)}
				empty={
					<EmptyState
						title={
							emptyArchive
								? "Archiwum jest puste"
								: filtered
									? "Nic nie pasuje do filtrów"
									: "Brak wiadomości"
						}
						action={
							filtered ? (
								<Button
									onClick={() =>
										change({
											q: undefined,
											status: undefined,
											group: undefined,
										})
									}
								>
									Wyczyść filtry
								</Button>
							) : (
								<Button variant="primary" onClick={onCreate}>
									Nowa wiadomość
								</Button>
							)
						}
					>
						{emptyArchive
							? "Tu trafiają wiadomości przeniesione do archiwum. Wyczyść filtry, żeby wrócić do listy."
							: filtered
								? "Zmień wyszukiwanie albo wyczyść filtry. Zarchiwizowane wiadomości są pod statusem „Archiwum”."
								: "Napisz pierwszą wiadomość. Zapisze się jako robocza i nikt jej nie dostanie, dopóki jej nie wyślesz."}
					</EmptyState>
				}
			/>
		</ListPage>
	);
}
