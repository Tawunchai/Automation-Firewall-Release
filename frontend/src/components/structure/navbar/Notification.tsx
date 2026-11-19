import React, { useState, useMemo } from "react";
import { MdOutlineCancel } from "react-icons/md";
import {
  FiBell, FiActivity, FiAlertTriangle, FiCheckCircle,
  FiSlash, FiRotateCw, FiClock, FiSearch, FiX, FiTrash2,
} from "react-icons/fi";
import { useStateContext } from "../../../contexts/ProviderContext.logic";

type StatusKey = "Update Completed" | "No Update" | "Already Running" | "Update Failed" | "Status Notification";

type NotificationItem = {
  id: number;
  subject: string;
  description: string;
  status: StatusKey;
  datetime: string;
};

const MOCK_DATA: NotificationItem[] = [
  { id: 1, subject: "System Update Completed", description: "The latest system update was applied successfully.", status: "Update Completed", datetime: "2026-05-28T08:30:00Z" },
  { id: 2, subject: "No Changes Detected", description: "Routine check found no changes since the last run.", status: "No Update", datetime: "2026-05-28T07:15:00Z" },
  { id: 3, subject: "Background Job Running", description: "A scheduled background task is currently in progress.", status: "Already Running", datetime: "2026-05-27T23:45:00Z" },
  { id: 4, subject: "Job Failed", description: "An automated job could not complete. Please check logs.", status: "Update Failed", datetime: "2026-05-27T21:10:00Z" },
  { id: 5, subject: "System Alert", description: "High resource usage detected. Consider scaling up.", status: "Status Notification", datetime: "2026-05-27T18:00:00Z" },
  { id: 6, subject: "Weekly Summary Ready", description: "Your weekly activity summary report is now available.", status: "Update Completed", datetime: "2026-05-27T09:00:00Z" },
];

type StatusMeta = { icon: React.ReactNode; dot: string; label: string; labelCls: string };

const getStatusMeta = (currentColor: string): Record<StatusKey, StatusMeta> => ({
  "Update Completed": {
    icon: <FiCheckCircle className="text-[13px]" />,
    dot: "bg-emerald-500",
    label: "Completed",
    labelCls: "text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 dark:text-emerald-400 dark:bg-emerald-500/12 dark:ring-emerald-500/20",
  },
  "No Update": {
    icon: <FiSlash className="text-[13px]" />,
    dot: "dot-muted",
    label: "No Update",
    labelCls: "chip",
  },
  "Already Running": {
    icon: <FiRotateCw className="text-[13px]" />,
    dot: "bg-amber-400",
    label: "Running",
    labelCls: "text-amber-700 bg-amber-50 ring-1 ring-amber-200 dark:text-amber-400 dark:bg-amber-500/12 dark:ring-amber-500/20",
  },
  "Update Failed": {
    icon: <FiAlertTriangle className="text-[13px]" />,
    dot: "bg-rose-500",
    label: "Failed",
    labelCls: "text-rose-700 bg-rose-50 ring-1 ring-rose-200 dark:text-rose-400 dark:bg-rose-500/12 dark:ring-rose-500/20",
  },
  "Status Notification": {
    icon: <FiActivity className="text-[13px]" style={{ color: currentColor }} />,
    dot: "",
    label: "Alert",
    labelCls: "",
  },
});

const formatDateTime = (dateString?: string) => {
  if (!dateString) return "-";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
};

