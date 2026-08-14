/**
 * The one shape this tool is certain of: a conversation, and the turns in it.
 *
 * The web app renders these, the API persists them, and the agent package turns
 * them into a provider request — three packages, so they belong here rather
 * than in any one of them. Everything else about the domain (the trip itself,
 * its itinerary, its bookings) is deliberately absent until the design lands;
 * an interface written for an imagined caller fits neither.
 */

/**
 * Who said it. The system prompt is not a role here on purpose — it belongs to
 * the agent, is not part of the transcript a user sees, and storing it per-turn
 * would invite it drifting between turns of the same conversation.
 */
export const MESSAGE_ROLES = ["user", "assistant"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  /** ISO-8601, UTC. */
  createdAt: string;
}

export interface Conversation {
  id: string;
  /** Drawn from the first user turn; null until there is one. */
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A conversation with its turns, in the order they were said. */
export interface ConversationDetail extends Conversation {
  messages: readonly Message[];
}
