import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { API_BASE } from "../constants";
import { usePolling } from "../hooks/usePolling";

const TaskQueueContext = createContext(null);

/**
 * Provides queue state + the 5-second polling loop to its subtree.
 *
 * @param {Function} onTaskComplete  Optional callback fired (with no args) whenever
 *                                   the number of running tasks decreases — lets the
 *                                   parent reload the currently-selected project.
 */
export function TaskQueueProvider({ children, onTaskComplete }) {
  const [queue, setQueue] = useState([]);
  const [isWorkerRunning, setIsWorkerRunning] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);

  const prevQueueRef = useRef([]);
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Keep onTaskComplete stable in a ref so fetchQueue never needs to re-create.
  const onTaskCompleteRef = useRef(onTaskComplete);
  useEffect(() => { onTaskCompleteRef.current = onTaskComplete; }, [onTaskComplete]);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/queue`);
      if (!res.ok) return;
      const data = await res.json();
      const newTasks = data.tasks || [];

      // Detect when any running task has just finished.
      const wasRunning = prevQueueRef.current.filter(t => t.status === "running");
      if (wasRunning.length > 0) {
        const stillRunning = newTasks.filter(t => t.status === "running");
        if (stillRunning.length < wasRunning.length) {
          onTaskCompleteRef.current?.();
        }
      }

      prevQueueRef.current = newTasks;
      setQueue(newTasks);
      setIsWorkerRunning(data.running || false);
    } catch (e) {
      console.error("fetchQueue failed:", e);
    }
  }, []); // stable — uses refs internally

  // Initial fetch on mount + poll every 5 s.
  useEffect(() => { fetchQueue(); }, [fetchQueue]);
  usePolling(fetchQueue, 5000);

  // ── Queue mutations ────────────────────────────────────────────────────────

  const addToQueue = useCallback(async (task, projId, projName, phaseName) => {
    if (queueRef.current.some(q => q.taskId === task.id && (q.status === "pending" || q.status === "running"))) {
      alert("Task này đã có trong hàng đợi!");
      return;
    }

    const queueItem = {
      id: "task_" + Date.now(),
      title: task.title,
      keyword: task.linked_keyword,
      page: task.linked_page,
      imageData: task.linked_image_data || null,
      imageName: task.linked_image_name || null,
      projectId: projId,
      projectName: projName,
      phaseName: phaseName,
      taskId: task.id,
      status: "pending",
      ...(task.limit_per_source ? { limit_per_source: task.limit_per_source } : {}),
    };

    try {
      const res = await fetch(`${API_BASE}/api/projects/queue/add`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queueItem),
      });
      if (!res.ok) throw new Error("Thêm vào hàng đợi thất bại");
      fetchQueue();
    } catch (e) {
      alert(e.message);
    }
  }, [fetchQueue]);

  const retryQueueItem = useCallback(async (id) => {
    console.log("Retry requested for", id);
  }, []);

  const updateQueueLocal = useCallback(async (newTasks) => {
    const payload = Array.isArray(newTasks)
      ? { running: isWorkerRunning, tasks: newTasks }
      : newTasks;
    setQueue(payload.tasks);
    await fetch(`${API_BASE}/api/projects/queue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }, [isWorkerRunning]);

  const toggleWorker = useCallback(async (running) => {
    setIsWorkerRunning(running);
    await fetch(`${API_BASE}/api/projects/queue/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ running }),
    });
  }, []);

  const clearQueue = useCallback(async () => {
    setQueue([]);
    setIsWorkerRunning(false);
    await fetch(`${API_BASE}/api/projects/queue`, { method: "DELETE" });
  }, []);

  return (
    <TaskQueueContext.Provider value={{
      queue,
      isWorkerRunning,
      queueModalOpen,
      setQueueModalOpen,
      fetchQueue,
      addToQueue,
      retryQueueItem,
      updateQueueLocal,
      toggleWorker,
      clearQueue,
    }}>
      {children}
    </TaskQueueContext.Provider>
  );
}

/** Consume the TaskQueue context. Must be called inside a <TaskQueueProvider>. */
export function useTaskQueue() {
  const ctx = useContext(TaskQueueContext);
  if (!ctx) throw new Error("useTaskQueue must be used inside <TaskQueueProvider>");
  return ctx;
}
