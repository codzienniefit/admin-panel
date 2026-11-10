import { useState } from "react";
import { auth, signOutAndLeave } from "@/auth";
import { currentEnvironment } from "@/data/environment";
import { SampleDataDialog } from "@/features/devtools/SampleDataDialog";
import { useStore } from "@/lib/store";
import { Menu, type MenuAction } from "@/ui/Menu";

function initials(name: string): string {
	return name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase();
}

/** Who is signed in, the Test environment's data controls, and the way out. */
export function UserMenu() {
	const session = useStore(auth.session);
	const [sampleDataOpen, setSampleDataOpen] = useState(false);
	if (session.status !== "admin" && session.status !== "forbidden") return null;
	const { user } = session;

	const actions: MenuAction[] = [];
	if (currentEnvironment() === "test") {
		actions.push({
			label: "Dane testowe…",
			onSelect: () => setSampleDataOpen(true),
		});
	}
	actions.push({
		label: "Wyloguj",
		destructive: true,
		onSelect: () => void signOutAndLeave(),
	});

	return (
		<>
			<Menu
				label={`Konto: ${user.displayName}`}
				triggerClassName="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary hover:bg-primary hover:text-white data-popup-open:bg-primary data-popup-open:text-white"
				trigger={initials(user.displayName)}
				header={
					<>
						<div className="text-sm font-semibold">{user.displayName}</div>
						{user.email && (
							<div className="text-xs text-muted">{user.email}</div>
						)}
					</>
				}
				actions={actions}
			/>
			<SampleDataDialog
				open={sampleDataOpen}
				onOpenChange={setSampleDataOpen}
			/>
		</>
	);
}
