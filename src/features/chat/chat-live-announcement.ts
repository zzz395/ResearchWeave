import type { ChatMessage } from "../../../shared/contracts/chat";

export function getChatLiveAnnouncement(
  message: Pick<ChatMessage, "id" | "sender">,
  currentUserId: string | undefined,
) {
  if (message.sender.id === currentUserId) return null;
  return {
    id: message.id,
    text: `New message from ${message.sender.displayName}.`,
  };
}
