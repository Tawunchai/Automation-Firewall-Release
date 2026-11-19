import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiMapPin, FiPlus, FiEdit2, FiTrash2 } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import {
  DeviceListAddresses, DeviceDeleteAddress,
  type AddressObject, type AddressType,
} from "../../api/policyObject";
import { FG_COLORS } from "../../lib/categoryColor";
import { apiErrorDetail } from "../../api/errorText";

/** Stable empty list. A `[]` literal is a fresh identity on every render, which would make the
 *  fetch effect re-run without end. */
const EMPTY: AddressObject[] = [];

// ─── Country code → name lookup (ISO 3166-1) ─────────────────────────────────
const COUNTRY_NAMES: Record<string, string> = {
  AF:"Afghanistan",AL:"Albania",DZ:"Algeria",AS:"American Samoa",AD:"Andorra",
  AO:"Angola",AI:"Anguilla",AG:"Antigua and Barbuda",AR:"Argentina",AM:"Armenia",
  AW:"Aruba",AU:"Australia",AT:"Austria",AZ:"Azerbaijan",BS:"Bahamas",BH:"Bahrain",
  BD:"Bangladesh",BB:"Barbados",BY:"Belarus",BE:"Belgium",BZ:"Belize",BJ:"Benin",
  BT:"Bhutan",BO:"Bolivia",BA:"Bosnia and Herzegovina",BW:"Botswana",BR:"Brazil",
  BN:"Brunei",BG:"Bulgaria",BF:"Burkina Faso",BI:"Burundi",CV:"Cabo Verde",
  KH:"Cambodia",CM:"Cameroon",CA:"Canada",KY:"Cayman Islands",CF:"Central African Republic",
  TD:"Chad",CL:"Chile",CN:"China",CO:"Colombia",KM:"Comoros",CG:"Congo",
  CD:"Congo, DR",CK:"Cook Islands",CR:"Costa Rica",CI:"Côte d'Ivoire",HR:"Croatia",
  CU:"Cuba",CY:"Cyprus",CZ:"Czechia",DK:"Denmark",DJ:"Djibouti",DM:"Dominica",
  DO:"Dominican Republic",EC:"Ecuador",EG:"Egypt",SV:"El Salvador",GQ:"Equatorial Guinea",
  ER:"Eritrea",EE:"Estonia",SZ:"Eswatini",ET:"Ethiopia",FJ:"Fiji",FI:"Finland",
  FR:"France",GA:"Gabon",GM:"Gambia",GE:"Georgia",DE:"Germany",GH:"Ghana",
  GR:"Greece",GL:"Greenland",GT:"Guatemala",GN:"Guinea",GW:"Guinea-Bissau",
  GY:"Guyana",HT:"Haiti",HN:"Honduras",HK:"Hong Kong",HU:"Hungary",IS:"Iceland",
  IN:"India",ID:"Indonesia",IR:"Iran",IQ:"Iraq",IE:"Ireland",IL:"Israel",IT:"Italy",
  JM:"Jamaica",JP:"Japan",JO:"Jordan",KZ:"Kazakhstan",KE:"Kenya",KI:"Kiribati",
  KP:"Korea, North",KR:"Korea, South",KW:"Kuwait",KG:"Kyrgyzstan",LA:"Laos",
  LV:"Latvia",LB:"Lebanon",LS:"Lesotho",LR:"Liberia",LY:"Libya",LI:"Liechtenstein",
  LT:"Lithuania",LU:"Luxembourg",MO:"Macao",MG:"Madagascar",MW:"Malawi",MY:"Malaysia",
  MV:"Maldives",ML:"Mali",MT:"Malta",MH:"Marshall Islands",MQ:"Martinique",
  MR:"Mauritania",MU:"Mauritius",MX:"Mexico",FM:"Micronesia",MD:"Moldova",
  MC:"Monaco",MN:"Mongolia",ME:"Montenegro",MA:"Morocco",MZ:"Mozambique",MM:"Myanmar",
  NA:"Namibia",NR:"Nauru",NP:"Nepal",NL:"Netherlands",NZ:"New Zealand",NI:"Nicaragua",
  NE:"Niger",NG:"Nigeria",MK:"North Macedonia",NO:"Norway",OM:"Oman",PK:"Pakistan",
  PS:"Palestine",PA:"Panama",PG:"Papua New Guinea",PY:"Paraguay",PE:"Peru",
  PH:"Philippines",PL:"Poland",PT:"Portugal",QA:"Qatar",RO:"Romania",RU:"Russia",
  RW:"Rwanda",SA:"Saudi Arabia",SN:"Senegal",RS:"Serbia",SC:"Seychelles",
  SL:"Sierra Leone",SG:"Singapore",SK:"Slovakia",SI:"Slovenia",SO:"Somalia",
  ZA:"South Africa",SS:"South Sudan",ES:"Spain",LK:"Sri Lanka",SD:"Sudan",
  SR:"Suriname",SE:"Sweden",CH:"Switzerland",SY:"Syria",TW:"Taiwan",TJ:"Tajikistan",
  TZ:"Tanzania",TH:"Thailand",TL:"Timor-Leste",TG:"Togo",TO:"Tonga",
  TT:"Trinidad and Tobago",TN:"Tunisia",TR:"Turkey",TM:"Turkmenistan",TV:"Tuvalu",
  UG:"Uganda",UA:"Ukraine",AE:"United Arab Emirates",GB:"United Kingdom",
  US:"United States",UY:"Uruguay",UZ:"Uzbekistan",VU:"Vanuatu",VE:"Venezuela",
  VN:"Vietnam",YE:"Yemen",ZM:"Zambia",ZW:"Zimbabwe",
};

