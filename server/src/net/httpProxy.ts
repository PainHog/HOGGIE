/**
 * Outbound HTTP(S) proxy wiring for dev environments.
 *
 * Node's global `fetch` (undici) ignores the HTTPS_PROXY env var, so in sandboxes whose
 * egress goes through a policy proxy (e.g. Claude Code cloud sessions) the server's calls to
 * Supabase would bypass the proxy and be denied. When HTTPS_PROXY is set we install undici's
 * EnvHttpProxyAgent as the global dispatcher so `fetch` (and the supabase-js client, which
 * uses `fetch`) honor HTTPS_PROXY / NO_PROXY.
 *
 * In production HTTPS_PROXY is unset, so this is a no-op and the server connects directly.
 * TLS trust for a re-terminating proxy is handled by NODE_EXTRA_CA_CERTS in the environment,
 * not here.
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import { log } from "../log.ts";

export function configureOutboundProxy(): void {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  log.info("outbound HTTPS routed through proxy", { proxy });
}
