import * as Dialog from "@radix-ui/react-dialog";
import { useMutation } from "@tanstack/react-query";
import { Play, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  AGENT_TASK_PROMPT_MAX_CHARACTERS,
  createAgentTaskInputSchema,
  type AgentDefinition,
} from "../../../../shared/contracts/agents";
import type { ResearchSpace } from "../../../../shared/contracts/spaces";
import { Button } from "../../../components/ui/button";
import { Alert, LoadingLabel } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import {
  getAgentApiErrorMessage,
  getAgentAvailabilityPresentation,
  resolveClientRequestIdentity,
  type ClientRequestIdentity,
} from "../agent-presentation";
import { createAgentTask } from "../api/agents";

export function NewAgentTaskDialog({
  agents,
  spaces,
  initialAgentId,
  initialSpaceId,
}: {
  agents: readonly AgentDefinition[];
  spaces: readonly ResearchSpace[];
  initialAgentId?: string;
  initialSpaceId?: string;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [spaceId, setSpaceId] = useState(initialSpaceId ?? "");
  const [agentId, setAgentId] = useState(initialAgentId ?? "");
  const [prompt, setPrompt] = useState("");
  const [fieldError, setFieldError] = useState("");
  const requestIdentity = useRef<ClientRequestIdentity | null>(null);
  const mutation = useMutation({
    mutationFn: ({ targetSpaceId, input }: {
      targetSpaceId: string;
      input: Parameters<typeof createAgentTask>[1];
    }) => createAgentTask(targetSpaceId, input),
  });

  const selectedAgent = agents.find((agent) => agent.id === agentId);
  const availability = selectedAgent
    ? getAgentAvailabilityPresentation(selectedAgent.availability)
    : null;
  const apiError = mutation.error instanceof ApiClientError ? mutation.error : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFieldError("");
    mutation.reset();
    if (!spaceId) {
      setFieldError("Choose the Research Space that will own this task.");
      return;
    }
    if (!agentId) {
      setFieldError("Choose a system-managed Agent.");
      return;
    }
    if (!selectedAgent?.availability.available) {
      setFieldError("The selected Agent is not ready to accept work.");
      return;
    }

    const fingerprint = [spaceId, agentId, prompt.trim()].join("\u0000");
    requestIdentity.current = resolveClientRequestIdentity(
      requestIdentity.current,
      fingerprint,
    );
    const input = createAgentTaskInputSchema.safeParse({
      agentId,
      prompt,
      clientRequestId: requestIdentity.current.id,
    });
    if (!input.success) {
      setFieldError(input.error.issues[0]?.message ?? "Check the task details.");
      return;
    }

    try {
      const result = await mutation.mutateAsync({ targetSpaceId: spaceId, input: input.data });
      requestIdentity.current = null;
      setPrompt("");
      setOpen(false);
      void navigate("/agents/tasks/" + result.task.id);
    } catch {
      // Keep the logical request id stable so an uncertain submission can be replayed safely.
    }
  }

  return (
    <Dialog.Root
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) {
          setSpaceId(initialSpaceId ?? "");
          setAgentId(initialAgentId ?? "");
        } else {
          setFieldError("");
          mutation.reset();
        }
      }}
      open={open}
    >
      <Dialog.Trigger asChild>
        <Button disabled={agents.length === 0 || spaces.length === 0}>
          <Play aria-hidden="true" size={16} />
          New Agent task
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="rw-dialog-overlay" />
        <Dialog.Content className="rw-dialog-card rw-agent-task-dialog">
          <div className="rw-dialog-card__heading">
            <div>
              <p className="rw-page-kicker">Durable execution</p>
              <Dialog.Title>Start an Agent task</Dialog.Title>
            </div>
            <Dialog.Close className="rw-icon-button" aria-label="Close task form">
              <X aria-hidden="true" size={19} />
            </Dialog.Close>
          </div>
          <Dialog.Description>
            The prompt is immutable after submission. Retrying creates a new Run under the same Task.
          </Dialog.Description>

          <form className="rw-agent-task-form" noValidate onSubmit={(event) => void handleSubmit(event)}>
            <div className="rw-agent-task-form__selectors">
              <div className="rw-field">
                <div className="rw-field__label-row"><label htmlFor="agent-task-space">Research Space</label></div>
                <select
                  className="rw-input rw-select"
                  id="agent-task-space"
                  onChange={(event) => {
                    setSpaceId(event.target.value);
                    requestIdentity.current = null;
                  }}
                  value={spaceId}
                >
                  <option value="">Choose a Space</option>
                  {spaces.map((space) => (
                    <option key={space.id} value={space.id}>{space.name}</option>
                  ))}
                </select>
              </div>
              <div className="rw-field">
                <div className="rw-field__label-row"><label htmlFor="agent-task-agent">Agent</label></div>
                <select
                  className="rw-input rw-select"
                  id="agent-task-agent"
                  onChange={(event) => {
                    setAgentId(event.target.value);
                    requestIdentity.current = null;
                  }}
                  value={agentId}
                >
                  <option value="">Choose an Agent</option>
                  {agents.map((agent) => (
                    <option disabled={!agent.availability.available} key={agent.id} value={agent.id}>
                      {agent.name}{agent.availability.available ? "" : " — unavailable"}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedAgent && availability ? (
              <div className="rw-agent-selection-note">
                <div>
                  <span className={"rw-status-badge rw-status-badge--" + availability.tone}>
                    {availability.label}
                  </span>
                  <strong>{selectedAgent.name}</strong>
                </div>
                <p>{availability.detail}</p>
                <small>
                  Up to {selectedAgent.limits.maxSteps} steps, {selectedAgent.limits.maxToolCalls} tool calls,
                  and {selectedAgent.limits.wallTimeSeconds} seconds.
                </small>
              </div>
            ) : null}

            <div className="rw-field">
              <div className="rw-field__label-row">
                <label htmlFor="agent-task-prompt">Research task</label>
                <span>{prompt.length.toLocaleString()} / {AGENT_TASK_PROMPT_MAX_CHARACTERS.toLocaleString()}</span>
              </div>
              <textarea
                aria-describedby={fieldError ? "agent-task-error" : undefined}
                aria-invalid={Boolean(fieldError)}
                className="rw-input rw-agent-task-prompt"
                id="agent-task-prompt"
                maxLength={AGENT_TASK_PROMPT_MAX_CHARACTERS}
                onChange={(event) => {
                  setPrompt(event.target.value);
                  requestIdentity.current = null;
                  if (fieldError) setFieldError("");
                }}
                placeholder="Synthesize the strongest evidence for…"
                rows={7}
                value={prompt}
              />
              {fieldError ? <p className="rw-field__error" id="agent-task-error" role="alert">{fieldError}</p> : null}
            </div>

            {apiError ? (
              <Alert>
                <strong>Task could not be started.</strong>
                <span>{getAgentApiErrorMessage(apiError)}</span>
                {apiError.requestId ? <small>Request ID: {apiError.requestId}</small> : null}
              </Alert>
            ) : null}

            <div className="rw-form-actions rw-form-actions--end">
              <Dialog.Close asChild>
                <Button disabled={mutation.isPending} variant="secondary">Cancel</Button>
              </Dialog.Close>
              <Button disabled={mutation.isPending || !selectedAgent?.availability.available} type="submit">
                {mutation.isPending ? <LoadingLabel>Starting task</LoadingLabel> : "Start durable run"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
