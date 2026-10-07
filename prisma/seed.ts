import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/** Build realistic GPS routes around Karachi coordinates */
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

  // Create multiple waypoints for more realistic routes
  const waypoints = [
    { lat: baseLat, lng: baseLng },
    { lat: baseLat + (Math.random() - 0.5) * 0.02, lng: baseLng + (Math.random() - 0.5) * 0.02 },
    { lat: baseLat + (Math.random() - 0.5) * 0.03, lng: baseLng + (Math.random() - 0.5) * 0.03 },
    { lat: baseLat + (Math.random() - 0.5) * 0.02, lng: baseLng + (Math.random() - 0.5) * 0.02 },
    { lat: baseLat + (Math.random() - 0.5) * 0.015, lng: baseLng + (Math.random() - 0.5) * 0.015 },
  ];

  let currentWaypointIndex = 0;
  let progressInSegment = 0;

  for (let i = 0; i < pointCount; i++) {
    const recordedAt = new Date(dayStart.getTime() + i * 2 * 60 * 1000); // 2 minutes per point

    // Interpolate between waypoints
    const wp1 = waypoints[currentWaypointIndex];
    const wp2 = waypoints[Math.min(currentWaypointIndex + 1, waypoints.length - 1)];

    progressInSegment += 0.05;
    if (progressInSegment >= 1) {
      progressInSegment = 0;
      currentWaypointIndex = Math.min(currentWaypointIndex + 1, waypoints.length - 2);
    }

    const latitude = wp1.lat + (wp2.lat - wp1.lat) * progressInSegment + (Math.random() - 0.5) * 0.001;
    const longitude = wp1.lng + (wp2.lng - wp1.lng) * progressInSegment + (Math.random() - 0.5) * 0.001;

    // Realistic speed variations (km/h)
    const baseSpeed = 30 + Math.random() * 40;
    const speed = Math.max(5, Math.min(80, baseSpeed));

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

  // Always ensure we have 10 vehicles for the demo
  await prisma.vehicle.deleteMany({ where: { companyId: company.id } });

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
      {
        name: "Truck Delta",
        regNo: "KHI-1004",
        type: "Truck",
        deviceId: "DEV-DELTA-04",
        currentKm: 15600,
        status: "ONLINE",
        latitude: 24.8520,
        longitude: 67.0200,
        companyId: company.id,
      },
      {
        name: "Van Epsilon",
        regNo: "KHI-1005",
        type: "Van",
        deviceId: "DEV-EPSILON-05",
        currentKm: 7800,
        status: "ONLINE",
        latitude: 24.8800,
        longitude: 67.0600,
        companyId: company.id,
      },
      {
        name: "Bike Zeta",
        regNo: "KHI-1006",
        type: "Bike",
        deviceId: "DEV-ZETA-06",
        currentKm: 3200,
        status: "OFFLINE",
        latitude: 24.9100,
        longitude: 67.0900,
        companyId: company.id,
      },
      {
        name: "Truck Eta",
        regNo: "KHI-1007",
        type: "Truck",
        deviceId: "DEV-ETA-07",
        currentKm: 18900,
        status: "ONLINE",
        latitude: 24.8400,
        longitude: 67.0300,
        companyId: company.id,
      },
      {
        name: "Van Theta",
        regNo: "KHI-1008",
        type: "Van",
        deviceId: "DEV-THETA-08",
        currentKm: 9100,
        status: "ONLINE",
        latitude: 24.8700,
        longitude: 67.0700,
        companyId: company.id,
      },
      {
        name: "Bike Iota",
        regNo: "KHI-1009",
        type: "Bike",
        deviceId: "DEV-IOTA-09",
        currentKm: 4500,
        status: "OFFLINE",
        latitude: 24.8950,
        longitude: 67.1000,
        companyId: company.id,
      },
      {
        name: "Truck Kappa",
        regNo: "KHI-1010",
        type: "Truck",
        deviceId: "DEV-KAPPA-10",
        currentKm: 21200,
        status: "ONLINE",
        latitude: 24.8550,
        longitude: 67.0400,
        companyId: company.id,
      },
    ],
  });
  console.log("Created 10 demo vehicles for", company.name);

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

    // Generate tracks for last 30 days with multiple routes per day
    for (let dayOffset = 0; dayOffset <= 29; dayOffset++) {
      // Generate 2-3 routes per day (morning, afternoon, evening)
      const routeCount = 2 + Math.floor(Math.random() * 2);

      for (let routeIdx = 0; routeIdx < routeCount; routeIdx++) {
        const hour = 6 + routeIdx * 6; // 6am, 12pm, 6pm
        const dayStart = new Date(Date.UTC(baseY, baseM, baseD - dayOffset, hour, 0, 0));

        // Generate 80-120 points per route for detailed polyline rendering
        const pointCount = 80 + Math.floor(Math.random() * 40);

        // Add slight offset to routes to make them unique
        const routeOffsetLat = (Math.random() - 0.5) * 0.01;
        const routeOffsetLng = (Math.random() - 0.5) * 0.01 + dayOffset * 0.0005;

        const route = buildRoute(
          baseLat + routeOffsetLat,
          baseLng + routeOffsetLng,
          dayStart,
          pointCount
        );

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
  }

  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    await prisma.gpsPoint.createMany({ data: rows.slice(i, i + chunk) });
  }

  console.log(`Seeded ${rows.length} GPS points for ${vehicles.length} vehicles`);
}

