import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("text-[10px] font-semibold uppercase tracking-wider text-muted-foreground", className)}
      {...props}
    />
  );
}
