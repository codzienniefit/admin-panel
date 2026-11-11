import { useForm } from "react-hook-form";
import type { UserSummary } from "@/data/schemas/user";
import { formatDate } from "@/domain/dates";
import { plural } from "@/domain/text";
import {
	isSearchable,
	searchQueryProblem,
	USER_QUERY_MIN,
} from "@/domain/userRules";
import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";
import { TextField } from "@/ui/Field";
import { Loading, useDelayedLoading } from "@/ui/Loading";
import { Notice } from "@/ui/Notice";
import { type Column, Table } from "@/ui/Table";
import { AccountTags } from "./AccountTags";
import { personName, providerLabel } from "./userMeta";
import { useUserSearch } from "./useUsers";

interface UsersPageProps {
	/** The query in the address; empty before the first search. */
	query: string;
	onSearch: (query: string) => void;
	onOpen: (uid: string) => void;
}

/**
 * Looking a person up. There is no list of everyone: the panel shows only
 * what a search of at least three characters returns.
 */
export function UsersPage({ query, onSearch, onOpen }: UsersPageProps) {
	return (
		<div className="mx-auto flex max-w-[1400px] flex-col gap-4">
			<h1 className="text-3xl font-semibold tracking-tight">Użytkownicy</h1>
			{/* A query that arrives with the address starts a fresh form. */}
			<SearchForm key={query} query={query} onSearch={onSearch} />
			<SearchResults query={query} onOpen={onOpen} />
		</div>
	);
}

function SearchForm({
	query,
	onSearch,
}: Pick<UsersPageProps, "query" | "onSearch">) {
	const form = useForm<{ q: string }>({ defaultValues: { q: query } });

	const submit = () => {
		form.clearErrors();
		const text = form.getValues("q").trim();
		const problem = searchQueryProblem(text);
		if (problem) {
			form.setError("q", { message: problem }, { shouldFocus: true });
			return;
		}
		onSearch(text);
	};

	return (
		<form
			// Our own message, next to the field, instead of the browser's.
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			className="flex flex-col gap-2 sm:flex-row sm:items-start"
		>
			<div className="min-w-0 flex-1 sm:max-w-xl">
				<TextField
					label="Kogo szukasz?"
					type="search"
					placeholder="Adres e-mail, imię i nazwisko albo identyfikator"
					hint={`Co najmniej ${USER_QUERY_MIN} znaki. Wyszukiwanie zaczyna się po kliknięciu „Szukaj”.`}
					error={form.formState.errors.q?.message}
					autoComplete="off"
					spellCheck={false}
					{...form.register("q")}
				/>
			</div>
			{/* Lines the buttons up with the field, below its label. */}
			<div className="flex gap-2 sm:pt-[1.625rem]">
				<Button type="submit" variant="primary" size="md" className="h-10">
					Szukaj
				</Button>
				{query && (
					<Button size="md" className="h-10" onClick={() => onSearch("")}>
						Wyczyść
					</Button>
				)}
			</div>
		</form>
	);
}

function SearchResults({
	query,
	onOpen,
}: Pick<UsersPageProps, "query" | "onOpen">) {
	const search = useUserSearch(query);
	const showLoading = useDelayedLoading(search.isLoading);

	if (!query) {
		return (
			<EmptyState title="Znajdź użytkownika">
				Wpisz fragment adresu e-mail, imienia i nazwiska albo identyfikator
				konta. Listy wszystkich użytkowników tu nie ma: to dane osobowe, więc
				panel pokazuje tylko to, czego szukasz.
			</EmptyState>
		);
	}
	if (!isSearchable(query)) {
		return (
			<EmptyState title="Za krótkie zapytanie">
				{searchQueryProblem(query)}, żeby wyszukać.
			</EmptyState>
		);
	}
	if (search.isLoading) {
		return showLoading ? (
			<div className="flex flex-col gap-2">
				{[1, 2, 3, 4].map((n) => (
					<Loading key={n} />
				))}
			</div>
		) : null;
	}
	if (search.isError || !search.data) {
		return (
			<Notice
				tone="red"
				role="alert"
				title="Nie udało się wyszukać"
				actions={
					<Button onClick={() => void search.refetch()}>
						Spróbuj ponownie
					</Button>
				}
			>
				Sprawdź połączenie i spróbuj jeszcze raz.
			</Notice>
		);
	}

	const { users, totalMatches, truncated } = search.data;

	const columns: Column<UserSummary>[] = [
		{
			key: "person",
			header: "Osoba",
			primary: true,
			cell: (user) => (
				<span className="block min-w-0">
					<span className="block [overflow-wrap:anywhere]">
						{personName(user)}
					</span>
					{user.displayName && user.email && (
						<span className="block text-xs font-normal text-muted [overflow-wrap:anywhere]">
							{user.email}
						</span>
					)}
				</span>
			),
		},
		{
			key: "state",
			header: "Konto",
			cell: (user) => (
				<AccountTags
					user={user}
					fallback={<span className="text-subtle">Aktywne</span>}
				/>
			),
		},
		{
			key: "providers",
			header: "Logowanie",
			cell: (user) => (
				<span className="text-subtle">
					{user.providers.map(providerLabel).join(", ") || "—"}
				</span>
			),
		},
		{
			key: "uid",
			header: "Identyfikator",
			cell: (user) => (
				<span className="font-mono text-xs text-subtle [overflow-wrap:anywhere]">
					{user.uid}
				</span>
			),
		},
		{
			key: "lastSignIn",
			header: "Ostatnie logowanie",
			align: "end",
			cell: (user) => (
				<span className="text-subtle">{formatDate(user.lastSignInAtUtc)}</span>
			),
		},
	];

	return (
		<>
			<p className="text-xs text-muted">
				{truncated
					? `Pokazano ${users.length} z ${totalMatches} pasujących kont`
					: plural(users.length, "konto", "konta", "kont")}
			</p>
			{truncated && (
				<Notice tone="amber" title="To nie wszystkie wyniki">
					Panel pokazuje najwyżej {users.length} kont naraz. Wpisz dłuższy
					fragment adresu albo pełne imię i nazwisko, żeby zawęzić wyniki.
				</Notice>
			)}
			<Table
				columns={columns}
				rows={users}
				rowKey={(user) => user.uid}
				onRowClick={(user) => onOpen(user.uid)}
				empty={
					<EmptyState title="Nikogo nie znaleziono">
						Sprawdź pisownię albo wpisz inny fragment: początek adresu e-mail,
						samo nazwisko lub cały identyfikator konta.
					</EmptyState>
				}
			/>
		</>
	);
}
