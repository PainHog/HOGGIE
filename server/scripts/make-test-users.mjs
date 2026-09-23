/**
 * Dev-only: create two confirmed Supabase test accounts so you can log in without email.
 * Run from the repo root:  node server/scripts/make-test-users.mjs
 *
 * Uses the service_role key (admin API) and email_confirm so no inbox is needed.
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { fileURLToPath } from "node:url";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });
if (process.env.HTTPS_PROXY) setGlobalDispatcher(new EnvHttpProxyAgent());

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env first.");
  process.exit(1);
}

const supa = createClient(url, key, { auth: { persistSession: false } });

const users = [
  ["tester1@hoggie.local", "ghoulish1"],
  ["tester2@hoggie.local", "ghoulish2"],
];

for (const [email, password] of users) {
  const { data, error } = await supa.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error && !/already been registered|already exists/i.test(error.message)) {
    console.error("FAIL", email, error.message);
  } else {
    console.log("ok  ", email, "/", password, data?.user?.id ? `(${data.user.id})` : "(exists)");
  }
}
console.log("\nLog in with these in the test client:");
console.log("  TEST_EMAIL=tester1@hoggie.local TEST_PASSWORD=ghoulish1 npm run test-client");