async function seedActivities(companyId: string) {
  const vehicleNames = ["Truck Alpha", "Van Beta", "Bike Gamma", "Truck Delta", "Van Epsilon", "Bike Zeta", "Truck Eta", "Van Theta", "Bike Iota", "Truck Kappa"];
  const locations = ["North Karachi", "South Karachi", "Central Karachi", "Gulshan", "Clifton", "Saddar", "Liaquatabad", "Nazimabad", "Gulberg", "Johar"];

  const activities = [
    {
      title: "New Vehicle Added",
      detail: "Truck Alpha (KHI-1001) was added to the fleet",
      type: "SUCCESS" as const,
    },
    {
      title: "Vehicle Online",
      detail: "Van Beta (KHI-1002) came online",
      type: "INFO" as const,
    },
    {
      title: "Maintenance Due",
      detail: "Truck Alpha requires oil change within 500km",
      type: "WARNING" as const,
    },
    {
      title: "Route Completed",
      detail: "Bike Gamma completed delivery route to North Karachi",
      type: "SUCCESS" as const,
    },
    {
      title: "Speed Alert",
      detail: "Truck Delta exceeded speed limit on N-5 Highway",
      type: "ALERT" as const,
    },
    {
      title: "New Vehicle Added",
      detail: "Van Epsilon (KHI-1005) was added to the fleet",
      type: "SUCCESS" as const,
    },
    {
      title: "Vehicle Offline",
      detail: "Bike Gamma went offline for maintenance",
      type: "WARNING" as const,
    },
    {
      title: "Fuel Efficiency",
      detail: "Truck Eta showing improved fuel efficiency",
      type: "INFO" as const,
    },
    {
      title: "Geofence Alert",
      detail: "Van Theta left designated zone",
      type: "ALERT" as const,
    },
    {
      title: "Maintenance Completed",
      detail: "Bike Zeta maintenance completed successfully",
      type: "SUCCESS" as const,
    },
    {
      title: "New Vehicle Added",
      detail: "Truck Kappa (KHI-1010) was added to the fleet",
      type: "SUCCESS" as const,
    },
    {
      title: "Daily Summary",
      detail: "Fleet completed 15 routes today covering 450km",
      type: "INFO" as const,
    },
    {
      title: "Route Started",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} started route to ${locations[Math.floor(Math.random() * locations.length)]}`,
      type: "INFO" as const,
    },
    {
      title: "Speed Alert",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} exceeded 70km/h limit`,
      type: "ALERT" as const,
    },
    {
      title: "Maintenance Due",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} requires tire replacement`,
      type: "WARNING" as const,
    },
    {
      title: "Route Completed",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} completed route to ${locations[Math.floor(Math.random() * locations.length)]}`,
      type: "SUCCESS" as const,
    },
    {
      title: "Vehicle Online",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} came online after maintenance`,
      type: "INFO" as const,
    },
    {
      title: "Fuel Efficiency",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} achieving 12km/L efficiency`,
      type: "INFO" as const,
    },
    {
      title: "Geofence Alert",
      detail: `${vehicleNames[Math.floor(Math.random() * vehicleNames.length)]} entered restricted area`,
      type: "ALERT" as const,
    },
    {
      title: "Daily Summary",
      detail: "Fleet completed 22 routes today covering 680km with 98% on-time delivery",
      type: "INFO" as const,
    },
  ];

  await prisma.activity.deleteMany({ where: { companyId } });

  for (const activity of activities) {
    await prisma.activity.create({
      data: {
        ...activity,
        companyId,
        createdAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000), // Random time in last 7 days
      },
    });
  }

  console.log(`Seeded ${activities.length} activities`);
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
  await seedActivities(companyId);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
