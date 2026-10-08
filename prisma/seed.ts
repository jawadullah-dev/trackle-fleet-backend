import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // ── 1. Super Admin ────────────────────────────────────────────────────────
  const superEmail = (
    process.env.SUPER_ADMIN_EMAIL ?? "super-admin@gmail.com"
  ).toLowerCase();
  const superPassword = process.env.SUPER_ADMIN_PASSWORD ?? "admin@123";
  const superName = process.env.SUPER_ADMIN_NAME ?? "Super Admin";
  const superHash = await bcrypt.hash(superPassword, 12);

  const superAdmin = await prisma.user.upsert({
    where: { email: superEmail },
    update: {
      name: superName,
      password: superHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      companyId: null,
    },
    create: {
      name: superName,
      email: superEmail,
      password: superHash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });
  console.log("✅ Super admin ready:", superAdmin.email);

  // ── 2. Company & Company Admin ──────────────────────────────────────────
  const company = await prisma.company.upsert({
    where: { id: "seed-company-default" },
    update: {
      name: "Apex Fleet Logistics",
      status: "ACTIVE",
      plan: "PRO",
    },
    create: {
      id: "seed-company-default",
      name: "Apex Fleet Logistics",
      status: "ACTIVE",
      plan: "PRO",
    },
  });
  console.log("✅ Company ready:", company.name);

  const adminEmail = "admin@gmail.com";
  const adminPassword = "admin@123";
  const adminHash = await bcrypt.hash(adminPassword, 12);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Admin",
      password: adminHash,
      role: "COMPANY_ADMIN",
      status: "ACTIVE",
      companyId: company.id,
    },
    create: {
      name: "Admin",
      email: adminEmail,
      password: adminHash,
      role: "COMPANY_ADMIN",
      status: "ACTIVE",
      companyId: company.id,
    },
  });
  console.log("✅ Company admin ready:", admin.email, "(Company:", company.name, ")");
  console.log("\n🎉 Seed complete — 0 dummy vehicles, clean and ready for real device tracking.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

