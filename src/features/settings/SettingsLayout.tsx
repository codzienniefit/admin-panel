import { Link, Outlet } from "@tanstack/react-router";
import { plannerSettingsSaver } from "@/data/collections/settings";
import { PLANNER_SETTINGS_ID } from "@/data/schemas/settings";
import { HeldEditsNotice } from "@/features/saving/HeldEditsNotice";
import { Page } from "@/ui/Page";
import { tabItem, tabItemActive } from "@/ui/Tabs";

const TABS = [
	{ to: "/settings/plan-types", label: "Rodzaje planów" },
	{ to: "/settings/training-types", label: "Typy treningów" },
	{ to: "/settings/folders", label: "Foldery" },
	{ to: "/settings/app", label: "Aplikacja" },
] as const;

/** Settings of the planner, shared by the whole team, and the app's cache. */
export function SettingsLayout() {
	return (
		<Page
			title="Ustawienia"
			description="Wspólne dla całego zespołu. Rodzaje planów, typy treningów i foldery dotyczą planowania; aplikacja ich nie widzi."
		>
			<div className="flex flex-col gap-4">
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
				<HeldEditsNotice
					saver={plannerSettingsSaver}
					id={PLANNER_SETTINGS_ID}
				/>
				<Outlet />
			</div>
		</Page>
	);
}
