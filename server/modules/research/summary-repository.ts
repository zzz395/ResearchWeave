import { eq } from "drizzle-orm";

import type { Database } from "../../db/client";
import {
  papers,
  paperSummaries,
  type PaperSummaryRecord,
} from "../../db/schema";
import { createSummarySourceFingerprint, toPaperSummarySource } from "./summary-fingerprint";

export type PersistSummaryResult =
  | { status: "persisted"; record: PaperSummaryRecord }
  | { status: "paper_not_found" }
  | { status: "source_changed" };

export interface PaperSummaryRepository {
  findByPaperId(paperId: string): Promise<PaperSummaryRecord | null>;
  persistIfSourceCurrent(record: PaperSummaryRecord): Promise<PersistSummaryResult>;
}

export function createDrizzlePaperSummaryRepository(
  database: Database,
): PaperSummaryRepository {
  const db = database.db;

  return {
    async findByPaperId(paperId) {
      const [summary] = await db
        .select()
        .from(paperSummaries)
        .where(eq(paperSummaries.paperId, paperId))
        .limit(1);
      return summary ?? null;
    },

    async persistIfSourceCurrent(record) {
      return db.transaction(async (transaction): Promise<PersistSummaryResult> => {
        const [paper] = await transaction
          .select()
          .from(papers)
          .where(eq(papers.id, record.paperId))
          .limit(1)
          .for("share");
        if (!paper) return { status: "paper_not_found" };
        const currentFingerprint = createSummarySourceFingerprint(toPaperSummarySource(paper));
        if (currentFingerprint !== record.sourceFingerprint) {
          return { status: "source_changed" };
        }

        const [persisted] = await transaction
          .insert(paperSummaries)
          .values(record)
          .onConflictDoUpdate({
            target: paperSummaries.paperId,
            set: {
              overview: record.overview,
              keyContributions: record.keyContributions,
              methodHighlights: record.methodHighlights,
              findings: record.findings,
              caveats: record.caveats,
              sourceFingerprint: record.sourceFingerprint,
              sourceVersion: record.sourceVersion,
              sourceUpdatedAt: record.sourceUpdatedAt,
              model: record.model,
              promptVersion: record.promptVersion,
              generatedAt: record.generatedAt,
            },
          })
          .returning();
        if (!persisted) throw new Error("Paper summary upsert returned no record.");
        return { status: "persisted", record: persisted };
      });
    },
  };
}
