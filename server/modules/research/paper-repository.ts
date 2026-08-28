import { eq, sql } from "drizzle-orm";

import type { Database } from "../../db/client";
import { papers, type PaperRecord } from "../../db/schema";

export type NewPaperRecord = PaperRecord;

export interface PaperRepository {
  upsertMany(records: NewPaperRecord[]): Promise<PaperRecord[]>;
  findById(paperId: string): Promise<PaperRecord | null>;
}

export function shouldRefreshPaper(
  incoming: Pick<NewPaperRecord, "version" | "updatedAt">,
  stored: Pick<PaperRecord, "version" | "updatedAt">,
): boolean {
  return (
    incoming.version > stored.version ||
    (incoming.version === stored.version && incoming.updatedAt >= stored.updatedAt)
  );
}

export function createDrizzlePaperRepository(database: Database): PaperRepository {
  const db = database.db;

  return {
    async upsertMany(records) {
      if (records.length === 0) return [];

      return db.transaction(async (transaction) => {
        const persisted: PaperRecord[] = [];
        const shouldRefresh = sql`excluded."version" > ${papers.version}
          or (excluded."version" = ${papers.version}
            and excluded."updated_at" >= ${papers.updatedAt})`;

        for (const record of records) {
          const [saved] = await transaction
            .insert(papers)
            .values(record)
            .onConflictDoUpdate({
              target: papers.canonicalArxivId,
              set: {
                versionedArxivId: sql`case when ${shouldRefresh} then excluded."versioned_arxiv_id" else ${papers.versionedArxivId} end`,
                version: sql`case when ${shouldRefresh} then excluded."version" else ${papers.version} end`,
                title: sql`case when ${shouldRefresh} then excluded."title" else ${papers.title} end`,
                abstract: sql`case when ${shouldRefresh} then excluded."abstract" else ${papers.abstract} end`,
                authors: sql`case when ${shouldRefresh} then excluded."authors" else ${papers.authors} end`,
                primaryCategory: sql`case when ${shouldRefresh} then excluded."primary_category" else ${papers.primaryCategory} end`,
                categories: sql`case when ${shouldRefresh} then excluded."categories" else ${papers.categories} end`,
                publishedAt: sql`case when ${shouldRefresh} then excluded."published_at" else ${papers.publishedAt} end`,
                updatedAt: sql`case when ${shouldRefresh} then excluded."updated_at" else ${papers.updatedAt} end`,
                comment: sql`case when ${shouldRefresh} then excluded."comment" else ${papers.comment} end`,
                journalRef: sql`case when ${shouldRefresh} then excluded."journal_ref" else ${papers.journalRef} end`,
                doi: sql`case when ${shouldRefresh} then excluded."doi" else ${papers.doi} end`,
                absUrl: sql`case when ${shouldRefresh} then excluded."abs_url" else ${papers.absUrl} end`,
                pdfUrl: sql`case when ${shouldRefresh} then excluded."pdf_url" else ${papers.pdfUrl} end`,
                fetchedAt: sql`case when ${shouldRefresh} then excluded."fetched_at" else ${papers.fetchedAt} end`,
              },
            })
            .returning();
          if (!saved) throw new Error("Paper upsert returned no record.");
          persisted.push(saved);
        }

        return persisted;
      });
    },

    async findById(paperId) {
      const [paper] = await db.select().from(papers).where(eq(papers.id, paperId)).limit(1);
      return paper ?? null;
    },
  };
}
