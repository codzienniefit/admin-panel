import { api } from "@/data/api";
import type { NewWorkout, Workout } from "@/data/schemas/workout";
import { createVersionedCollection } from "./versioned";

// The single copy of every workout, deleted ones included (the trash is a
// filter, not a separate list).
const workouts = createVersionedCollection<Workout>({
	name: "workouts",
	list: () => api.workouts.list(),
	save: (workout, options) => api.workouts.save(workout, options),
});

export const workoutsCollection = workouts.collection;
export const workoutSaver = workouts.saver;
export const workoutTarget = workouts.target;

export async function createWorkout(input: NewWorkout): Promise<Workout> {
	return workouts.addCreated(await api.workouts.create(input));
}

if (import.meta.hot) {
	import.meta.hot.accept(() => window.location.reload());
}
