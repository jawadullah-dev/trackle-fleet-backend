import app from "../src/app";
import { ensureSuperAdmin } from "../src/services/auth.service";

// On Vercel, server.ts bootstrap() never runs — seed super admin here.
ensureSuperAdmin().catch((e) =>
  console.warn("[Vercel] Could not ensure super admin:", e?.message ?? e)
);

export default app;
