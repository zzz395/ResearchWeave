import type { PaperComparisonGeneratedContent } from "../../../shared/contracts/paper-comparison";
import type { PaperComparisonSource } from "../../modules/paper-comparison/source";

export interface PaperComparisonGenerator {
  readonly model: string;
  generate(sources: PaperComparisonSource[]): Promise<PaperComparisonGeneratedContent>;
}
