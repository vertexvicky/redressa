import { Hono } from "hono";
import type { AppVariables } from "../auth/guard.js";
import type { Env } from "../env.js";
import { searchReplyIndex } from "../services/replyIndex.js";

export const recordRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

recordRoutes.get("/search", async (c) => {
  const user = c.get("user")!;
  const query = (c.req.query("q") ?? "").slice(0, 200);
  const from = parseTime(c.req.query("from"));
  const rawTo = parseTime(c.req.query("to"));
  const to = rawTo !== undefined ? rawTo + 86_399_999 : undefined;
  const limit = Number.parseInt(c.req.query("limit") ?? "20", 10);

  const records = await searchReplyIndex(c.env, {
    query,
    from,
    to,
    limit: Number.isFinite(limit) ? limit : 20,
    includeDemo: Boolean(user.isDemo)
  });

  return c.json({ records, query, from: from ?? null, to: to ?? null });
});
