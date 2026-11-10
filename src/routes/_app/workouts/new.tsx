import { createFileRoute } from "@tanstack/react-router";
import { WorkoutEditor } from "@/features/workouts/WorkoutEditor";

export const Route = createFileRoute("/_app/workouts/new")({
	component: NewWorkoutRoute,
});

function NewWorkoutRoute() {
	const navigate = Route.useNavigate();
	return (
		<WorkoutEditor
			workoutId={null}
			onClose={() => navigate({ to: "/workouts", search: (prev) => prev })}
			onCreated={() => navigate({ to: "/workouts", search: (prev) => prev })}
		/>
	);
}
