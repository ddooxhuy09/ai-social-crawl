import { Button } from "./ui/button";

/**
 * Generic history modal shell.
 *
 * Props:
 *   open        {boolean}           - whether the modal is visible
 *   onClose     {Function}          - called when modal should close
 *   title       {string}            - header title text
 *   count       {number|undefined}  - badge count shown next to title
 *   children    {ReactNode}         - list content (rows)
 *   empty       {ReactNode}         - content shown when children is empty
 */
export default function HistoryModal({ open, onClose, title, count, children, empty }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/40 flex items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <p className="text-base font-semibold text-gray-900">{title}</p>
            {count != null && count > 0 && (
              <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{count}</span>
            )}
          </div>
          <Button
            variant="ghost"
            type="button"
            onClick={onClose}
            className="w-8 h-8 px-0 text-gray-400 hover:text-gray-600 rounded-full"
          >
            ✕
          </Button>
        </div>

        <div className="overflow-y-auto flex-1 p-4">
          {children ? (
            <div className="flex flex-col gap-1.5">{children}</div>
          ) : (
            empty ?? <p className="text-xs text-gray-400 py-4 text-center">Chưa có lịch sử nào.</p>
          )}
        </div>
      </div>
    </div>
  );
}
