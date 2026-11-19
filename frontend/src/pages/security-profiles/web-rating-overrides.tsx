import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiTag, FiCheckCircle, FiMinusCircle } from "react-icons/fi";
import { WebRatingMascot } from "../../components/ui/securityMascots";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import {
  DeviceListWebRatingOverrides, DeviceDeleteWebRatingOverride, DeviceUpdateWebRatingOverride,
  type WebRatingOverride,
} from "../../api/policyObject";
import { apiErrorDetail } from "../../api/errorText";

// Security Profiles ▸ Web Rating Overrides — "this URL is in THAT category, whatever FortiGuard
// says". The rating is a category ID; an unknown one is refused with -56. See the
// fortios-web-rating-override memory.

// Slot 8 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#5a7d9a", dark: "#7fa3c0" }; // slate blue

const categoryLabel = (r: WebRatingOverride) => {
  if (!r.category) return `Category ${r.rating || "—"}`;
  return r.category_group ? `${r.category_group} / ${r.category}` : r.category;
};

/**
 * The status cell, which is also the control that changes it.
 *
 * Status is a real field on the object (enable/disable), so the chip flips it rather than just
 * reporting it — the same PUT the edit form sends, with only `status` different.
 */
const StatusChip: React.FC<{
  row: WebRatingOverride;
  deviceId: number;
  canWrite: boolean;
  reload: () => void;
}> = ({ row, deviceId, canWrite, reload }) => {
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    try {
      setBusy(true);
      await DeviceUpdateWebRatingOverride(deviceId, row.url, {
        url: row.url, rating: row.rating, comment: row.comment, status: !row.status,
      });
      reload();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to change the status"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={!canWrite || busy}
      onClick={() => void toggle()}
      title={canWrite ? (row.status ? "Disable this override" : "Enable this override") : undefined}
      className={`chip ${row.status ? "chip-ok" : "chip-warn"} ${canWrite ? "cursor-pointer" : ""} disabled:opacity-60`}
    >
      {busy ? "…" : row.status
        ? <><FiCheckCircle size={10} /> Enabled</>
        : <><FiMinusCircle size={10} /> Disabled</>}
    </button>
  );
};

const WebRatingOverridesPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<WebRatingOverride>
      title="Web Rating Overrides"
      icon={<FiTag />}
      noun="Web Rating Override"
      subtitle="Put a URL in the category you say it belongs to, whatever FortiGuard rates it."
      hue={HUE}
      fetcher={DeviceListWebRatingOverrides}
      gridCols="30% 26% 120px 1fr"
      rowKey={(r) => r.url}
      matches={(r, q) =>
        r.url.toLowerCase().includes(q) ||
        categoryLabel(r).toLowerCase().includes(q) ||
        (r.comment || "").toLowerCase().includes(q)}
      crud={{
        onCreate: (d) => navigate(`/admin/security-profiles/web-rating-overrides/create?deviceId=${d.id}`),
        onEdit: (d, r) => navigate(
          `/admin/security-profiles/web-rating-overrides/edit?deviceId=${d.id}&url=${encodeURIComponent(r.url)}`),
        onDelete: (d, r) => DeviceDeleteWebRatingOverride(d.id, r.url),
        describe: (r) => r.url,
        deleteLabel: "DELETE WEB RATING OVERRIDE",
        mascot: WebRatingMascot,
      }}
      columns={[
        {
          key: "url",
          header: "URL",
          render: (r) => <span className="block truncate font-semibold" title={r.url}>{r.url}</span>,
        },
        {
          key: "category",
          header: "Category",
          render: (r) => (
            <span className="block truncate ink-3" title={categoryLabel(r)}>{categoryLabel(r)}</span>
          ),
        },
        {
          key: "status",
          header: "Status",
          render: (r, ctx) => (
            <StatusChip row={r} deviceId={ctx.device.id} canWrite={ctx.canWrite} reload={ctx.reload} />
          ),
        },
        { key: "comment", header: "Comment", render: (r) => <span className="ink-3">{r.comment || "—"}</span> },
      ]}
    />
  );
};

export default WebRatingOverridesPage;
