import { cn } from "../../lib/utils";

export function Label({ className, ...props }) {
  return (
    <label
      className={cn("block text-xs font-medium text-gray-600 mb-1", className)}
      {...props}
    />
  );
}
