import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:border-transparent disabled:opacity-50 resize-vertical",
        className
      )}
      {...props}
    />
  );
}
