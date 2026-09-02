import { useMutation, useQuery } from "@tanstack/react-query";
import { LogOut, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import type { SpaceMember } from "../../../../shared/contracts/members";
import { queryClient } from "../../../app/query-client";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading, SectionHeader } from "../../../components/ui/feedback";
import { ApiClientError } from "../../../services/api/client";
import { useRealtime } from "../../../services/realtime/realtime-context";
import { useAuth } from "../../auth/auth-state";
import { listConnections } from "../../connections/api/connections";
import { useSpaceLayout } from "../../spaces/components/space-layout-context";
import { addMember, listMembers, removeMember } from "../api/members";

export function Component() {
  const space = useSpaceLayout();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { subscribeSpace } = useRealtime();
  const [presentUserIds, setPresentUserIds] = useState<string[]>([]);
  const membersQuery = useQuery({
    queryKey: ["space-members", space.id],
    queryFn: () => listMembers(space.id),
  });
  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    enabled: space.role === "owner",
  });
  const addMutation = useMutation({ mutationFn: (userId: string) => addMember(space.id, { userId }) });
  const removeMutation = useMutation({ mutationFn: (userId: string) => removeMember(space.id, userId) });

  useEffect(
    () =>
      subscribeSpace(space.id, (event) => {
        if (event.type === "space.snapshot" || event.type === "presence.updated") {
          setPresentUserIds(event.payload.presentUserIds);
        }
        if (event.type === "realtime.reconnected") {
          void queryClient.invalidateQueries({ queryKey: ["space-members", space.id] });
          void queryClient.invalidateQueries({ queryKey: ["spaces", space.id] });
        }
      }),
    [space.id, subscribeSpace],
  );

  async function refreshMembers() {
    await queryClient.invalidateQueries({ queryKey: ["space-members", space.id] });
  }

  async function handleAdd(userId: string) {
    try {
      await addMutation.mutateAsync(userId);
      await refreshMembers();
    } catch {
      // The accepted connection remains available for a truthful retry.
    }
  }

  async function handleRemove(member: SpaceMember) {
    try {
      await removeMutation.mutateAsync(member.user.id);
      await refreshMembers();
      if (member.user.id === user?.id) void navigate("/spaces", { replace: true });
    } catch {
      // The server remains the membership source of truth.
    }
  }

  if (membersQuery.isPending) return <PageLoading label="Loading space members" />;
  if (membersQuery.error) {
    const error = membersQuery.error instanceof ApiClientError ? membersQuery.error : null;
    return <ErrorPanel message={error?.message ?? "Space members could not be loaded."} requestId={error?.requestId} onRetry={() => void membersQuery.refetch()} />;
  }

  const memberIds = new Set(membersQuery.data.map((member) => member.user.id));
  const candidates = (connectionsQuery.data ?? []).filter(
    (connection) => connection.status === "accepted" && !memberIds.has(connection.otherUser.id),
  );
  const mutationError = [addMutation.error, removeMutation.error].find(
    (error) => error instanceof ApiClientError,
  );

  return (
    <div className="rw-space-tab-panel rw-members-layout">
      <section className="rw-ledger-section">
        <SectionHeader
          className="rw-ledger-section__heading"
          count={`${membersQuery.data.length} members`}
          title="Space members"
        />
        {mutationError ? <Alert><strong>Membership action failed.</strong><span>{mutationError.message}</span></Alert> : null}
        {membersQuery.data.map((member) => (
          <article className="rw-person-row" key={member.user.id}>
            <span className="rw-avatar" aria-hidden="true">{member.user.displayName.slice(0, 2).toUpperCase()}</span>
            <div className="rw-person-row__identity"><strong>{member.user.displayName}</strong><span>{member.user.email}</span></div>
            <div className="rw-member-state">
              <span className="rw-role-badge">{member.role}</span>
              {presentUserIds.includes(member.user.id) ? <span className="rw-presence-badge"><i />Viewing this space</span> : null}
            </div>
            <div className="rw-row-actions">
              {member.role === "member" && (space.role === "owner" || member.user.id === user?.id) ? (
                <Button disabled={removeMutation.isPending} onClick={() => void handleRemove(member)} variant="secondary">
                  {member.user.id === user?.id ? <><LogOut aria-hidden="true" size={16} />Leave space</> : <><UserMinus aria-hidden="true" size={16} />Remove</>}
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {space.role === "owner" ? (
        <aside className="rw-member-admission">
          <p className="rw-context-label">Owner controls</p>
          <h2>Add from connections</h2>
          <p>Only accepted connections can become members. Removing a connection later does not remove space access.</p>
          {connectionsQuery.isPending ? <LoadingLabel>Loading connections</LoadingLabel> : null}
          {connectionsQuery.error ? <ErrorPanel message="Accepted connections could not be loaded." onRetry={() => void connectionsQuery.refetch()} /> : null}
          {!connectionsQuery.isPending && !connectionsQuery.error && candidates.length === 0 ? (
            <p className="rw-ledger-empty">No eligible accepted connections.</p>
          ) : null}
          {candidates.map((connection) => (
            <div className="rw-admission-row" key={connection.id}>
              <div><strong>{connection.otherUser.displayName}</strong><span>{connection.otherUser.email}</span></div>
              <Button disabled={addMutation.isPending} onClick={() => void handleAdd(connection.otherUser.id)}>
                <UserPlus aria-hidden="true" size={16} />Add
              </Button>
            </div>
          ))}
        </aside>
      ) : null}
    </div>
  );
}
