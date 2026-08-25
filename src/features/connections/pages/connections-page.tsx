import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Link2, Send, UserMinus, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  createConnectionRequestInputSchema,
  type Connection,
  type ConnectionActionInput,
} from "../../../../shared/contracts/connections";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { InputField } from "../../../components/ui/form-field";
import { useAuth } from "../../auth/auth-state";
import { ContentSection, PageHeader } from "../../spaces/components/space-page";
import { formatResearchDate } from "../../spaces/format-research-date";
import { ApiClientError } from "../../../services/api/client";
import {
  actOnConnection,
  listConnections,
  removeConnection,
  requestConnection,
} from "../api/connections";

export function Component() {
  const { user } = useAuth();
  const [emailError, setEmailError] = useState("");
  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: listConnections });
  const requestMutation = useMutation({ mutationFn: requestConnection });
  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: ConnectionActionInput["action"] }) =>
      actOnConnection(id, { action }),
  });
  const removeMutation = useMutation({ mutationFn: removeConnection });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["connections"] });
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailError("");
    const form = event.currentTarget;
    const parsed = createConnectionRequestInputSchema.safeParse({
      email: new FormData(form).get("email"),
    });
    if (!parsed.success) {
      setEmailError(parsed.error.flatten().fieldErrors.email?.[0] ?? "Enter a valid email.");
      return;
    }
    try {
      await requestMutation.mutateAsync(parsed.data);
      form.reset();
      await refresh();
    } catch {
      // The request remains visible as a truthful error state.
    }
  }

  async function handleAction(connection: Connection, action: ConnectionActionInput["action"]) {
    try {
      await actionMutation.mutateAsync({ id: connection.id, action });
      await refresh();
    } catch {
      // The row remains visible and the server error is shown.
    }
  }

  async function handleRemove(connection: Connection) {
    try {
      await removeMutation.mutateAsync(connection.id);
      await refresh();
    } catch {
      // Removal failures do not hide the durable connection.
    }
  }

  if (connectionsQuery.isPending) return <PageLoading label="Loading connections" />;
  if (connectionsQuery.error) {
    const error = connectionsQuery.error instanceof ApiClientError ? connectionsQuery.error : null;
    return (
      <ErrorPanel
        message={error?.message ?? "Connections could not be loaded."}
        onRetry={() => void connectionsQuery.refetch()}
        requestId={error?.requestId}
      />
    );
  }

  const incoming = connectionsQuery.data.filter(
    (connection) => connection.status === "pending" && connection.requestedByUserId !== user?.id,
  );
  const outgoing = connectionsQuery.data.filter(
    (connection) => connection.status === "pending" && connection.requestedByUserId === user?.id,
  );
  const accepted = connectionsQuery.data.filter((connection) => connection.status === "accepted");
  const mutationError = [requestMutation.error, actionMutation.error, removeMutation.error].find(
    (error) => error instanceof ApiClientError,
  );

  return (
    <ContentSection>
      <PageHeader
        description="Connect by exact registered email. ResearchWeave does not expose a public user directory."
        kicker="Collaboration directory"
        title="Connections"
      />
      <section className="rw-connection-request">
        <div>
          <p className="rw-page-kicker">Private lookup</p>
          <h2>Request a connection</h2>
          <p>The recipient can accept or reject the request before they can be added to a space.</p>
        </div>
        <form onSubmit={(event) => void handleRequest(event)}>
          <InputField
            autoComplete="email"
            error={emailError}
            id="connection-email"
            label="Registered email"
            name="email"
            placeholder="researcher@example.com"
            required
            type="email"
          />
          <Button disabled={requestMutation.isPending} type="submit">
            {requestMutation.isPending ? <LoadingLabel>Sending request</LoadingLabel> : <><Send aria-hidden="true" size={17} />Send request</>}
          </Button>
        </form>
      </section>
      {mutationError ? (
        <Alert><strong>Connection action failed.</strong><span>{mutationError.message}</span></Alert>
      ) : null}
      <ConnectionSection
        connections={incoming}
        empty="No incoming requests."
        onAction={(connection, action) => void handleAction(connection, action)}
        title="Incoming requests"
      />
      <ConnectionSection
        connections={accepted}
        empty="No accepted connections yet."
        onRemove={(connection) => void handleRemove(connection)}
        title="Accepted connections"
      />
      <ConnectionSection
        connections={outgoing}
        empty="No sent requests are waiting for a response."
        onAction={(connection, action) => void handleAction(connection, action)}
        title="Sent requests"
      />
    </ContentSection>
  );
}

function ConnectionSection({
  title,
  connections,
  empty,
  onAction,
  onRemove,
}: {
  title: string;
  connections: Connection[];
  empty: string;
  onAction?: (connection: Connection, action: ConnectionActionInput["action"]) => void;
  onRemove?: (connection: Connection) => void;
}) {
  return (
    <section className="rw-ledger-section">
      <div className="rw-ledger-section__heading">
        <h2>{title}</h2><span>{connections.length.toString().padStart(2, "0")}</span>
      </div>
      {connections.length === 0 ? <p className="rw-ledger-empty">{empty}</p> : connections.map((connection) => (
        <article className="rw-person-row" key={connection.id}>
          <span className="rw-avatar" aria-hidden="true">{connection.otherUser.displayName.slice(0, 2).toUpperCase()}</span>
          <div className="rw-person-row__identity">
            <strong>{connection.otherUser.displayName}</strong><span>{connection.otherUser.email}</span>
          </div>
          <time dateTime={connection.respondedAt ?? connection.createdAt}>
            {formatResearchDate(connection.respondedAt ?? connection.createdAt)}
          </time>
          <div className="rw-row-actions">
            {onAction && connection.requestedByUserId !== connection.otherUser.id ? (
              <Button onClick={() => onAction(connection, "cancel")} variant="secondary"><X aria-hidden="true" size={16} />Cancel</Button>
            ) : null}
            {onAction && connection.requestedByUserId === connection.otherUser.id ? (
              <><Button onClick={() => onAction(connection, "accept")}><Check aria-hidden="true" size={16} />Accept</Button><Button onClick={() => onAction(connection, "reject")} variant="secondary"><X aria-hidden="true" size={16} />Reject</Button></>
            ) : null}
            {onRemove ? <Button onClick={() => onRemove(connection)} variant="secondary"><UserMinus aria-hidden="true" size={16} />Remove</Button> : null}
          </div>
          {connection.status === "accepted" ? <span className="rw-visually-hidden"><Link2 aria-hidden="true" />Accepted connection</span> : null}
        </article>
      ))}
    </section>
  );
}
