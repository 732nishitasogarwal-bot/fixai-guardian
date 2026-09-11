import type { FixAiAgent } from "@/hooks/use-fixai-agent";
import { useOutletContext } from "react-router";

export function useAgent(): FixAiAgent {
  return useOutletContext<FixAiAgent>();
}
