import React from "react";
import { PAGE_OPTIONS } from "./constants";

export default function TaskCard({
  task,
  onToggle,
  onClick,
  onRunTask,
  onNavigate,
  isRunning,
  queue = [],
}) {
  const done        = task.status === "done";
  const hasDate     = task.start_date || task.deadline;
  const taskInQueue = (queue || []).some(q => q.taskId === task.id && (q.status === "pending" || q.status === "running"));
  const pageOpt     = PAGE_OPTIONS.find(p => p.value === task.linked_page);

  const fmtDate  = (d) => d ? d.slice(5).replace("-", "/") : null;
  const now      = new Date().toISOString().slice(0, 10);
  const isOverdue = task.deadline && task.deadline < now && !done;

  const hasLink      = task.linked_page && pageOpt;
  const isQueueable  = pageOpt?.queueable;
  const hasResult    = !!task.last_history_id;

  // Navigate target for non-queueable pages
  const navigateTarget = {
    "hunt":         "hunt",
    "etsy-listing": "etsy-listing",
    "crawl":        "crawl",
    "crawl-image":  "pinterest-image",
  }[task.linked_page] || task.linked_page;

  return (
    <div
      className={`relative flex flex-col gap-2 rounded-xl border bg-white shadow-sm transition-all group/card cursor-pointer ${
        done ? "opacity-60 border-gray-100 bg-gray-50/50" : "border-gray-200 hover:shadow-md hover:border-sky-300"
      }`}
      onClick={(e) => {
        if (["BUTTON", "INPUT"].includes(e.target.tagName)) return;
        onClick(task);
      }}
    >
      <div className="px-3 pt-3 pb-1">
        <div className="flex items-start gap-2.5">
          <input type="checkbox" checked={done}
            onChange={(e) => { e.stopPropagation(); onToggle(task.id); }}
            className="cursor-pointer shrink-0 mt-0.5 w-4 h-4 text-emerald-500 rounded border-gray-300 accent-emerald-500 transition-all hover:scale-110" />
          <span className={`text-sm font-medium flex-1 leading-snug ${
            done ? "line-through text-gray-400" : "text-gray-800 group-hover/card:text-blue-900 transition-colors"
          }`}>
            {task.title}
          </span>
        </div>

        {/* Image thumbnail for crawl-image tasks */}
        {task.linked_image_data && (
          <div className="mt-2 ml-6">
            <img src={task.linked_image_data} alt={task.linked_image_name || "task image"}
              className="h-16 w-24 object-cover rounded-lg border border-violet-200" />
          </div>
        )}

        {/* Indicators */}
        <div className="flex flex-wrap items-center gap-2 mt-2 ml-6 text-xs text-gray-400">
          {task.notes && (
            <span className="flex items-center gap-1 text-[0.65rem] px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 border border-amber-100" title="Có ghi chú">
              📝 Ghi chú
            </span>
          )}
          {hasDate && (
            <span className={`flex items-center gap-1 text-[0.65rem] px-1.5 py-0.5 rounded border ${
              isOverdue ? "bg-red-50 text-red-600 border-red-200 font-bold" : "bg-violet-50 text-violet-600 border-violet-100"
            }`} title="Thời hạn">
              📅 {task.start_date && fmtDate(task.start_date)} {task.start_date && task.deadline && "→"} {task.deadline && fmtDate(task.deadline)} {isOverdue && "⚠"}
            </span>
          )}
          {hasLink && (
            <span className="flex items-center gap-1 text-[0.65rem] px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 border border-sky-100 truncate max-w-[140px]"
              title={`${pageOpt.label}${task.linked_keyword ? `: ${task.linked_keyword}` : ""}`}>
              {pageOpt.icon} {task.linked_keyword || pageOpt.label}
            </span>
          )}
        </div>
      </div>

      {/* Footer actions */}
      {hasLink && (
        <div className="px-3 py-2 flex items-center gap-2 border-t border-gray-50/80 bg-gray-50/30 rounded-b-xl flex-wrap">
          {/* Queueable: "Add to Queue" button */}
          {isQueueable && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onRunTask && onRunTask(task); }}
              disabled={isRunning || taskInQueue}
              className={`text-[0.65rem] px-2.5 py-1 rounded-md font-semibold flex items-center gap-1 shadow-sm transition-all ${
                (isRunning || taskInQueue)
                  ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                  : "bg-emerald-100 border border-emerald-200 text-emerald-700 hover:bg-emerald-500 hover:text-white"
              }`}
              title={taskInQueue ? "Task này đã có trong hàng đợi" : "Thêm vào hàng đợi"}
            >
              <span>{taskInQueue ? "⏳" : "+"}</span>
              <span>{taskInQueue ? "Queued" : "Add to Queue"}</span>
            </button>
          )}

          {/* Non-queueable: "Open" navigate button */}
          {!isQueueable && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate(navigateTarget, task.linked_keyword, task.last_history_id); }}
              className="text-[0.65rem] px-2.5 py-1 rounded-md bg-sky-100 border border-sky-200 text-sky-700 hover:bg-sky-500 hover:text-white transition-all shadow-sm font-semibold flex items-center gap-1"
              title={`Open ${pageOpt.label}`}
            >
              {pageOpt.icon} Open {pageOpt.label}
            </button>
          )}

          {/* Result button: shown when crawl finished and has history */}
          {isQueueable && hasResult && (
            <button type="button"
              onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate(navigateTarget, task.linked_keyword, task.last_history_id); }}
              className="text-[0.65rem] px-2.5 py-1 rounded-md bg-amber-100 border border-amber-200 text-amber-700 hover:bg-amber-500 hover:text-white transition-all shadow-sm font-bold flex items-center gap-1"
              title="Xem kết quả"
            >
              📊 Result
            </button>
          )}
        </div>
      )}
    </div>
  );
}
