import type { AppDb } from "../db/client.js";
import { replyIndex } from "../db/schema.js";
import type { Env } from "../env.js";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "was",
  "were",
  "why",
  "what",
  "when",
  "where",
  "which",
  "with",
  "this",
  "that",
  "from",
  "have",
  "has",
  "not",
  "but",
  "you",
  "your",
  "can",
  "will",
  "please",
  "about",
  "into",
  "does",
  "did"
]);

export function buildFtsQuery(input: string): string | null {
  const matches = input.toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) ?? [];
  const tokens = Array.from(new Set(matches))
    .filter((token) => !STOP_WORDS.has(token))
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"`).join(" OR ");
}

export interface IndexedReplyRecord {
  id: string;
  ticketId: string;
  category: string;
  question: string;
  finalReply: string;
  rounds: number;
  autoComposed: boolean;
  finalizedAt: number;
  snippet: string;
}

interface IndexRow {
  id: string;
  ticket_id: string;
  category: string;
  question: string;
  final_reply: string;
  rounds: number;
  auto_composed: number;
  finalized_at: number;
  snippet: string | null;
}

function mapRow(row: IndexRow): IndexedReplyRecord {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    category: row.category,
    question: row.question,
    finalReply: row.final_reply,
    rounds: row.rounds,
    autoComposed: row.auto_composed === 1,
    finalizedAt: row.finalized_at,
    snippet: row.snippet ?? row.final_reply.slice(0, 200)
  };
}

export async function indexFinalizedReply(
  db: AppDb,
  params: {
    ticketId: string;
    replyId: string;
    departmentId: string | null;
    category: string;
    question: string;
    finalReply: string;
    rounds: number;
    autoComposed: boolean;
    isDemo: boolean;
    finalizedAt?: number;
  }
): Promise<string> {
  const now = params.finalizedAt ?? Date.now();
  const id = crypto.randomUUID();
  await db.insert(replyIndex).values({
    id,
    ticketId: params.ticketId,
    replyId: params.replyId,
    departmentId: params.departmentId,
    category: params.category,
    question: params.question,
    finalReply: params.finalReply,
    rounds: params.rounds,
    autoComposed: params.autoComposed ? 1 : 0,
    isDemo: params.isDemo ? 1 : 0,
    finalizedAt: now,
    createdAt: now,
    updatedAt: now
  });
  return id;
}

export async function searchReplyIndex(
  env: Env,
  options: {
    query?: string;
    from?: number;
    to?: number;
    limit?: number;
    includeDemo?: boolean;
  }
): Promise<IndexedReplyRecord[]> {
  const limit = Math.min(50, Math.max(1, options.limit ?? 20));
  const from = options.from ?? 0;
  const to = options.to ?? Date.now() + 86_400_000;
  const demoFlag = options.includeDemo ? 1 : 0;
  const ftsQuery = options.query ? buildFtsQuery(options.query) : null;

  if (ftsQuery) {
    const { results } = await env.DB.prepare(
      `SELECT r.id, r.ticket_id, r.category, r.question, r.final_reply, r.rounds, r.auto_composed, r.finalized_at,
              snippet(reply_index_fts, 1, '', '', '…', 24) AS snippet
       FROM reply_index_fts f
       JOIN reply_index r ON r.rowid = f.rowid
       WHERE reply_index_fts MATCH ?1 AND r.is_demo = ?2 AND r.finalized_at BETWEEN ?3 AND ?4
       ORDER BY bm25(reply_index_fts), r.finalized_at DESC
       LIMIT ?5`
    )
      .bind(ftsQuery, demoFlag, from, to, limit)
      .all<IndexRow>();
    return (results ?? []).map(mapRow);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, ticket_id, category, question, final_reply, rounds, auto_composed, finalized_at, NULL AS snippet
     FROM reply_index
     WHERE is_demo = ?1 AND finalized_at BETWEEN ?2 AND ?3
     ORDER BY finalized_at DESC
     LIMIT ?4`
  )
    .bind(demoFlag, from, to, limit)
    .all<IndexRow>();
  return (results ?? []).map(mapRow);
}

export async function findPrecedents(
  env: Env,
  question: string,
  limit = 3
): Promise<Array<{ finalizedAt: number; question: string; reply: string }>> {
  try {
    const records = await searchReplyIndex(env, { query: question, limit });
    return records.map((record) => ({
      finalizedAt: record.finalizedAt,
      question: record.question.slice(0, 160),
      reply: record.finalReply.slice(0, 300)
    }));
  } catch {
    return [];
  }
}
