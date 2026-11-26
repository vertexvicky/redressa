import { eq } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { conversations, messages } from "../db/schema.js";
import type { Env } from "../env.js";
import { hasConsent } from "../services/consent.js";
import { executeAgentTool } from "../agent/tools/registry.js";

export class VoiceSession implements DurableObject {
  private geminiSocket: WebSocket | null = null;
  private clientSocket: WebSocket | null = null;
  private userId: string | null = null;
  private conversationId: string | null = null;
  private caseId: string | null = null;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.userId = url.searchParams.get("userId");
    this.caseId = url.searchParams.get("caseId");
    this.conversationId = url.searchParams.get("conversationId");

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    if (!this.userId) {
      return new Response("Missing userId", { status: 400 });
    }

    const db = createDb(this.env.DB);
    const voiceAllowed = await hasConsent(db, this.userId, "voice");
    if (!voiceAllowed) {
      return new Response("Voice consent required", { status: 403 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.clientSocket = server;
    this.state.acceptWebSocket(server);

    if (this.env.GEMINI_API_KEY) {
      try {
        const liveModel = this.env.GEMINI_MODEL_LIVE || "gemini-3.1-flash-live";
        const geminiUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(
          this.env.GEMINI_API_KEY
        )}`;
        const upstream = new WebSocket(geminiUrl);
        this.geminiSocket = upstream;

        upstream.addEventListener("open", () => {
          upstream.send(
            JSON.stringify({
              setup: {
                model: `models/${liveModel}`,
                generationConfig: {
                  responseModalities: ["AUDIO", "TEXT"]
                }
              }
            })
          );
          server.send(JSON.stringify({ type: "voice_ready", model: liveModel }));
        });

        upstream.addEventListener("message", async (event) => {
          const payload = typeof event.data === "string" ? event.data : "";
          try {
            const parsed = JSON.parse(payload) as {
              serverContent?: {
                modelTurn?: { parts?: Array<{ text?: string }> };
              };
              toolCall?: {
                functionCalls?: Array<{ id?: string; name: string; args: Record<string, unknown> }>;
              };
            };

            const textPart = parsed.serverContent?.modelTurn?.parts?.find((p) => p.text)?.text;
            if (textPart && this.conversationId) {
              await this.persistTranscript("agent", textPart);
            }

            if (parsed.toolCall?.functionCalls && this.userId) {
              for (const call of parsed.toolCall.functionCalls) {
                const result = await executeAgentTool(db, this.env, this.userId, call.name, call.args);
                upstream.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { result }
                        }
                      ]
                    }
                  })
                );
              }
            }
          } catch {
          }

          if (this.clientSocket) {
            this.clientSocket.send(event.data);
          }
        });

        upstream.addEventListener("close", () => {
          if (this.clientSocket) {
            try {
              this.clientSocket.send(JSON.stringify({ type: "voice_fallback_chat" }));
            } catch {
            }
          }
        });
      } catch {
        server.send(JSON.stringify({ type: "voice_fallback_chat" }));
      }
    } else {
      server.send(
        JSON.stringify({
          type: "voice_ready",
          mode: "transcript_relay",
          caseId: this.caseId
        })
      );
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  private async persistTranscript(sender: "citizen" | "agent", text: string): Promise<void> {
    if (!this.conversationId || !text.trim()) return;
    const db = createDb(this.env.DB);
    const now = Date.now();
    await db.insert(messages).values({
      id: crypto.randomUUID(),
      conversationId: this.conversationId,
      sender,
      text: text.trim(),
      language: "en",
      createdAt: now,
      updatedAt: now
    });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (!this.userId) return;
    const db = createDb(this.env.DB);
    const stillConsented = await hasConsent(db, this.userId, "voice");
    if (!stillConsented) {
      ws.send(JSON.stringify({ type: "consent_revoked" }));
      ws.close(1000, "Voice consent revoked");
      this.geminiSocket?.close(1000, "Consent revoked");
      return;
    }

    if (typeof raw === "string") {
      try {
        const msg = JSON.parse(raw) as { type?: string; transcript?: string; conversationId?: string };
        if (msg.conversationId && !this.conversationId) {
          this.conversationId = msg.conversationId;
        }
        if (msg.type === "transcript" && msg.transcript) {
          await this.persistTranscript("citizen", msg.transcript);
          if (!this.geminiSocket && this.conversationId) {
            const [conv] = await db
              .select()
              .from(conversations)
              .where(eq(conversations.id, this.conversationId))
              .limit(1);
            if (conv) {
              const ack = "I'm Redressa. I heard your voice update and recorded it on your case.";
              await this.persistTranscript("agent", ack);
              ws.send(JSON.stringify({ type: "agent_transcript", text: ack }));
            }
          }
        }
      } catch {
      }
    }

    if (this.geminiSocket && this.geminiSocket.readyState === WebSocket.OPEN) {
      this.geminiSocket.send(raw);
    }
  }

  async webSocketClose(): Promise<void> {
    try {
      this.geminiSocket?.close(1000, "Client closed");
    } catch {
    }
  }
}
