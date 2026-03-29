import { Spinner } from "./spinner";

export function LoadingOverlay({ title, subtitle, spinnerColor = "#0ea5e9" }) {
  return (
    <div
      className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center cursor-wait"
      aria-live="polite"
      role="status"
    >
      <div className="bg-white rounded-2xl px-8 py-7 shadow-2xl max-w-[90%] text-center pointer-events-none flex flex-col items-center gap-4">
        <Spinner color={spinnerColor} />
        <div>
          <p className="text-base font-semibold text-gray-900">{title}</p>
          {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
        </div>
      </div>
    </div>
  );
}
