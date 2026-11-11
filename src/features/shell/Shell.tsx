import { Link, Outlet } from "@tanstack/react-router";
import { currentEnvironment, ENVIRONMENTS } from "@/data/environment";
import { CallLogButton } from "@/features/devtools/CallLog";
import { EnvironmentSelect } from "@/ui/EnvironmentSelect";
import { Logo, LogoMark } from "@/ui/Logo";
import { Tag } from "@/ui/Tag";
import { UserMenu } from "./UserMenu";

const SECTIONS = [
	{ to: "/challenges", label: "Wyzwania", exact: false },
	{ to: "/workouts", label: "Treningi", exact: false },
	{ to: "/media", label: "Media", exact: false },
	{ to: "/messages", label: "Wiadomości", exact: false },
	{ to: "/badges", label: "Odznaki", exact: false },
	{ to: "/users", label: "Użytkownicy", exact: false },
	{ to: "/settings", label: "Ustawienia", exact: false },
] as const;

// Not sections of the product: tools for building and checking it.
const TOOLS = [{ to: "/design", label: "Komponenty" }] as const;

const tab =
	"shrink-0 rounded-control px-3 py-1.5 text-sm text-subtle hover:bg-hover hover:text-ink";
const tabActive = {
	className: "bg-primary-soft text-primary hover:bg-primary-soft",
};

function TopBar({ children }: { children?: React.ReactNode }) {
	const environment = ENVIRONMENTS.find(
		(e) => e.value === currentEnvironment(),
	);
	return (
		<header className="sticky top-0 z-40 border-line border-b bg-surface/90 backdrop-blur">
			<div className="flex h-14 items-center gap-3 px-4 md:gap-5 md:px-6">
				<Link to="/challenges" className="shrink-0">
					{/* The full logotype needs room; a phone gets the sign. */}
					<Logo className="hidden h-5 md:block" />
					<LogoMark className="size-7 md:hidden" />
				</Link>
				{children}
				<CallLogButton />
				{/* The dropdown needs room; narrow screens get a plain label. */}
				<div className="hidden shrink-0 lg:block">
					<EnvironmentSelect />
				</div>
				{environment && (
					<div className="shrink-0 lg:hidden">
						<Tag tone={environment.tone}>{environment.label}</Tag>
					</div>
				)}
				<UserMenu />
			</div>
		</header>
	);
}

/** The frame around every screen behind sign-in. */
export function Shell() {
	return (
		<div className="flex min-h-full flex-col">
			<TopBar>
				<nav
					aria-label="Główne"
					className="scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
				>
					{SECTIONS.map((section) => (
						<Link
							key={section.to}
							to={section.to}
							className={tab}
							activeProps={tabActive}
							activeOptions={{ exact: section.exact }}
						>
							{section.label}
						</Link>
					))}
					<span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden="true" />
					{TOOLS.map((tool) => (
						<Link
							key={tool.to}
							to={tool.to}
							className={tab}
							activeProps={tabActive}
						>
							{tool.label}
						</Link>
					))}
				</nav>
			</TopBar>
			<main className="flex-1 p-4 md:p-6">
				<Outlet />
			</main>
		</div>
	);
}
