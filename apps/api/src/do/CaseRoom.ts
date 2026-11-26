export class CaseRoom implements DurableObject {
  private locked = false;

  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      this.state.acceptWebSocket(server);
      server.send(JSON.stringify({ type: "connected", timestamp: Date.now() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/lock" && request.method === "POST") {
      if (this.locked) {
        return new Response(JSON.stringify({ locked: false }), { status: 409 });
      }
      this.locked = true;
      return new Response(JSON.stringify({ locked: true }), { status: 200 });
    }

    if (url.pathname === "/unlock" && request.method === "POST") {
      this.locked = false;
      return new Response(JSON.stringify({ unlocked: true }), { status: 200 });
    }

    if (url.pathname === "/broadcast" && request.method === "POST") {
      const text = await request.text();
      for (const ws of this.state.getWebSockets()) {
        try {
          ws.send(text);
        } catch {
        }
      }
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message === "string" && message === "ping") {
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
    }
  }
}
