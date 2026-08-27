import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";

import type { ResearchPaperSummary } from "../../../../shared/contracts/research";
import { Button } from "../../../components/ui/button";
import { ErrorPanel, LoadingLabel } from "../../../components/ui/feedback";
import { researchQueryKeys } from "../api/query-keys";
import {
  ensureResearchPaperSummary,
  getResearchPaperSummary,
} from "../api/research";
import { getSummaryError } from "../research-errors";

function SummaryList({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3>{heading}</h3>
      <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </section>
  );
}

function GeneratedSummary({ summary }: { summary: ResearchPaperSummary }) {
  return (
    <div className="rw-ai-summary__content">
      <section>
        <h3>Overview</h3>
        <p>{summary.overview}</p>
      </section>
      <SummaryList heading="Key contributions" items={summary.keyContributions} />
      <SummaryList heading="Methods" items={summary.methodHighlights} />
      <SummaryList heading="Findings" items={summary.findings} />
      <SummaryList heading="Caveats" items={summary.caveats} />
    </div>
  );
}

export function PaperAiSummary({ paperId }: { paperId: string }) {
  const queryClient = useQueryClient();
  const queryKey = researchQueryKeys.summary(paperId);
  const summaryQuery = useQuery({
    queryKey,
    queryFn: () => getResearchPaperSummary(paperId),
  });
  const generateMutation = useMutation({
    mutationFn: () => ensureResearchPaperSummary(paperId),
    onSuccess: (summary) => queryClient.setQueryData(queryKey, summary),
  });
  const error = getSummaryError(generateMutation.error ?? summaryQuery.error);

  return (
    <section className="rw-ai-summary" aria-labelledby="ai-summary-heading">
      <div className="rw-ai-summary__heading">
        <div>
          <p className="rw-page-kicker">Abstract-grounded</p>
          <h2 id="ai-summary-heading"><Sparkles aria-hidden="true" size={19} />AI Summary</h2>
        </div>
        <p>Generated from the paper abstract only.<br />It may not reflect details available only in the full paper.</p>
      </div>

      {summaryQuery.isPending ? (
        <div className="rw-ai-summary__state"><LoadingLabel>Loading summary</LoadingLabel></div>
      ) : null}
      {summaryQuery.error ? (
        <ErrorPanel
          message={error.message}
          onRetry={() => void summaryQuery.refetch()}
          requestId={error.requestId}
          title={error.title}
        />
      ) : null}
      {generateMutation.error && !summaryQuery.error ? (
        <ErrorPanel message={error.message} requestId={error.requestId} title={error.title} />
      ) : null}
      {summaryQuery.data ? <GeneratedSummary summary={summaryQuery.data} /> : null}
      {summaryQuery.data === null ? (
        <div className="rw-ai-summary__state">
          <p>No current summary is available for this paper abstract.</p>
          <Button
            disabled={generateMutation.isPending}
            onClick={() => generateMutation.mutate()}
          >
            <Sparkles aria-hidden="true" size={16} />
            {generateMutation.isPending ? "Generating…" : "Generate summary"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
