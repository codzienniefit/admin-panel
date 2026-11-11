import { describe, expect, it } from "vitest";
import { ApiError } from "@/data/api/errors";
import { attempt, whileBusy } from "./tasks";

describe("attempt", () => {
	it("hands back the value of a task that worked", async () => {
		expect(await attempt(async () => "Zapisano")).toEqual({
			ok: true,
			value: "Zapisano",
		});
	});

	it("hands back a value that is nothing", async () => {
		expect(await attempt(async () => undefined)).toEqual({
			ok: true,
			value: undefined,
		});
	});

	it("hands back the very error of a task that failed", async () => {
		const refusal = new ApiError("validation", "Nazwa jest wymagana");
		const result = await attempt(async () => {
			throw refusal;
		});
		expect(result.ok).toBe(false);
		if (result.ok) throw new Error("the task should have failed");
		expect(result.error).toBe(refusal);
	});

	it("does not throw for a task that throws before its first await", async () => {
		const task = (): Promise<number> => {
			throw new Error("Brak połączenia");
		};
		await expect(attempt(task)).resolves.toMatchObject({
			ok: false,
			error: { message: "Brak połączenia" },
		});
	});

	it("hands back whatever was thrown, error or not", async () => {
		expect(await attempt(() => Promise.reject("po prostu tekst"))).toEqual({
			ok: false,
			error: "po prostu tekst",
		});
	});
});

describe("whileBusy", () => {
	it("raises the flag for as long as the task runs", async () => {
		const flags: boolean[] = [];
		let busyInside: boolean | undefined;

		const result = await whileBusy(
			(busy) => flags.push(busy),
			async () => {
				busyInside = flags.at(-1);
				return 28;
			},
		);

		expect(result).toBe(28);
		expect(busyInside).toBe(true);
		expect(flags).toEqual([true, false]);
	});

	it("keeps the flag up until a slow task answers", async () => {
		const flags: boolean[] = [];
		let answer: (value: string) => void = () => {};
		const slow = new Promise<string>((resolve) => {
			answer = resolve;
		});

		const running = whileBusy(
			(busy) => flags.push(busy),
			() => slow,
		);
		await Promise.resolve();
		expect(flags).toEqual([true]);

		answer("gotowe");
		expect(await running).toBe("gotowe");
		expect(flags).toEqual([true, false]);
	});

	it("lowers the flag and lets the error out when the task fails", async () => {
		const flags: boolean[] = [];
		const failure = new ApiError("server", "Serwer nie odpowiada");

		await expect(
			whileBusy(
				(busy) => flags.push(busy),
				async () => {
					throw failure;
				},
			),
		).rejects.toBe(failure);
		expect(flags).toEqual([true, false]);
	});

	it("lowers the flag when the task throws before its first await", async () => {
		const flags: boolean[] = [];
		const task = (): Promise<void> => {
			throw new Error("od razu");
		};
		await expect(whileBusy((busy) => flags.push(busy), task)).rejects.toThrow(
			"od razu",
		);
		expect(flags).toEqual([true, false]);
	});

	it("reads top to bottom together with attempt", async () => {
		const flags: boolean[] = [];
		const saved = await whileBusy(
			(busy) => flags.push(busy),
			() =>
				attempt(async () => {
					throw new ApiError("network", "Brak połączenia");
				}),
		);
		expect(saved).toMatchObject({ ok: false, error: { kind: "network" } });
		expect(flags).toEqual([true, false]);
	});
});
