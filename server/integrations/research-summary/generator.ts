import type { ResearchSummaryContent } from "../../../shared/contracts/research";
import type { PaperSummarySource } from "../../modules/research/summary-fingerprint";

export interface ResearchSummaryGenerator {
  readonly model: string;
  generate(source: PaperSummarySource): Promise<ResearchSummaryContent>;
}
