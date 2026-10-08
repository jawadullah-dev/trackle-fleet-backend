const { PrismaClient } = require("@prisma/client");
require("dotenv/config");
const prisma = new PrismaClient();

async function cleanDb() {
  console.log("Starting DB cleanup...");
  const gps = await prisma.gpsPoint.deleteMany({});
  console.log("Deleted GPS points:", gps.count);
  const vehicles = await prisma.vehicle.deleteMany({});
  console.log("Deleted vehicles:", vehicles.count);
  const groups = await prisma.vehicleGroup.deleteMany({});
  console.log("Deleted vehicle groups:", groups.count);
  const activities = await prisma.activity.deleteMany({});
  console.log("Deleted activities:", activities.count);
  const notifications = await prisma.notification.deleteMany({});
  console.log("Deleted notifications:", notifications.count);
  const payments = await prisma.payment.deleteMany({});
  console.log("Deleted payments:", payments.count);
  const maintenance = await prisma.maintenance.deleteMany({});
  console.log("Deleted maintenance:", maintenance.count);
  const companies = await prisma.company.deleteMany({});
  console.log("Deleted companies:", companies.count);
  const users = await prisma.user.deleteMany({ where: { email: { notIn: ["super-admin@gmail.com", "admin@gmail.com"] } } });
  console.log("Deleted extra users:", users.count);
  const remaining = await prisma.user.findMany({ select: { email: true, role: true } });
  console.log("Remaining users:", JSON.stringify(remaining));
  await prisma.$disconnect();
  console.log("Cleanup complete!");
}

cleanDb().catch(e => { console.error(e); process.exit(1); });
