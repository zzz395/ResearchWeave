import { useInfiniteQuery } from "@tanstack/react-query";
import { ArrowUp, Wifi, WifiOff } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { chatMessageBodySchema, type ChatMessage } from "../../../../shared/contracts/chat";
import { Button } from "../../../components/ui/button";
import { Alert, ErrorPanel, LoadingLabel, PageLoading } from "../../../components/ui/feedback";
import { TextareaField } from "../../../components/ui/form-field";
import { ApiClientError } from "../../../services/api/client";
import { useRealtime } from "../../../services/realtime/realtime-context";
import { useAuth } from "../../auth/auth-state";
import { useSpaceLayout } from "../../spaces/components/space-layout-context";
import { listMessages } from "../api/chat";
import { mergeChatMessages } from "../merge-chat-messages";

export function Component() {
  const space = useSpaceLayout();
  const { user } = useAuth();
  const { status, subscribeSpace, sendChatMessage } = useRealtime();
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [presentUserIds, setPresentUserIds] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState("");
  const [sendError, setSendError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const historyQuery = useInfiniteQuery({
    queryKey: ["chat-messages", space.id],
    queryFn: ({ pageParam }) => listMessages(space.id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const refetchHistory = historyQuery.refetch;

  useEffect(
    () =>
      subscribeSpace(space.id, (event) => {
        if (event.type === "chat.message.created") {
          setLiveMessages((current) => mergeChatMessages(current, [event.payload.message]));
        }
        if (event.type === "space.snapshot" || event.type === "presence.updated") {
          setPresentUserIds(event.payload.presentUserIds);
        }
        if (event.type === "realtime.reconnected") void refetchHistory();
      }),
    [refetchHistory, space.id, subscribeSpace],
  );

  const messages = useMemo(
    () =>
      mergeChatMessages(
        ...(historyQuery.data?.pages.map((page) => page.messages) ?? []),
        liveMessages,
      ),
    [historyQuery.data?.pages, liveMessages],
  );

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDraftError("");
    setSendError("");
    const parsed = chatMessageBodySchema.safeParse(draft);
    if (!parsed.success) {
      setDraftError(parsed.error.issues[0]?.message ?? "Write a valid message.");
      return;
    }
    setIsSending(true);
    try {
      await sendChatMessage(space.id, parsed.data);
      setDraft("");
    } catch (error: unknown) {
      setSendError(error instanceof Error ? error.message : "The message could not be sent.");
    } finally {
      setIsSending(false);
    }
  }

  if (historyQuery.isPending) return <PageLoading label="Loading chat history" />;
  if (historyQuery.error) {
    const error = historyQuery.error instanceof ApiClientError ? historyQuery.error : null;
    return <ErrorPanel message={error?.message ?? "Chat history could not be loaded."} requestId={error?.requestId} onRetry={() => void historyQuery.refetch()} />;
  }

  return (
    <section className="rw-chat-workspace rw-space-tab-panel">
      <header className="rw-chat-header">
        <div><p className="rw-page-kicker">Persistent space chat</p><h2>Conversation</h2></div>
        <div className={`rw-realtime-state rw-realtime-state--${status}`}>
          {status === "connected" ? <Wifi aria-hidden="true" size={15} /> : <WifiOff aria-hidden="true" size={15} />}
          <span>{status === "connected" ? `${presentUserIds.length} viewing this space` : status === "connecting" ? "Reconnecting…" : "Realtime disconnected"}</span>
        </div>
      </header>
      <div className="rw-message-history" aria-live="polite">
        {historyQuery.hasNextPage ? (
          <Button disabled={historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()} variant="ghost">
            {historyQuery.isFetchingNextPage ? <LoadingLabel>Loading earlier messages</LoadingLabel> : "Load earlier messages"}
          </Button>
        ) : null}
        {messages.length === 0 ? (
          <div className="rw-chat-empty"><span>00</span><div><h3>No messages yet.</h3><p>Start the durable record for this Research Space.</p></div></div>
        ) : messages.map((message, index) => {
          const own = message.sender.id === user?.id;
          const previous = messages[index - 1];
          const showIdentity = !previous || previous.sender.id !== message.sender.id;
          return (
            <article className={`rw-message ${own ? "rw-message--own" : ""}`} key={message.id}>
              <div className="rw-message__meta">
                {showIdentity ? <strong>{own ? "You" : message.sender.displayName}</strong> : <span />}
                <time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time>
              </div>
              <p>{message.body}</p>
            </article>
          );
        })}
        <div ref={endRef} />
      </div>
      <form className="rw-chat-composer" onSubmit={(event) => void handleSubmit(event)}>
        {sendError ? <Alert><strong>Message not sent.</strong><span>{sendError}</span></Alert> : null}
        <TextareaField
          disabled={status !== "connected" || isSending}
          error={draftError}
          hint={`${draft.length.toLocaleString()} / 4,000`}
          id="chat-message"
          label="Message"
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={status === "connected" ? "Add to the shared research record…" : "Waiting for realtime connection…"}
          rows={3}
          value={draft}
        />
        <div className="rw-chat-composer__actions">
          <p>Messages become visible only after the server commits them.</p>
          <Button disabled={status !== "connected" || isSending} type="submit">
            {isSending ? <LoadingLabel>Awaiting acknowledgement</LoadingLabel> : <><ArrowUp aria-hidden="true" size={17} />Send message</>}
          </Button>
        </div>
      </form>
    </section>
  );
}
