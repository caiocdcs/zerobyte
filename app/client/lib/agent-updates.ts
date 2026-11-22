import { queryOptions } from "@tanstack/react-query";
import { listAgentsQueryKey } from "~/client/api-client/@tanstack/react-query.gen";
import { listAgents, requestAgentUpdate } from "~/client/api-client/sdk.gen";
import type { ListAgentsResponse, RequestAgentUpdateData } from "~/client/api-client/types.gen";

type Agent = ListAgentsResponse[number];

export const organizationAgentsOptions = (organizationId: string) => {
	const [key] = listAgentsQueryKey();

	return queryOptions({
		queryKey: [key, organizationId] as const,
		queryFn: async ({ queryKey: [options], signal }) => {
			const { data, response } = await listAgents({
				...options,
				signal,
				throwOnError: true,
				responseStyle: "fields",
			});
			if (response.headers.get("X-Zerobyte-Organization-Id") !== organizationId) {
				throw new Error("Machines were loaded for a different organization.");
			}

			return data.filter((agent) => agent.kind === "local" || agent.organizationId === organizationId);
		},
	});
};

export const machineRefreshOptions = (organizationId: string) => ({
	...organizationAgentsOptions(organizationId),
	refetchInterval: 5_000,
	refetchIntervalInBackground: false,
});

export class AgentUpdateRequestError extends Error {
	constructor(
		public readonly status: number | undefined,
		message: string,
	) {
		super(message);
	}
}

export async function queueAgentUpdate(path: RequestAgentUpdateData["path"], body: RequestAgentUpdateData["body"]) {
	const { data, error, response } = await requestAgentUpdate({
		path,
		body,
		signal: AbortSignal.timeout(30_000),
		throwOnError: false,
		responseStyle: "fields",
	});
	if (data) return data;

	const status = response?.status;
	let message = "Could not request an agent update. Try again.";
	if (status === 409) message = "The update offer changed. Close this dialog and review the current update.";
	if (
		response &&
		error &&
		typeof error === "object" &&
		"message" in error &&
		typeof error.message === "string" &&
		error.message
	) {
		message = error.message;
	}

	throw new AgentUpdateRequestError(status, message);
}

export const getRemoteUpdateTarget = (update: Agent["update"]) =>
	update.availability !== "none" && update.delivery === "remote" ? update.targetTag : null;

export const getMachineUpdate = (agent: Agent) => {
	if (agent.kind !== "remote" || agent.revokedAt !== null || agent.lastSeenAt === null) return null;

	return agent.update;
};

export const isAgentUpdateActive = (request: Agent["update"]["request"]) =>
	request?.status === "queued" || request?.status === "started";
