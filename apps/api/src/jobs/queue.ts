import { eq } from "drizzle-orm";
import { createDb } from "../db/client.js";
import { evidence, processedEvents } from "../db/schema.js";
import type { AgentEventMessage, Env, EvidenceJobMessage } from "../env.js";
import { analyzeImageOrDocumentWithVision } from "../agent/llm.js";
import { processAgentEvent } from "../agent/orchestrator.js";
import { readEvidenceBytes } from "../services/storage.js";

export async function handleQueueBatch(
  batch: MessageBatch<AgentEventMessage | EvidenceJobMessage>,
  env: Env
): Promise<void> {
  const db = createDb(env.DB);

  if (batch.queue === "agent-events") {
    for (const msg of batch.messages) {
      const payload = msg.body as AgentEventMessage;
      const [already] = await db
        .select()
        .from(processedEvents)
        .where(eq(processedEvents.id, payload.eventId))
        .limit(1);

      if (already) {
        msg.ack();
        continue;
      }

      try {
        await processAgentEvent(db, env, payload);
        await db.insert(processedEvents).values({
          id: payload.eventId,
          processedAt: Date.now()
        });
        msg.ack();
      } catch {
        msg.retry();
      }
    }
    return;
  }

  if (batch.queue === "evidence-processing") {
    for (const msg of batch.messages) {
      const payload = msg.body as EvidenceJobMessage;
      try {
        const [ev] = await db
          .select()
          .from(evidence)
          .where(eq(evidence.id, payload.evidenceId))
          .limit(1);

        if (!ev) {
          msg.ack();
          continue;
        }

        const stored = await readEvidenceBytes(env, payload.evidenceId);
        if (!stored) {
          msg.ack();
          continue;
        }

        const analysis = await analyzeImageOrDocumentWithVision({
          env,
          db,
          userId: ev.uploaderId,
          mime: payload.mime,
          bytes: stored.bytes,
          question: "Summarize key objects, visible text, and estimated time of day factually."
        });

        await db
          .update(evidence)
          .set({
            aiSummary: analysis.summary,
            aiSummaryJson: analysis as unknown as Record<string, unknown>,
            updatedAt: Date.now()
          })
          .where(eq(evidence.id, ev.id));

        msg.ack();
      } catch {
        msg.retry();
      }
    }
  }
}