// ─── Standard FortiGate color palette (index 0-32) ────────────────────────────

// ─── Type labels ──────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<AddressType, string> = {
  "ipmask":           "Subnet",
  "iprange":          "IP Range",
  "fqdn":             "FQDN",
  "wildcard-fqdn":    "Wildcard FQDN",
  "interface-subnet": "Interface Subnet",
  "geography":        "Geography",
  "mac":              "MAC Address",
  "dynamic":          "Dynamic",
};

const TYPE_GROUPS: Record<string, AddressType[]> = {
  "IP Range/Subnet":  ["ipmask", "iprange"],
  "FQDN":             ["fqdn", "wildcard-fqdn"],
  "Geography":        ["geography"],
  "MAC Address":      ["mac"],
  "Interface Subnet": ["interface-subnet"],
  "Dynamic":          ["dynamic"],
};

// ─── Badge config per type ────────────────────────────────────────────────────
const TYPE_BADGE: Record<string, { text: string; bg: string }> = {
  "ipmask":           { text: "IP",  bg: "#3b82f6" },
  "iprange":          { text: "RNG", bg: "#0891b2" },
  "fqdn":             { text: "FQ",  bg: "#8b5cf6" },
  "wildcard-fqdn":    { text: "WC",  bg: "#7c3aed" },
  "interface-subnet": { text: "IF",  bg: "#0e7490" },
  "geography":        { text: "GE",  bg: "#059669" },
  "mac":              { text: "MC",  bg: "#6b7280" },
  "dynamic":          { text: "DY",  bg: "#d97706" },
};

