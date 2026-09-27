import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 5000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  jwtSecret: process.env.JWT_SECRET ?? "trackfleet-dev-secret",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  clientUrl: process.env.CLIENT_URL ?? "http://localhost:3000",
  superAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? "super-admin@gmail.com",
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD ?? "admin@123",
  superAdminName: process.env.SUPER_ADMIN_NAME ?? "Super Admin",
};
