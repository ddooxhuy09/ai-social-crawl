export const PHASE_TEMPLATES = [
  { key: "crawl",        name: "Crawl by keyword",    icon: "🔍", color: "sky"    },
  { key: "crawl-image",  name: "Crawl by image",      icon: "🖼️", color: "violet" },
  { key: "hunt",         name: "Etsy Hunt keyword",   icon: "🔎", color: "amber"  },
  { key: "etsy-listing", name: "Etsy Listing AI",     icon: "🏷️", color: "rose"   },
];

export const STATUS_CFG = {
  done:        { col: "bg-emerald-500", ring: "ring-emerald-400", hdr: "bg-emerald-50 border-emerald-200", badge: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  in_progress: { col: "bg-sky-500",     ring: "ring-sky-400",     hdr: "bg-sky-50 border-sky-200",         badge: "text-sky-700 bg-sky-50 border-sky-200"             },
  pending:     { col: "bg-gray-300",    ring: "ring-gray-200",    hdr: "bg-white border-gray-200",         badge: "text-gray-500 bg-gray-50 border-gray-200"          },
};

export const STATUS_LABEL  = { done: "Xong", in_progress: "Đang làm", pending: "Chưa bắt đầu" };
export const STATUS_ORDER  = ["pending", "in_progress", "done"];

/** Page options for task linking.
 *  queueable: can be run via the queue runner (has an API to call)
 *  hasKeyword: shows a text input for keyword / listing name
 *  hasImage:   shows an image upload for the task
 *  keywordLabel: label shown next to the keyword input
 */
export const PAGE_OPTIONS = [
  { value: "crawl",        label: "Crawl by keyword",  icon: "🔍", hasKeyword: true,  keywordLabel: "Keyword",      queueable: true  },
  { value: "crawl-image",  label: "Crawl by image",    icon: "🖼️", hasKeyword: false, hasImage: true,               queueable: true  },
  { value: "hunt",         label: "Etsy Hunt keyword", icon: "🔎", hasKeyword: true,  keywordLabel: "Keyword",      queueable: false },
  { value: "etsy-listing", label: "Etsy Listing AI",   icon: "🏷️", hasKeyword: true,  keywordLabel: "Listing name", queueable: false },
];

export const makePhase = (tpl, status = "pending") => ({
  id: `${tpl.key}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  key: tpl.key,
  name: tpl.name,
  icon: tpl.icon,
  color: tpl.color,
  status,
  notes: "",
  tasks: [],
});

export const makeTask = (title) => ({
  id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  title,
  status: "todo",
  created_at: new Date().toISOString().slice(0, 16).replace("T", " "),
  notes: "",
  start_date: "",
  deadline: "",
});
