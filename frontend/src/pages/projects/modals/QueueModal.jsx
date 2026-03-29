import React from "react";
import { Button } from "../../../components/ui/button";

const STATUS_ICON = { pending: "⏳", running: "🔄", done: "✅", error: "❌" };

export default function QueueModal({
  open, onClose, queue, isWorkerRunning, onToggleRunning, isQueueRunning, currentQueueTask, onClear, onUpdate, onRetry
}) {
  const [activeTab, setActiveTab] = React.useState("active");
  const [history, setHistory] = React.useState([]);
  const [loadingHistory, setLoadingHistory] = React.useState(false);

  React.useEffect(() => {
    if (open && activeTab === "history") {
      fetchHistory();
    }
  }, [open, activeTab]);

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/projects/history");
      if (res.ok) setHistory(await res.json());
    } catch (e) {
      console.error("Failed to fetch global history:", e);
    } finally {
      setLoadingHistory(false);
    }
  };
  if (!open) return null;

  const handleRemove = (id) => onUpdate(queue.filter(q => q.id !== id));

  const handleMove = (idx, direction) => {
    const item = queue[idx];
    if (item.status === "running" || item.status === "done") return;
    const next = [...queue];
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= next.length) return;
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    onUpdate(next);
  };

  const pendingCount = queue.filter(q => q.status === "pending").length;
  const errorCount = queue.filter(q => q.status === "error").length;

  return (
    <div
      className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[550px] max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex flex-col border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center justify-between px-6 py-5">
            <div>
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                📋 Task Management
              </h3>
              <p className="text-[12px] text-gray-500">
                Track active tasks and execution history.
              </p>
            </div>
            <button type="button" onClick={onClose}
              className="text-gray-400 hover:text-gray-900 transition-colors text-2xl cursor-pointer">×</button>
          </div>
          
          {/* Tabs */}
          <div className="flex px-6 gap-6">
            <button
              onClick={() => setActiveTab("active")}
              className={`pb-3 text-sm font-bold transition-all border-b-2 ${
                activeTab === "active" ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              Active Queue ({queue.length})
            </button>
            <button
              onClick={() => setActiveTab("history")}
              className={`pb-3 text-sm font-bold transition-all border-b-2 ${
                activeTab === "history" ? "border-emerald-600 text-emerald-600" : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              Global History
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1 p-5 flex flex-col gap-3">
          {activeTab === "active" ? (
            queue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-300 gap-3">
                <span className="text-5xl opacity-20">🍃</span>
                <p className="text-[13px]">No active tasks.</p>
              </div>
            ) : (
              queue.map((item, idx) => {
                const isRunning = item.status === "running";
                const isDone = item.status === "done";
                const isError = item.status === "error";
                const isPending = item.status === "pending";
                const isFirst = idx === 0;
                const isLast = idx === queue.length - 1;
                const canMove = isPending;

                return (
                  <div key={item.id} className={`group flex flex-col gap-2 p-4 rounded-xl border transition-all ${
                    isRunning ? "border-emerald-300 bg-emerald-50 shadow-sm" :
                    isDone    ? "border-gray-100 bg-gray-50 opacity-60" :
                    isError   ? "border-red-300 bg-red-50" :
                                "border-gray-200 bg-white hover:border-gray-300"
                  }`}>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          disabled={!canMove || isFirst}
                          onClick={() => handleMove(idx, -1)}
                          className="text-gray-300 hover:text-gray-600 disabled:opacity-0 cursor-pointer p-0.5 text-xs"
                        >▲</button>
                        <button
                          disabled={!canMove || isLast}
                          onClick={() => handleMove(idx, 1)}
                          className="text-gray-300 hover:text-gray-600 disabled:opacity-0 cursor-pointer p-0.5 text-xs"
                        >▼</button>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`text-[13px] font-bold truncate ${isRunning ? "text-emerald-900" : isError ? "text-red-800" : "text-gray-900"}`}>
                            {item.title}
                          </p>
                          {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping shrink-0" />}
                        </div>
                        <p className="text-[11px] text-gray-500 flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span className="font-medium text-gray-700 uppercase tracking-tight">{item.projectName}</span>
                          <span className="opacity-30">/</span>
                          <span className="truncate">{item.phaseName}</span>
                          {item.keyword && (
                            <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded text-[10px]">
                              🔍 {item.keyword}
                            </span>
                          )}
                        </p>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {(isPending || isError) && (
                          <button
                            onClick={() => handleRemove(item.id)}
                            className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 cursor-pointer"
                          >🗑️</button>
                        )}
                        <span className="text-base">{STATUS_ICON[item.status] || "⏳"}</span>
                      </div>
                    </div>

                    {isError && item.errorMessage && (
                      <div className="ml-7 flex items-start justify-between gap-3 bg-red-100/60 rounded-lg px-3 py-2">
                        <p className="text-[11px] text-red-700 leading-snug flex-1">
                          {item.errorMessage}
                        </p>
                        {onRetry && (
                          <button
                            onClick={() => onRetry(item.id)}
                            className="text-[11px] font-semibold text-red-700 bg-white border border-red-200 px-2.5 py-1 rounded-lg hover:bg-red-50 transition-colors shrink-0 cursor-pointer"
                          >
                            ↺ Retry
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            loadingHistory ? (
              <div className="flex items-center justify-center py-20 text-gray-400 gap-2">
                <span className="animate-spin">🔄</span> Loading history...
              </div>
            ) : history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-300 gap-3">
                <span className="text-5xl opacity-20">📜</span>
                <p className="text-[13px]">History is empty.</p>
              </div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="p-3 border border-gray-100 rounded-lg bg-gray-50/50 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold text-gray-800 truncate">{item.title}</p>
                    <p className="text-[10px] text-gray-500">
                      {item.projectName} · {item.updatedAt || item.createdAt}
                    </p>
                  </div>
                  <span className="text-sm">{STATUS_ICON[item.status] || "✅"}</span>
                </div>
              ))
            )
          )}
        </div>

        {/* Footer */}
        {queue.length > 0 && activeTab === "active" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/50 gap-4">
            <Button variant="outline" size="sm" onClick={onClear}
              className="text-red-600 border-red-100 hover:bg-red-50 hover:text-red-700">
              🗑️ Clear Queue
            </Button>
            <div className="flex items-center gap-2">
              <Button 
                variant={isWorkerRunning ? "outline" : "default"} 
                size="sm"
                onClick={() => onToggleRunning(!isWorkerRunning)}
                className={isWorkerRunning 
                  ? "border-amber-200 text-amber-700 hover:bg-amber-50" 
                  : "bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-100"
                }
              >
                {isWorkerRunning ? "⏸️ Pause Queue" : "▶️ Run Search"}
              </Button>

              {isQueueRunning && (
                <div className="flex items-center gap-3 text-emerald-700 bg-emerald-50 px-4 py-2 rounded-full border border-emerald-100 shrink-0">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[13px] font-bold truncate max-w-[150px]">
                    Worker Active
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
