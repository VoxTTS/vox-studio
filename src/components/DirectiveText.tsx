import { tokenize } from "@shared/directives.js";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<string, string> = {
  event: "bg-amber-400/15 text-amber-300 ring-amber-400/30",
  pause: "bg-sky-400/15 text-sky-300 ring-sky-400/30",
  style: "bg-fuchsia-400/15 text-fuchsia-300 ring-fuchsia-400/30",
};

/** Segment text with inline directives rendered as chips. */
export function DirectiveText({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return <span className={cn("italic text-muted-foreground", className)}>Empty — type a line</span>;
  return (
    <span className={className}>
      {tokenize(text).map((t, i) =>
        t.type === "text" ? (
          <span key={i}>{t.value}</span>
        ) : (
          <span
            key={i}
            className={cn("mx-px rounded px-1 py-px font-mono text-[0.85em] ring-1 ring-inset", KIND_STYLE[t.kind ?? "style"])}
          >
            {t.name}
          </span>
        ),
      )}
    </span>
  );
}
