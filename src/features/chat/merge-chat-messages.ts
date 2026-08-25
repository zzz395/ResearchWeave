import type { ChatMessage } from "../../../shared/contracts/chat";

export function mergeChatMessages(...groups: readonly ChatMessage[][]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const group of groups) {
    for (const message of group) byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime() ||
      left.id.localeCompare(right.id),
  );
}

