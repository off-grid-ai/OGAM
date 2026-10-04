export interface MobileChatSessionControlPort {
  stopActive(): boolean;
  stopConversation(conversationId: string): number;
}

let activePort: MobileChatSessionControlPort | null = null;

/** Wire the platform chat owner without creating a second command implementation. */
export function registerMobileChatSessionControl(port: MobileChatSessionControlPort): () => void {
  activePort = port;
  return () => { if (activePort === port) activePort = null; };
}

export function stopActiveMobileChatSession(): boolean {
  return activePort?.stopActive() ?? false;
}
