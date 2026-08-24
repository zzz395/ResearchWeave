import { useQuery } from "@tanstack/react-query";

import { getHealth } from "./health";

export function useHealthQuery() {
  return useQuery({
    queryKey: ["foundation", "health"],
    queryFn: getHealth,
    retry: 1,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
