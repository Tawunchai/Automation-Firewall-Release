import axios, { type InternalAxiosRequestConfig } from "axios";
import { withVDOM } from "./deviceRequest";
import { responseError, responseStatus } from "./errorText";

const envBackendUrl = import.meta.env.VITE_BACKEND_URL;

// default "/api" = same-origin ( nginx reverse proxy  prod / vite proxy  dev)
//  host  backend   localhost:9000
export const apiUrl: string = envBackendUrl || "/api";

export const defaultHeaders = {
  "Content-Type": "application/json",
  "ngrok-skip-browser-warning": "true",
};

export const baseApi = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  timeout: 15000,
  headers: defaultHeaders,
});

// AI calls need much longer timeout — Claude can take 30-90s for complex responses
export const aiApi = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  timeout: 120000, // 2 minutes
  headers: defaultHeaders,
});

// Diagnostics run a command ON the firewall and wait for it to finish, which the default 15s
// budget cannot cover: a traceroute is 32 hops × 3 probes and a run through non-answering hops
// measured over 30s on the lab device, while the support bundle is a ~570 KB download the device
// assembles on demand. Under baseApi those would abort in the browser while the firewall was still
// working — and an aborted request looks exactly like a dead device.
export const diagApi = axios.create({
  baseURL: apiUrl,
  withCredentials: true,
  timeout: 150000, // comfortably past the backend's own 100s traceroute ceiling
  headers: defaultHeaders,
});

// ── Shared REQUEST interceptor: the selected virtual domain ───────────────
//
// A FortiGate can be split into VDOMs — separate tenants with their own policy tables and objects
// on one box — and every device route now accepts ?vdom=<name>. This is the single place it is
// applied, for the same reason buildClient is the single place the server reads it: the URLs are
// built by ~200 helpers across a dozen api/ modules, and the one that forgot would silently read
// another tenant's rule base while the screen said otherwise.
//
// See api/deviceRequest's withVDOM for what it does and does not touch.
const vdomInterceptor = (config: InternalAxiosRequestConfig) => {
  if (config.url) config.url = withVDOM(config.url);
  return config;
};

baseApi.interceptors.request.use(vdomInterceptor);
aiApi.interceptors.request.use(vdomInterceptor);
diagApi.interceptors.request.use(vdomInterceptor);

/** The URL a rejected request was sent to, for deciding whether a 401 is the session expiring. */
const requestUrl = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "config" in error) {
    const url = (error as { config?: { url?: unknown } }).config?.url;
    if (typeof url === "string") return url;
  }
  return "";
};

// ── Shared response interceptor ───────────────────────────────────────────
const responseInterceptor = (error: unknown) => {
  const status = responseStatus(error);
  const url = requestUrl(error);
  if (status === 401 && !url.includes("/auth/me")) {
    window.dispatchEvent(new CustomEvent("session:expired"));
  }
  if (status === 503 && responseError(error) === "system is under maintenance" && !url.includes("/auth/login")) {
    window.dispatchEvent(new CustomEvent("session:maintenance"));
  }
  return Promise.reject(error);
};

baseApi.interceptors.response.use((r) => r, responseInterceptor);
aiApi.interceptors.response.use((r) => r, responseInterceptor);
diagApi.interceptors.response.use((r) => r, responseInterceptor);
