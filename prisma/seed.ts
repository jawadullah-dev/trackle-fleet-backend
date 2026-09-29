import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Rough offsets around a base lat/lng for a demo route. */
function buildRoute(
  baseLat: number,
  baseLng: number,
  dayStart: Date,
  pointCount: number
) {
  const points: {
    latitude: number;
    longitude: number;
    speed: number;
    recordedAt: Date;
  }[] = [];

  for (let i = 0; i < pointCount; i++) {
    const t = i / Math.max(1, pointCount - 1);
    const recordedAt = new Date(dayStart.getTime() + i * 3 * 60 * 1000);
    const latitude = baseLat + Math.sin(t * Math.PI * 2) * 0.012 + t * 0.008;
    const longitude = baseLng + Math.cos(t * Math.PI * 1.5) * 0.015 + t * 0.01;
    const speed = 25 + Math.sin(t * Math.PI * 4) * 15;
    points.push({ latitude, longitude, speed, recordedAt });
  }
  return points;
}

async function ensureDemoFleet() {
  let company = await prisma.company.findFirst({
    where: { name: "Demo Fleet Co" },
  });

  if (!company) {
    company = await prisma.company.create({
      data: {
        name: "Demo Fleet Co",
        logo: "DF",
        plan: "PRO",
        status: "ACTIVE",
      },
    });
    console.log("Created demo company:", company.name);
  }

  const adminEmail = "admin@gmail.com";
  const adminHash = await bcrypt.hash("admin@123", 12);
  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: "Jawad",
      password: adminHash,
      role: "COMPANY_ADMIN",
      status: "ACTIVE",
      companyId: company.id,
    },
    create: {
      name: "Jawad",
      email: adminEmail,
      password: adminHash,
      role: "COMPANY_ADMIN",
      status: "ACTIVE",
      companyId: company.id,
    },
  });
  console.log("Seeded company admin:", adminEmail);

  const existingCount = await prisma.vehicle.count({
    where: { companyId: company.id },
  });

  if (existingCount === 0) {
    await prisma.vehicle.createMany({
      data: [
        {
          name: "Truck Alpha",
          regNo: "KHI-1001",
          type: "Truck",
          deviceId: "DEV-ALPHA-01",
          currentKm: 12450,
          status: "ONLINE",
          latitude: 24.8607,
          longitude: 67.0011,
          companyId: company.id,
        },
        {
          name: "Van Beta",
          regNo: "KHI-1002",
          type: "Van",
          deviceId: "DEV-BETA-02",
          currentKm: 8320,
          status: "ONLINE",
          latitude: 24.9056,
          longitude: 67.0822,
          companyId: company.id,
        },
        {
          name: "Bike Gamma",
          regNo: "KHI-1003",
          type: "Bike",
          deviceId: "DEV-GAMMA-03",
          currentKm: 2100,
          status: "OFFLINE",
          latitude: 24.9278,
          longitude: 67.0332,
          companyId: company.id,
        },
      ],
    });
    console.log("Created demo vehicles for", company.name);
  }

  return company.id;
}

async function seedGpsTracks(companyId?: string) {
  const vehicles = await prisma.vehicle.findMany({
    where: companyId ? { companyId } : undefined,
    take: 20,
    select: { id: true, latitude: true, longitude: true, name: true },
  });

  if (vehicles.length === 0) {
    console.log("No vehicles found — skip GPS track seed");
    return;
  }

  await prisma.gpsPoint.deleteMany({
    where: { vehicleId: { in: vehicles.map((v) => v.id) } },
  });

  const today = new Date();
  const baseY = today.getUTCFullYear();
  const baseM = today.getUTCMonth();
  const baseD = today.getUTCDate();

  const rows: {
    vehicleId: string;
    latitude: number;
    longitude: number;
    speed: number;
    recordedAt: Date;
  }[] = [];

  for (const vehicle of vehicles) {
    const baseLat = vehicle.latitude ?? 24.8607;
    const baseLng = vehicle.longitude ?? 67.0011;

    for (let dayOffset = 0; dayOffset <= 4; dayOffset++) {
      if (dayOffset === 2) continue;

      const dayStart = new Date(Date.UTC(baseY, baseM, baseD - dayOffset, 8, 0, 0));

      const route = buildRoute(baseLat, baseLng + dayOffset * 0.002, dayStart, 24);
      for (const p of route) {
        rows.push({
          vehicleId: vehicle.id,
          latitude: p.latitude,
          longitude: p.longitude,
          speed: p.speed,
          recordedAt: p.recordedAt,
        });
      }
    }
  }

  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    await prisma.gpsPoint.createMany({ data: rows.slice(i, i + chunk) });
  }

  console.log(`Seeded ${rows.length} GPS points for ${vehicles.length} vehicles`);
}

async function main() {
  const email = (process.env.SUPER_ADMIN_EMAIL ?? "super-admin@gmail.com").toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD ?? "admin@123";
  const name = process.env.SUPER_ADMIN_NAME ?? "Super Admin";

  const hash = await bcrypt.hash(password, 12);

  const superAdmin = await prisma.user.upsert({
    where: { email },
    update: {
      name,
      password: hash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
    create: {
      name,
      email,
      password: hash,
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });

  console.log("Seeded super admin:", superAdmin.email);

  const companyId = await ensureDemoFleet();
  await seedGpsTracks(companyId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
