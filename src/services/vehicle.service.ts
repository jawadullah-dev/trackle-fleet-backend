import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { buildMeta } from "../utils/pagination";
import { JwtPayload } from "../utils/auth";
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

function companyScope(user: JwtPayload, companyIdFilter?: unknown): Prisma.VehicleWhereInput {
  if (user.role === Role.COMPANY_ADMIN) {
    return { companyId: user.companyId ?? undefined };
  }
  if (companyIdFilter && companyIdFilter !== "ALL") {
    return { companyId: String(companyIdFilter) };
  }
  return {};
}

export async function listVehicles(args: ListArgs) {
  const where: Prisma.VehicleWhereInput = {
    ...companyScope(args.user, args.filters?.companyId),
  };

  if (args.filters?.status && args.filters.status !== "ALL") {
    where.status = args.filters.status as Prisma.EnumVehicleStatusFilter;
  }
  if (args.filters?.groupId && args.filters.groupId !== "ALL") {
    where.groupId = String(args.filters.groupId);
  }
  if (args.search) {
    where.OR = [
      { name: { contains: args.search, mode: "insensitive" } },
      { regNo: { contains: args.search, mode: "insensitive" } },
      { deviceId: { contains: args.search, mode: "insensitive" } },
    ];
  }

  const [total, data] = await Promise.all([
    prisma.vehicle.count({ where }),
    prisma.vehicle.findMany({
      where,
      skip: args.skip,
      take: args.limit,
      orderBy: { [args.sortBy]: args.sortOrder },
      include: {
        company: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    }),
  ]);

  return { data, meta: buildMeta(total, args.page, args.limit) };
}

export async function getVehicle(id: string, actor: JwtPayload) {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      maintenance: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!vehicle) throw new AppError("Vehicle not found", 404);
  assertCompanyAccess(actor, vehicle.companyId);
  return vehicle;
}

export async function createVehicle(
  body: {
    name: string;
    regNo: string;
    type: string;
    deviceId: string;
    currentKm?: number;
    status?: "ONLINE" | "OFFLINE";
    latitude?: number | null;
    longitude?: number | null;
    companyId?: string;
    groupId?: string | null;
  },
  actor: JwtPayload
) {
  const companyId =
    actor.role === Role.SUPER_ADMIN ? body.companyId : actor.companyId ?? undefined;
  if (!companyId) throw new AppError("Company is required", 400);
  assertCompanyAccess(actor, companyId);

  if (body.groupId) {
    const group = await prisma.vehicleGroup.findFirst({
      where: { id: body.groupId, companyId },
    });
    if (!group) throw new AppError("Vehicle group not found for this company", 404);
  }

  try {
    return await prisma.vehicle.create({
      data: {
        name: body.name,
        regNo: body.regNo.toUpperCase(),
        type: body.type,
        deviceId: body.deviceId,
        currentKm: body.currentKm ?? 0,
        status: body.status ?? "OFFLINE",
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        companyId,
        groupId: body.groupId || null,
        lastUpdate: new Date(),
      },
      include: {
        company: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("Registration number or device ID already exists", 409);
    }
    throw error;
  }
}

export async function updateVehicle(
  id: string,
  body: Partial<{
    name: string;
    regNo: string;
    type: string;
    deviceId: string;
    currentKm: number;
    status: "ONLINE" | "OFFLINE";
    latitude: number | null;
    longitude: number | null;
    companyId: string;
    groupId: string | null;
  }>,
  actor: JwtPayload
) {
  const existing = await getVehicle(id, actor);

  if (body.companyId && actor.role === Role.SUPER_ADMIN) {
    assertCompanyAccess(actor, body.companyId);
  }

  try {
    return await prisma.vehicle.update({
      where: { id },
      data: {
        ...body,
        regNo: body.regNo?.toUpperCase(),
        groupId: body.groupId === "" ? null : body.groupId,
        lastUpdate: new Date(),
        companyId: actor.role === Role.SUPER_ADMIN ? body.companyId ?? existing.companyId : existing.companyId,
      },
      include: {
        company: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("Registration number or device ID already exists", 409);
    }
    throw error;
  }
}

export async function deleteVehicle(id: string, actor: JwtPayload) {
  await getVehicle(id, actor);
  await prisma.vehicle.delete({ where: { id } });
  return { id };
}

export async function listMapPins(actor: JwtPayload) {
  const where: Prisma.VehicleWhereInput =
    actor.role === Role.COMPANY_ADMIN ? { companyId: actor.companyId ?? undefined } : {};

  return prisma.vehicle.findMany({
    where,
    select: {
      id: true,
      name: true,
      regNo: true,
      type: true,
      status: true,
      latitude: true,
      longitude: true,
      lastUpdate: true,
      company: { select: { name: true } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
    take: 500,
  });
}