const Notification: React.FC = () => {
  const { currentColor, setIsClicked } = useStateContext();

  const [items, setItems] = useState<NotificationItem[]>(MOCK_DATA);
  const [open, setOpen] = useState(true);
  const [searchText, setSearchText] = useState("");

  const accentGradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))`;
  const statusMeta = getStatusMeta(currentColor);

  const handleDelete = (id: number) => setItems((prev) => prev.filter((r) => r.id !== id));

  const close = () => {
    setIsClicked((prev) => ({ ...prev, notification: false }));
    setOpen(false);
  };

  const visibleItems = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    if (!keyword) return items;
    return items.filter(
      (item) =>
        item.subject.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword) ||
        item.status.toLowerCase().includes(keyword)
    );
  }, [items, searchText]);

  if (!open) return null;

  return (
    <>
      <div role="presentation" className="fixed inset-0 z-40" onClick={close} />

      <div
        data-allow-popup-scroll="true"
        className={[
          "fixed right-4 top-17 z-50",
          "w-72 overflow-hidden",
          "rounded-[4px] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.18)]",
          "border hairline surface-card",
          "  dark:shadow-[0_8px_30px_-8px_rgba(0,0,0,0.55)]",
        ].join(" ")}
      >
        {/* Top accent bar — accent color */}
        <div className="h-0.5 w-full" style={{ background: accentGradient }} />

        {/* Header */}
        <div className="flex items-center justify-between border-b hairline-2 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-white"
              style={{ background: accentGradient }}
            >
              <FiBell className="text-[12px]" />
            </span>
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold ink">Notifications</p>
              <span
                className="inline-flex h-4 items-center rounded-full px-1.5 text-[9px] font-bold text-white"
                style={{ backgroundColor: currentColor }}
              >
                {visibleItems.length}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 transition surface-hover hover-ink focus:outline-none"
          >
            <MdOutlineCancel className="text-[15px]" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b hairline-2 px-3 py-2">
          <div className="flex items-center gap-2 rounded-[4px] border hairline surface-sunken px-2.5 py-1.5">
            <FiSearch className="shrink-0 text-[11px] ink-3" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search..."
              className="w-full bg-transparent text-[11px] ink outline-none placeholder-ink"
            />
            {searchText && (
              <button type="button" onClick={() => setSearchText("")} className="shrink-0 ink-3 hover-ink focus:outline-none">
                <FiX className="text-[10px]" />
              </button>
            )}
          </div>
        </div>

        {/* List */}
        <div className="space-y-0.5 p-1.5" style={{ maxHeight: 320, overflowY: "auto" }}>
          {visibleItems.length === 0 ? (
            <div className="py-8 text-center text-[11px] ink-3">
              No notifications found
            </div>
          ) : (
            visibleItems.map((item) => {
              const meta = statusMeta[item.status];
              const isAccentStatus = item.status === "Status Notification";
              return (
                <div
                  key={item.id}
                  className="group flex items-start gap-2.5 rounded-[4px] border hairline-2 surface-sunken p-2.5 transition-colors surface-hover"
                >
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px]"
                    style={isAccentStatus
                      ? { backgroundColor: `${currentColor}15`, color: currentColor }
                      : { backgroundColor: "#f1f5f9", color: "#64748b" }}
                  >
                    {meta.icon}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-1">
                      <p className="truncate text-[11.5px] font-medium ink">
                        {item.subject}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id)}
                        className="shrink-0 ink-3 opacity-0 transition-all hover:text-rose-500 group-hover:opacity-100 dark:hover:text-rose-400 focus:outline-none"
                      >
                        <FiTrash2 className="text-[11px]" />
                      </button>
                    </div>

                    <p className="mt-0.5 text-[10px] leading-relaxed ink-2 line-clamp-1">
                      {item.description}
                    </p>

                    <div className="mt-1.5 flex items-center gap-1.5">
                      {isAccentStatus ? (
                        <span
                          className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1"
                          style={{ color: currentColor, backgroundColor: `${currentColor}12`, outline: `1px solid ${currentColor}30` }}
                        >
                          <span className="mr-1 h-1 w-1 rounded-full" style={{ backgroundColor: currentColor }} />
                          {meta.label}
                        </span>
                      ) : (
                        <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${meta.labelCls}`}>
                          <span className={`mr-1 h-1 w-1 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </span>
                      )}
                      <span className="flex items-center gap-0.5 text-[9px] ink-3">
                        <FiClock className="text-[8px]" />
                        {formatDateTime(item.datetime)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="border-t hairline-2 px-3 py-2">
            <button
              type="button"
              onClick={() => setItems([])}
              className="w-full rounded-[4px] py-1.5 text-[10px] font-medium ink-3 transition surface-hover hover-ink focus:outline-none"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default Notification;
