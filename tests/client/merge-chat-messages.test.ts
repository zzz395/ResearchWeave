import { describe, expect, it } from "vitest";

import type { ChatMessage } from "../../shared/contracts/chat";
import { mergeChatMessages } from "../../src/features/chat/merge-chat-messages";

function message(id: string, body: string, createdAt: string): ChatMessage {
  return {
    id,
    spaceId: "00000000-0000-4000-8000-000000000001",
    sender: {
      id: "00000000-0000-4000-8000-000000000002",
      email: "ada@example.com",
      displayName: "Ada",
      createdAt: "2026-08-25T00:00:00.000Z",
    },
    body,
    createdAt,
  };
}

describe("mergeChatMessages", () => {
  it("deduplicates REST and realtime messages by stable ID and keeps stable order", () => {
    const first = message("00000000-0000-4000-8000-000000000010", "First", "2026-08-25T00:00:01.000Z");
    const second = message("00000000-0000-4000-8000-000000000020", "Second", "2026-08-25T00:00:02.000Z");
    expect(mergeChatMessages([second], [first, second])).toEqual([first, second]);
  });
});

