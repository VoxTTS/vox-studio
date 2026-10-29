import * as React from "react";
import { cn } from "@/lib/utils";

/** Native select styled to match shadcn inputs — dense and keyboard friendly. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "h-8 rounded-md border border-input bg-background/60 px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
