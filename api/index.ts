import app from "../src/app";
import { ensureSuperAdmin } from "../src/services/auth.service";

// On Vercel, server.ts bootstrap() never runs — seed super admin here.
ensureSuperAdmin().catch((e) =>
  console.warn("[Vercel] Could not ensure super admin:", e?.message ?? e)
);

// Warm-up GPS51 live data on cold start
import("../src/services/gps51-sync.service")
  .then((m) => m.triggerGps51SyncIfNeeded())
  .catch((e) =>
    console.warn("[Vercel] Could not run initial GPS51 sync:", e?.message ?? e)
  );

export default app;
