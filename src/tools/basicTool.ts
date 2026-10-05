// Week 1: basic tool definition (from the handbook) + a tiny router.
// A "tool" is just a typed async function the agent can call.

export type ToolResult =
  | { currentTime: string }
  | { response: string };

export async function getCurrentTime(): Promise<ToolResult> {
  return { currentTime: new Date().toISOString() };
}

export async function getHelp(): Promise<ToolResult> {
  return {
    response:
      "I'm the IDX assistant. Soon I'll search California listings, pull market stats and find similar homes.",
  };
}

// Simple keyword routing. In later weeks the LLM orchestrator replaces this.
export async function handleMessage(message: string): Promise<ToolResult> {
  const m = message.toLowerCase();
  if (m.includes("time")) return getCurrentTime();
  if (m.includes("help") || m.includes("what can you do")) return getHelp();
  return { response: "I could not understand the request." };
}
