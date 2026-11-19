import { useCallback, useEffect, useRef, useState } from "react";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { message } from "../../components/ui/toast";
import {
  ListDevices, TriggerBackup, GetJob, ListJobs, BatchBackup, ResetJob, GetWorkerHealth,
  type NetworkDevice, type AutomationJob, type WorkerHealth,
} from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

/**
 * The inventory this page shows, and everything that makes a backup job happen on it.
 *
 * These belong together because they are one loop: a backup is triggered, a job id comes back, a
 * poller watches it, and the row's chip follows the job to SUCCESS or FAILED. Pulled out of the
 * page because the page is also a table, a filter bar, a history drawer, a diff viewer and four
 * modals — and the polling is the part that has to be right even while all of that re-renders.
 */
export function useDeviceJobs() {
  // Re-reads the console-wide device selection (contexts/DeviceContext) after this page changes
  // the inventory. See fetchDevices for why that matters.
  const { reload: reloadSelection } = useSelectedDevice();

  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [loading, setLoading] = useState(true);

  const [jobByDevice, setJobByDevice] = useState<Record<number, AutomationJob>>({});
  const pollers = useRef<Record<number, ReturnType<typeof setInterval>>>({});
  const [batchLoading, setBatchLoading] = useState(false);
  const [workerHealth, setWorkerHealth] = useState<WorkerHealth | null>(null);

  // The device_id whose stuck job is being reset, so its row can show the spinner.
  const [resetting, setResetting] = useState<number | null>(null);

  // This page keeps its own copy of the inventory because it shows columns the shared selection
  // does not carry (backup state, running jobs, reachability). But it is also the ONLY place that
  // adds or removes a device, so every refresh here has to refresh the console-wide selection too
  // — otherwise the navbar picker keeps offering a device that no longer exists, and every device
  // page then queries a dead id and (because a lenient read returns []) renders as "empty".
  const fetchDevices = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await ListDevices());
      await reloadSelection();
    } catch {
      message.error("Failed to load devices");
    } finally {
      setLoading(false);
    }
  }, [reloadSelection]);

  const checkWorkerHealth = useCallback(async () => {
    try {
      setWorkerHealth(await GetWorkerHealth());
    } catch {
      setWorkerHealth({ online: false, last_seen: null, message: "Cannot reach backend" });
    }
  }, []);

  // โหลด active jobs (QUEUED/RUNNING) ทันทีตอนหน้าโหลด
  // ป้องกันกรณีที่ job ค้างอยู่ใน DB แต่ผู้ใช้ไม่รู้เพราะ refresh หน้า
  const loadActiveJobs = useCallback(async () => {
    try {
      const jobs = await ListJobs();
      const byDevice: Record<number, AutomationJob> = {};
      jobs.forEach((j) => {
        if ((j.status === "QUEUED" || j.status === "RUNNING") && j.network_device_id) {
          byDevice[j.network_device_id] = j;
        }
      });
      if (Object.keys(byDevice).length > 0) {
        setJobByDevice(byDevice);
        Object.entries(byDevice).forEach(([deviceId, job]) => {
          pollJob(Number(deviceId), job.id);
        });
      }
    } catch { /* silent — not critical */ }
  }, []);

  useEffect(() => {
    fetchDevices();
    loadActiveJobs();
    checkWorkerHealth();
    // The ref is read HERE, not in the cleanup: a cleanup that reads `pollers.current` reads
    // whatever the ref holds when it runs, which need not be the timers this effect started.
    const running = pollers.current;
    return () => { Object.values(running).forEach((p) => clearInterval(p)); };
  }, [fetchDevices, loadActiveJobs, checkWorkerHealth]);

  // Add/Edit open a right-side drawer (DeviceFormDrawer) over the inventory list — the shape
  // FortiGate uses for its own create/edit panels, and the one the SNMP page already mirrors — so
  // the list stays in view and refreshes the instant the drawer saves. `formDevice` is null for Add
  // and the target row for Edit.

  const pollJob = (deviceId: number, jobId: number) => {
    if (pollers.current[deviceId]) clearInterval(pollers.current[deviceId]);
    let attempts = 0;
    const MAX_ATTEMPTS = 90;
    const stop = () => { clearInterval(pollers.current[deviceId]); delete pollers.current[deviceId]; };
    pollers.current[deviceId] = setInterval(async () => {
      attempts += 1;
      try {
        const job = await GetJob(jobId);
        setJobByDevice((m) => ({ ...m, [deviceId]: job }));
        if (job.status === "SUCCESS" || job.status === "FAILED") {
          stop();
          if (job.status === "SUCCESS") message.success(`Backup successful: ${job.result}`);
          else message.error(`Backup failed: ${job.result}`);
        } else if (attempts >= MAX_ATTEMPTS) {
          stop();
          message.warning("Backup is taking too long — stopped monitoring (check history later)");
        }
      } catch { stop(); }
    }, 2000);
  };

  const backup = async (d: NetworkDevice) => {
    try {
      const { job_id } = await TriggerBackup(d.id);
      message.info(`Backup triggered for ${d.name} (job #${job_id})`);
      setJobByDevice((m) => ({ ...m, [d.id]: { id: job_id, status: "QUEUED" } as AutomationJob }));
      pollJob(d.id, job_id);
    } catch (e) {
      message.error(apiErrorDetail(e, "Failed to trigger backup"));
    }
  };

  const resetAndRetry = async (d: NetworkDevice, job: AutomationJob) => {
    setResetting(d.id);
    try {
      await ResetJob(job.id);
      message.info(`Reset job #${job.id} — triggering a fresh backup…`);
      setJobByDevice((m) => { const n = { ...m }; delete n[d.id]; return n; });
      await backup(d);
    } catch (e) {
      message.error(apiErrorDetail(e, "The reset failed"));
    } finally {
      setResetting(null);
    }
  };

  const batchBackup = async () => {
    setBatchLoading(true);
    try {
      const res = await BatchBackup();
      message.success(
        `Batch backup queued: ${res.queued} device(s)` +
        (res.unreachable ? ` · ${res.unreachable} unreachable` : "") +
        (res.skipped ? ` · ${res.skipped} already running` : "")
      );
    } catch (e) {
      message.error(apiErrorDetail(e, "Batch backup failed"));
    } finally {
      setBatchLoading(false);
    }
  };

  return {
    devices, loading, fetchDevices,
    jobByDevice, setJobByDevice, pollJob, backup,
    workerHealth, checkWorkerHealth,
    batchLoading, batchBackup,
    resetting, resetAndRetry,
  };
}
