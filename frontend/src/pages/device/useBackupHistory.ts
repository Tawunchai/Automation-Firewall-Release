import { useMemo, useState } from "react";
import { message } from "../../components/ui/toast";
import { confirm } from "../../components/ui/confirm";
import {
  ListJobs, ListDeviceBackups, GetBackupContent, DownloadBackup, DeleteBackup,
  type NetworkDevice, type AutomationJob, type ConfigBackup, type BackupContent,
} from "../../api/device";
import { formatDateTime } from "../../lib/datetime";

/** A stored config is shown at most this many lines; past that the viewer offers the download. */
export const VIEWER_MAX_LINES = 2000;

/**
 * The backup history drawer: one device's jobs and stored configurations, the viewer for a single
 * snapshot, and the comparison of two.
 *
 * It is the page's second half and shares nothing with the first but a device — the drawer reads,
 * the table writes — so it keeps its own state rather than adding fourteen more fields to the
 * page's own.
 */
export function useBackupHistory() {
  const [drawerDevice, setDrawerDevice] = useState<NetworkDevice | null>(null);
  const [drawerJobs, setDrawerJobs] = useState<AutomationJob[]>([]);
  const [drawerBackups, setDrawerBackups] = useState<ConfigBackup[]>([]);

  const [viewer, setViewer] = useState<BackupContent | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  const [compareA, setCompareA] = useState<ConfigBackup | null>(null);
  const [compareB, setCompareB] = useState<ConfigBackup | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareLoadingA, setCompareLoadingA] = useState(false);
  const [compareLoadingB, setCompareLoadingB] = useState(false);
  const [compareContentA, setCompareContentA] = useState("");
  const [compareContentB, setCompareContentB] = useState("");
  const [compareDiff, setCompareDiff] = useState("");

  const viewerPreview = useMemo(() => {
    const full = viewer?.content || "";
    if (!full) return { text: "", truncated: false };
    const lines = full.split("\n");
    if (lines.length <= VIEWER_MAX_LINES) return { text: full, truncated: false };
    return { text: lines.slice(0, VIEWER_MAX_LINES).join("\n"), truncated: true };
  }, [viewer]);

  const openHistory = async (d: NetworkDevice) => {
    setDrawerDevice(d);
    try {
      const [jobs, backups] = await Promise.all([ListJobs(d.id), ListDeviceBackups(d.id)]);
      setDrawerJobs(jobs);
      setDrawerBackups(backups);
    } catch {
      message.error("Failed to load history");
    }
  };

  const viewBackup = async (b: ConfigBackup) => {
    setViewerLoading(true);
    setViewer({ id: b.id } as BackupContent);
    try {
      setViewer(await GetBackupContent(b.id));
    } catch {
      message.error("Failed to load config content");
      setViewer(null);
    } finally {
      setViewerLoading(false);
    }
  };

  const downloadBackup = async (b: ConfigBackup) => {
    const fname = `${drawerDevice?.name || "device"}_backup-${b.id}.conf`;
    try {
      await DownloadBackup(b.id, fname);
    } catch {
      message.error("Download failed");
    }
  };

  // Remove one stored backup. The row is dropped from the drawer immediately on success so the list
  // reflects the device without a round trip; the server keeps the git history untouched.
  const deleteBackup = async (b: ConfigBackup) => {
    if (!(await confirm({
      title: `Delete backup #${b.id}?`,
      content: "This stored configuration snapshot is removed. The device itself is not touched, and this cannot be undone.",
      okText: "Delete",
    }))) return;
    try {
      await DeleteBackup(b.id);
      setDrawerBackups((rows) => rows.filter((x) => x.id !== b.id));
      setCompareA((a) => (a?.id === b.id ? null : a));
      setCompareB((c) => (c?.id === b.id ? null : c));
      message.success(`Backup #${b.id} deleted`);
    } catch {
      message.error("Delete failed");
    }
  };

  const openCompare = async (a: ConfigBackup, b: ConfigBackup) => {
    setCompareA(a); setCompareB(b); setCompareOpen(true); setCompareDiff("");
    setCompareLoadingA(true); setCompareLoadingB(true);
    const [ca, cb] = await Promise.all([
      GetBackupContent(a.id).finally(() => setCompareLoadingA(false)),
      GetBackupContent(b.id).finally(() => setCompareLoadingB(false)),
    ]);
    setCompareContentA(ca.content || "");
    setCompareContentB(cb.content || "");
    const linesA = (ca.content || "").split("\n");
    const linesB = (cb.content || "").split("\n");
    const diff: string[] = [
      `--- Backup #${a.id} (${formatDateTime(a.created_at)})`,
      `+++ Backup #${b.id} (${formatDateTime(b.created_at)})`, "",
    ];
    const setA = new Set(linesA); const setB = new Set(linesB);
    linesA.forEach((l) => { if (!setB.has(l)) diff.push(`- ${l}`); });
    linesB.forEach((l) => { if (!setA.has(l)) diff.push(`+ ${l}`); });
    setCompareDiff(diff.join("\n"));
  };

  return {
    drawerDevice, setDrawerDevice, drawerJobs, drawerBackups, openHistory,
    viewer, setViewer, viewerLoading, viewerPreview, viewBackup, downloadBackup, deleteBackup,
    compareA, compareB, compareOpen, setCompareOpen, compareLoadingA, compareLoadingB,
    compareContentA, compareContentB, compareDiff, openCompare,
  };
}
