import {
  type ReviewAgentTraceSession,
  parseReviewAgentTraceListResponse,
} from "@dev.fast/review-protocol";
import { useQuery } from "@tanstack/react-query";
import { useContext } from "react";

import { canvasQueryKeys } from "./canvas-query";
import { DisplayedReviewVersionContext } from "./displayed-review-version-context";
import { type ReviewSession, useReviewSession } from "./host/review-session";
import type { AgentTraceStorage } from "./use-agent-trace";

export type TraceListState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "loaded";
      configured: boolean;
      storage: AgentTraceStorage | null;
      sources: AgentTraceStorage[];
      storageError: string | null;
      sessions: ReviewAgentTraceSession[];
    };

type LoadedTraceList = Extract<TraceListState, { status: "loaded" }>;

async function readTraceList(
  reviewFetch: ReviewSession["fetch"],
  storage: AgentTraceStorage | null,
  signal: AbortSignal,
): Promise<LoadedTraceList> {
  const response = await reviewFetch(
    storage ? `/agent-traces?storage=${storage}` : "/agent-traces",
    { signal },
  );

  if (!response.ok) {
    let message: unknown;
    try {
      const body: unknown = await response.json();
      if (body && typeof body === "object" && "error" in body)
        message = body.error;
    } catch {
      // An error response need not be JSON.
    }
    const safeMessage =
      response.status < 500 &&
      typeof message === "string" &&
      message.length > 0 &&
      message.length <= 200 &&
      !/bearer|token|password|secret|api.?key|https?:\/\//i.test(message)
        ? message
        : `Unable to load agent traces (HTTP ${response.status}).`;
    throw new Error(safeMessage);
  }

  const result = parseReviewAgentTraceListResponse(await response.json());
  if (!result.ok) throw new Error(result.error);

  return {
    status: "loaded",
    configured: result.configured !== false,
    storage:
      result.storage === "s3" || result.storage === "hosted"
        ? result.storage
        : null,
    sources: result.sources ?? [],
    storageError: result.storageError ?? null,
    sessions: result.sessions,
  };
}

export function useTraceList(
  storageOverride: AgentTraceStorage | null = null,
  provided?: TraceListState,
): TraceListState {
  const session = useReviewSession();
  const version = useContext(DisplayedReviewVersionContext);
  const usesProvided = provided !== undefined && !storageOverride;
  const freeform =
    session.review?.kind === "project" || session.review?.kind === "scratchpad";

  // The session reads the displayed version's traces, stored beside its pins.
  const query = useQuery({
    queryKey: canvasQueryKeys.traceList(
      version,
      session.review?.pins,
      storageOverride,
    ),
    queryFn: ({ signal }) =>
      readTraceList(session.fetch, storageOverride, signal),
    enabled: !usesProvided && !freeform,
    staleTime: 0,
  });

  if (usesProvided) return provided;
  if (freeform)
    return {
      status: "loaded",
      configured: false,
      storage: null,
      sources: [],
      storageError: null,
      sessions: [],
    };

  if (query.status === "error")
    return { status: "error", error: query.error.message };

  return query.data ?? { status: "loading" };
}
