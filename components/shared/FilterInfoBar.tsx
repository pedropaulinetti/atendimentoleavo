import { Badge } from "@/components/ui/badge";
import { getPipelineName, getInstanceName } from "@/lib/datacrazy/pipeline";
import { MessageCircle, Workflow } from "lucide-react";

export async function FilterInfoBar() {
  let pipelineName = "Pipeline";
  let channelName: string | null = null;
  try {
    [pipelineName, channelName] = await Promise.all([getPipelineName(), getInstanceName()]);
  } catch {
    // On failure, still render with defaults
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-white/60 px-6 py-2 text-xs backdrop-blur">
      <span className="text-zinc-500">Exibindo</span>
      <Badge variant="outline" className="gap-1.5 bg-white font-normal">
        <Workflow className="size-3" />
        <span className="text-zinc-500">Funil:</span>
        <span className="font-medium text-zinc-900">{pipelineName}</span>
      </Badge>
      {channelName && (
        <Badge variant="outline" className="gap-1.5 bg-white font-normal">
          <MessageCircle className="size-3" />
          <span className="text-zinc-500">Canal:</span>
          <span className="font-medium text-zinc-900">{channelName}</span>
        </Badge>
      )}
    </div>
  );
}
