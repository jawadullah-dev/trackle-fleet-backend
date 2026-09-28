import { Role, Prisma } from "@prisma/client";
import { prisma } from "../config/db";
import { JwtPayload } from "../utils/auth";
import { buildMeta } from "../utils/pagination";
import { emitNotificationRead, emitAllNotificationsRead } from "./socket.service";

export async function getDashboardStats(user: JwtPayload) {
  if (user.role === Role.SUPER_ADMIN) {
    const [totalCompanies, totalVehicles, onlineVehicles] =
      await Promise.all([
        prisma.company.count(),
        prisma.vehicle.count(),
        prisma.vehicle.count({ where: { status: "ONLINE" } }),
      ]);

    return {
      role: user.role,
      stats: [
        { label: "Total Companies", value: totalCompanies, tone: "blue" },
        { label: "Total Vehicles", value: totalVehicles, tone: "sky" },
        { label: "Online Vehicles", value: onlineVehicles, tone: "green" },
      ],
    };
  }

  const companyId = user.companyId ?? undefined;
  const [totalVehicles, onlineVehicles] =
    await Promise.all([
      prisma.vehicle.count({ where: { companyId } }),
      prisma.vehicle.count({ where: { companyId, status: "ONLINE" } }),
    ]);

  return {
    role: user.role,
    stats: [
      { label: "Total Vehicles", value: totalVehicles, tone: "blue" },
      { label: "Online Now", value: onlineVehicles, tone: "green" },
    ],
  };
}

export async function listActivities(
  user: JwtPayload,
  page: number,
  limit: number,
  skip: number
) {
  const where =
    user.role === Role.COMPANY_ADMIN
      ? { companyId: user.companyId }
      : {};

  const [total, data] = await Promise.all([
    prisma.activity.count({ where }),
    prisma.activity.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { data, meta: buildMeta(total, page, limit) };
}

export async function listNotifications(
  user: JwtPayload,
  page: number,
  limit: number,
  skip: number
) {
  const where =
    user.role === Role.COMPANY_ADMIN
      ? {
          OR: [{ companyId: user.companyId }, { userId: user.sub }],
        }
      : {};

  const [total, data] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return { data, meta: buildMeta(total, page, limit) };
}

export async function markNotificationRead(id: string, user: JwtPayload) {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) return null;

  if (
    user.role === Role.COMPANY_ADMIN &&
    notification.companyId &&
    notification.companyId !== user.companyId &&
    notification.userId !== user.sub
  ) {
    return null;
  }

  const updated = await prisma.notification.update({
    where: { id },
    data: { unread: false },
  });

  emitNotificationRead(updated.id);
  return updated;
}

export async function markAllNotificationsRead(user: JwtPayload) {
  const where: Prisma.NotificationWhereInput =
    user.role === Role.COMPANY_ADMIN
      ? {
          OR: [{ companyId: user.companyId }, { userId: user.sub }],
          unread: true,
        }
      : { unread: true };

  await prisma.notification.updateMany({
    where,
    data: { unread: false },
  });

  emitAllNotificationsRead(user.sub, user.companyId);
  return { success: true };
}
