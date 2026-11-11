// What can be dragged in the planner and where it can be dropped.

export type DragSource =
	| { kind: "placed"; dayIndex: number; index: number; workoutId: string }
	| { kind: "scratch"; workoutId: string }
	| { kind: "note"; dayIndex: number };

export type DropTarget =
	| { kind: "day"; dayIndex: number }
	| { kind: "scratchpad" };

export const dayDropId = (dayIndex: number) => `day-${dayIndex}`;
export const SCRATCHPAD_DROP_ID = "scratchpad";
