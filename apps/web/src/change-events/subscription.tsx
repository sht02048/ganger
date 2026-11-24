import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChangeChannel } from "./channel";
import type { ChangeChannelTarget } from "./channel";

export function queryClientTarget(queryClient: QueryClient): ChangeChannelTarget {
  return {
    invalidate: (keys) => {
      for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey });
    },
    invalidateAll: () => void queryClient.invalidateQueries(),
    refetchVisible: () => void queryClient.refetchQueries({ type: "active" }),
  };
}

interface ChangeSeqMemory {
  seq: number | null;
}

const RenderedChangeSeq = createContext<ChangeSeqMemory>({ seq: null });

export function RenderedChangeSeqProvider({
  seq,
  children,
}: {
  seq: number | null;
  children: ReactNode;
}) {
  const [memory] = useState<ChangeSeqMemory>(() => ({ seq }));
  return <RenderedChangeSeq.Provider value={memory}>{children}</RenderedChangeSeq.Provider>;
}

export function ChangeEventsSubscription() {
  const queryClient = useQueryClient();
  const memory = useContext(RenderedChangeSeq);
  useEffect(() => {
    const channel = new ChangeChannel({
      after: memory.seq,
      open: (url) => new EventSource(url),
      target: queryClientTarget(queryClient),
    });
    const followVisibility = () => {
      if (document.visibilityState === "hidden") channel.hide();
      else channel.show();
    };
    const followFocus = () => channel.show();
    channel.start();
    followVisibility();
    document.addEventListener("visibilitychange", followVisibility);
    window.addEventListener("pageshow", followVisibility);
    window.addEventListener("focus", followFocus);
    return () => {
      document.removeEventListener("visibilitychange", followVisibility);
      window.removeEventListener("pageshow", followVisibility);
      window.removeEventListener("focus", followFocus);
      memory.seq = channel.lastSeq;
      channel.close();
    };
  }, [memory, queryClient]);
  return null;
}
