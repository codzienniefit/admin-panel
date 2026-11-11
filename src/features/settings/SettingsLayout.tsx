import { Link, Outlet } from "@tanstack/react-router";
import { plannerSettingsSaver } from "@/data/collections/settings";
import { PLANNER_SETTINGS_ID } from "@/data/schemas/settings";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { tabItem, tabItemActive } from "@/ui/Tabs";

const TABS = [
	{ to: "/settings/plan-types", label: "Rodzaje planów" },
	{ to: "/settings/training-types", label: "Typy treningów" },
	{ to: "/settings/folders", label: "Foldery" },
] as const;

/** Settings of the planner, shared by the whole team. */
export function SettingsLayout() {
	return (
		<div className="mx-auto flex max-w-[1100px] flex-col gap-4">
			<h1 className="text-3xl font-semibold tracking-tight">Ustawienia</h1>
			<p className="text-sm text-muted">
				Wspólne dla całego zespołu. Dotyczą planowania; aplikacja ich nie widzi.
			</p>
			<nav aria-label="Ustawienia" className="flex gap-1 overflow-x-auto">
				{TABS.map((tab) => (
					<Link
						key={tab.to}
						to={tab.to}
						className={tabItem}
						activeProps={{ className: tabItemActive }}
					>
						{tab.label}
					</Link>
				))}
			</nav>
			<HeldEditsNotice saver={plannerSettingsSaver} id={PLANNER_SETTINGS_ID} />
			<Outlet />
		</div>
	);
}
