import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { buildMeta } from "../utils/pagination";
import { JwtPayload } from "../utils/auth";
import { computeMaintenanceStatus } from "../utils/maintenance";
import { assertCompanyAccess } from "./company.service";

type ListArgs = {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
  filters?: Record<string, unknown>;
  user: JwtPayload;
};

export async function listMaintenance(args: ListArgs) {
  const where: Prisma.MaintenanceWhereInput = {};

  if (args.user.role === Role.COMPANY_ADMIN) {
    where.vehicle = { companyId: args.user.companyId ?? undefined };
  } else if (args.filters?.companyId && args.filters.companyId !== "ALL") {
    where.vehicle = { companyId: String(args.filters.companyId) };
  }

  if (args.filters?.status && args.filters.status !== "ALL") {
    where.status = args.filters.status as Prisma.EnumMaintenanceStatusFilter;
  }
  if (args.filters?.serviceType && args.filters.serviceType !== "ALL") {
    where.serviceType = String(args.filters.serviceType);
  }
  if (args.filters?.vehicleId) {
    where.vehicleId = String(args.filters.vehicleId);
  }
  if (args.search) {
    where.OR = [
      { serviceType: { contains: args.search, mode: "insensitive" } },
      { vehicle: { name: { contains: args.search, mode: "insensitive" } } },
    ];
  }

  const [total, data] = await Promise.all([
    prisma.maintenance.count({ where }),
    prisma.maintenance.findMany({
      where,
      skip: args.skip,
      take: args.limit,
      orderBy: { [args.sortBy]: args.sortOrder },
      include: {
        vehicle: {
          select: {
            id: true,
            name: true,
            regNo: true,
            currentKm: true,
            companyId: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    }),
  ]);

  return { data, meta: buildMeta(total, args.page, args.limit) };
}

export async function getMaintenance(id: string, actor: JwtPayload) {
  const row = await prisma.maintenance.findUnique({
    where: { id },
    include: {
      vehicle: {
        select: {
          id: true,
          name: true,
          regNo: true,
          currentKm: true,
          companyId: true,
        },
      },
    },
  });
  if (!row) throw new AppError("Maintenance record not found", 404);
  assertCompanyAccess(actor, row.vehicle.companyId);
  return row;
}

export async function createMaintenance(
  body: {
    vehicleId: string;
    serviceType: string;
    intervalKm: number;
    lastServiceKm: number;
    nextServiceKm: number;
  },
  actor: JwtPayload
) {
  const vehicle = await prisma.vehicle.findUnique({ where: { id: body.vehicleId } });
  if (!vehicle) throw new AppError("Vehicle not found", 404);
  assertCompanyAccess(actor, vehicle.companyId);

  const status = computeMaintenanceStatus(vehicle.currentKm, body.nextServiceKm);

  const row = await prisma.maintenance.create({
    data: { ...body, status },
    include: {
      vehicle: {
        select: { id: true, name: true, regNo: true, currentKm: true, companyId: true },
      },
    },
  });

  if (status !== "ON_TRACK") {
    await prisma.activity.create({
      data: {
        title: status === "OVERDUE" ? "Maintenance Overdue" : "Maintenance Due Soon",
        detail: `${vehicle.name} — ${body.serviceType}`,
        type: status === "OVERDUE" ? "ALERT" : "WARNING",
        companyId: vehicle.companyId,
      },
    });
  }

  return row;
}

export async function updateMaintenance(
  id: string,
  body: Partial<{
    serviceType: string;
    intervalKm: number;
    lastServiceKm: number;
    nextServiceKm: number;
  }>,
  actor: JwtPayload
) {
  const existing = await getMaintenance(id, actor);
  const nextServiceKm = body.nextServiceKm ?? existing.nextServiceKm;
  const status = computeMaintenanceStatus(existing.vehicle.currentKm, nextServiceKm);

  return prisma.maintenance.update({
    where: { id },
    data: { ...body, status },
    include: {
      vehicle: {
        select: { id: true, name: true, regNo: true, currentKm: true, companyId: true },
      },
    },
  });
}

export async function deleteMaintenance(id: string, actor: JwtPayload) {
  await getMaintenance(id, actor);
  await prisma.maintenance.delete({ where: { id } });
  return { id };
}

export async function maintenanceSummary(actor: JwtPayload) {
  const where: Prisma.MaintenanceWhereInput =
    actor.role === Role.COMPANY_ADMIN
      ? { vehicle: { companyId: actor.companyId ?? undefined } }
      : {};

  const [onTrack, dueSoon, overdue] = await Promise.all([
    prisma.maintenance.count({ where: { ...where, status: "ON_TRACK" } }),
    prisma.maintenance.count({ where: { ...where, status: "DUE_SOON" } }),
    prisma.maintenance.count({ where: { ...where, status: "OVERDUE" } }),
  ]);

  return { onTrack, dueSoon, overdue };
}
