import { X } from "lucide-react";
import { useApp } from "@/app/store";
import { cn } from "@/lib/utils";

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-xl",
            t.tone === "error" ? "border-destructive/50 bg-[hsl(0_40%_12%)] text-red-100" : "bg-panel",
          )}
        >
          <span className="flex-1 leading-relaxed">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
