import { useOutletContext } from "react-router-dom";

import type { ResearchSpace } from "../../../../shared/contracts/spaces";

export function useSpaceLayout(): ResearchSpace {
  return useOutletContext<ResearchSpace>();
}