function getDetails(a: AddressObject): string {
  switch (a.type) {
    case "ipmask":           return a.subnet || "—";
    case "iprange":          return a.start_ip && a.end_ip ? `${a.start_ip} - ${a.end_ip}` : "—";
    case "fqdn":
    case "wildcard-fqdn":   return a.subnet || "—";
    case "interface-subnet": return a.interface || "—";
    case "geography":        return a.country ? (COUNTRY_NAMES[a.country] || a.country) : "—";
    case "mac":              return a.mac_addrs?.length ? a.mac_addrs.join(", ") : "—";
    default:                 return "—";
  }
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const AddressesTab: React.FC<{ toggle?: React.ReactNode }> = ({ toggle }) => {
  const { currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [deleteTarget, setDeleteTarget] = useState<AddressObject | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [search, setSearch]           = useState("");

  // strict: a firewall we could not read must NOT render as "no address objects" — an operator
  // who believes that goes on to create a duplicate, which the device then rejects with -5.
  const load = useCallback(
    (deviceId: number) => DeviceListAddresses(deviceId, { strict: true }),
    [],
  );
  const {
    data: addresses, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<AddressObject[]>(load, EMPTY);

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice) return;
    try {
      setDeleting(true);
      await DeviceDeleteAddress(selectedDevice.id, deleteTarget.name);
      message.success("Address deleted");
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to delete address"));
    } finally {
      setDeleting(false);
    }
  };

  const filtered = addresses.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    getDetails(a).toLowerCase().includes(search.toLowerCase()) ||
    (a.type || "").toLowerCase().includes(search.toLowerCase())
  );

  // Group by type category
  const grouped: Record<string, AddressObject[]> = {};
  for (const [groupName, types] of Object.entries(TYPE_GROUPS)) {
    const items = filtered.filter((a) => types.includes(a.type as AddressType));
    if (items.length > 0) grouped[groupName] = items;
  }
  const knownTypes = Object.values(TYPE_GROUPS).flat() as string[];
  const others = filtered.filter((a) => !knownTypes.includes(a.type));
  if (others.length > 0) grouped["Other"] = others;

  // col widths: colorBar | name | details | interface | type | ref | actions
  const COL_WIDTHS = ["12px", "1fr", "220px", "130px", "140px", "60px", "70px"];
  const GRID = COL_WIDTHS.join(" ");
  const HEADERS = ["", "NAME", "DETAILS", "INTERFACE", "TYPE", "REF.", ""];

  const total = filtered.length;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: search,
          Create New and the Addresses/Groups toggle. The total count it used to badge is not lost,
          just not repeated here — it's what the row count below already shows. */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search addresses…"
            className="h-8 rounded-[4px] border hairline surface-card pl-8 pr-3 text-[12px] outline-none w-44"
            onFocus={(e) => { e.currentTarget.style.borderColor = currentColor; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = ""; }} />
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3"
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        {isAdmin && selectedDevice && (
          <button
            onClick={() => navigate(`/admin/fw-addresses/create?deviceId=${selectedDevice.id}`)}
            className="btn btn-accent btn-sm">
            <FiPlus size={13} /> Create New
          </button>
        )}
        {toggle}
      </div>

      {/* ── Addresses Table ── */}
      <div className="panel panel-flush">

        {/* Fixed header */}
        {viewState(total) !== "empty" && viewState(total) !== "error" && (
          <div className="grid border-b hairline-2 px-4 py-2.5"
            style={{ gridTemplateColumns: GRID }}>
            {HEADERS.map((h, i) => (
              <span key={i} className="t-label">{h}</span>
            ))}
          </div>
        )}

        {/* Body */}
        <DeviceStates
          state={viewState(total)}
          from={selectedDevice?.name}
          noun="address object"
          icon={<FiMapPin size={18} />}
          error={error}
          onRetry={() => void fetchAll()}
          filtered={!!search}
        >
          {/* Scrollable — max ~12 rows */}
          <div style={{ maxHeight: "580px", overflowY: "auto" }}>
            {Object.entries(grouped).map(([groupName, items]) => (
              <React.Fragment key={groupName}>
                {/* Group header row */}
                <div className="group-band">
                  <span>{groupName}</span>
                  <span className="group-count">{items.length}</span>
                </div>

                {/* Address rows */}
                {items.map((a, idx) => {
                  const badge     = TYPE_BADGE[a.type]     ?? { text: "?", bg: "#94a3b8" };
                  const addrColor = a.color > 0 && a.color < FG_COLORS.length
                    ? FG_COLORS[a.color]
                    : null;

                  return (
                    <div
                      key={a.name}
                      className={`grid items-center px-4 py-3 surface-hover transition-colors ${idx < items.length - 1 ? "border-b hairline-2" : ""}`}
                      style={{ gridTemplateColumns: GRID }}>

                      {/* Color bar — like fw-services */}
                      <div className="flex items-center justify-center">
                        {addrColor
                          ? <div className="w-0.75 h-6 rounded-full" style={{ backgroundColor: addrColor }} />
                          : <div className="w-0.75 h-6" />}
                      </div>

                      {/* Name */}
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-6 w-7 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                          style={{ backgroundColor: badge.bg }}>
                          {badge.text}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-[13px] font-semibold ink truncate">{a.name}</p>
                            {a.builtin && (
                              <span className="shrink-0 rounded px-1 py-0.5 text-[9px] font-bold surface-sunken ink-3">
                                built-in
                              </span>
                            )}
                          </div>
                          {a.comment && (
                            <p className="text-[10px] ink-3 truncate">{a.comment}</p>
                          )}
                        </div>
                      </div>

                      {/* Details */}
                      <span className="font-mono text-[12px] ink-2 truncate pr-2">
                        {getDetails(a)}
                      </span>

                      {/* Interface */}
                      <span className="text-[12px] ink-2 truncate pr-2">
                        {a.interface || "—"}
                      </span>

                      {/* Type badge */}
                      <div>
                        <span className="inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold truncate"
                          style={{
                            borderColor: `${currentColor}30`,
                            color: currentColor,
                            backgroundColor: `${currentColor}08`,
                          }}>
                          {TYPE_LABELS[a.type as AddressType] || a.type}
                        </span>
                      </div>

                      {/* Ref count */}
                      <span className={`text-[12px] font-semibold ${a.ref_count > 0 ? "text-blue-600 dark:text-blue-400" : "ink-3"}`}>
                        {a.ref_count}
                      </span>

                      {/* Actions */}
                      <div className="flex items-center justify-end gap-1">
                        {isAdmin && !a.builtin && (
                          <>
                            <button
                              onClick={() => navigate(
                                `/admin/fw-addresses/edit?deviceId=${selectedDevice!.id}&name=${encodeURIComponent(a.name)}`
                              )}
                              className="btn-icon">
                              <FiEdit2 size={13} />
                            </button>
                            <button onClick={() => setDeleteTarget(a)}
                              className="btn-icon btn-icon--danger">
                              <FiTrash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </DeviceStates>
      </div>

      {/* Count footer */}
      {viewState(total) === "rows" && (
        <p className="text-right text-[11px] ink-3">
          {search ? `${total} of ${addresses.length}` : addresses.length}{" "}
          address{addresses.length !== 1 ? "es" : ""}
        </p>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDeleteModal
          eyebrow="DELETE ADDRESS"
          title="Delete from device?"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        >
          Address <strong className="ink">"{deleteTarget.name}"</strong> will be permanently removed
          from {selectedDevice?.name}.
          {deleteTarget.ref_count > 0 && (
            <p className="mt-1.5 mb-0 text-amber-600 dark:text-amber-400">
              ⚠ Used in {deleteTarget.ref_count} firewall policy(ies).
            </p>
          )}
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default AddressesTab;
