import { Data, Effect, Exit, Scope } from "effect";

export class UpdateCommitting extends Data.TaggedError("UpdateCommitting") {}

export function createUpdateJobs() {
	const scope = Scope.makeUnsafe("parallel");
	let activeJobs = 0;
	let committing = false;

	return {
		fork: <A, E>(run: Effect.Effect<A, E>) => Effect.forkIn(run, scope),
		close: Scope.close(scope, Exit.void),
		admit() {
			if (committing) return false;
			activeJobs++;
			return true;
		},
		finish() {
			activeJobs--;
		},
		isIdle: () => activeJobs === 0,
		beginCommit() {
			if (committing || activeJobs > 0) return false;
			committing = true;
			return true;
		},
		cancelCommit() {
			committing = false;
		},
	};
}

export type UpdateJobs = ReturnType<typeof createUpdateJobs>;
