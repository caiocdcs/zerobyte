import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type RefObject } from "react";
import { toast } from "sonner";
import type { ListAgentsResponse } from "~/client/api-client/types.gen";
import {
	AgentUpdateRequestError,
	getMachineUpdate,
	getRemoteUpdateTarget,
	isAgentUpdateActive,
	organizationAgentsOptions,
	queueAgentUpdate,
} from "~/client/lib/agent-updates";
import { getMachineDisplayName } from "~/lib/machine-name";
import type { ConfirmActionDialogProps } from "./confirm-action-dialog";

type UpdateConfirmation = {
	agentId: string;
	credentialVersion: number;
	machineName: string;
	tag: string;
	open: boolean;
};

export function useMachineUpdateConfirmation(
	organizationId: string,
	agents: ListAgentsResponse,
	connectButtonRef: RefObject<HTMLButtonElement | null>,
) {
	const [confirmation, setConfirmation] = useState<UpdateConfirmation | null>(null);
	const triggerRef = useRef<HTMLButtonElement | null>(null);
	const actionsRef = useRef<RefObject<HTMLButtonElement | null> | null>(null);

	const mutation = useMutation({
		networkMode: "always",
		retry: false,
		mutationFn: ({ agentId, tag, credentialVersion }: UpdateConfirmation) =>
			queueAgentUpdate({ agentId }, { targetTag: tag, credentialVersion }),
		onSuccess: async ({ request }, target, _result, { client }) => {
			if (!request) return;

			const { queryKey } = organizationAgentsOptions(organizationId);
			await client.cancelQueries({ queryKey, exact: true });

			client.setQueryData(queryKey, (current) =>
				current?.map((agent) => {
					if (agent.id !== target.agentId || agent.credentialVersion !== target.credentialVersion)
						return agent;

					const update = getMachineUpdate(agent);
					if (!update || (update.request && update.request.requestedAt >= request.requestedAt)) return agent;

					return { ...agent, update: { ...update, request } };
				}),
			);
		},
	});

	const open = (
		agent: ListAgentsResponse[number],
		tag: string,
		trigger: HTMLButtonElement,
		actions: RefObject<HTMLButtonElement | null>,
	) => {
		mutation.reset();
		triggerRef.current = trigger;
		actionsRef.current = actions;

		setConfirmation({
			agentId: agent.id,
			credentialVersion: agent.credentialVersion,
			machineName: getMachineDisplayName(agent.name),
			tag,
			open: true,
		});
	};

	if (!confirmation) return { open };

	const agent = agents.find((agent) => agent.id === confirmation.agentId);
	const update = agent ? getMachineUpdate(agent) : null;
	const currentTag = update ? getRemoteUpdateTarget(update) : null;
	const sameCredential = !!update && agent?.credentialVersion === confirmation.credentialVersion;
	const offerChanged = !sameCredential || currentTag !== confirmation.tag;

	const status = mutation.error instanceof AgentUpdateRequestError ? mutation.error.status : undefined;
	const conflict = status === 409;
	const verificationUnavailable = status === 503 && sameCredential && currentTag === null;
	const disabled = offerChanged || conflict || isAgentUpdateActive(update?.request ?? null);

	let error = mutation.error?.message ?? null;
	if (offerChanged && !conflict && !verificationUnavailable && !mutation.isPending) {
		error = "The update offer changed. Close this dialog and review the current update.";
	}

	const close = () => setConfirmation({ ...confirmation, open: false });
	const dialog: ConfirmActionDialogProps = {
		open: confirmation.open,
		onOpenChange: (open) => {
			if (!open && !mutation.isPending) close();
		},
		title: `Update ${confirmation.machineName}?`,
		description: `Request agent ${confirmation.tag}. The request stays queued until the agent checks in. The agent waits for running jobs to finish before installing the update.`,
		confirmLabel: "Queue update",
		variant: "primary",
		pending: mutation.isPending,
		lockDismissal: mutation.isPending,
		disabled,
		error,
		returnFocusRef: triggerRef,
		getFallbackFocus: () => actionsRef.current?.current ?? connectButtonRef.current,
		onConfirm: () => {
			if (disabled || mutation.isPending) return;

			mutation.mutate(confirmation, {
				onSuccess: () => {
					triggerRef.current = null;
					toast.success("Agent update requested");
					close();
				},
			});
		},
	};

	return { open, pendingAgentId: mutation.isPending ? confirmation.agentId : undefined, dialog };
}
