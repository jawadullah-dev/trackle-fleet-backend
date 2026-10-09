import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { buildMeta } from "../utils/pagination";
import { JwtPayload } from "../utils/auth";
import { assertCompanyAccess, resolveCompanyForActor } from "./company.service";

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

async function companyScope(
  user: JwtPayload,
  companyIdFilter?: unknown
): Promise<Prisma.VehicleWhereInput> {
  if (user.role === Role.COMPANY_ADMIN) {
    const validCompanyId = await resolveCompanyForActor(user);
    return { companyId: validCompanyId };
  }
  if (companyIdFilter && companyIdFilter !== "ALL") {
    return { companyId: String(companyIdFilter) };
  }
  return {};
}

export async function listVehicles(args: ListArgs) {
  const scope = await companyScope(args.user, args.filters?.companyId);
  const where: Prisma.VehicleWhereInput = {
    ...scope,
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

  if (actor.role !== Role.SUPER_ADMIN) {
    const validCompanyId = await resolveCompanyForActor(actor);
    if (vehicle.companyId !== validCompanyId) {
      throw new AppError("Access denied for this company", 403);
    }
  }

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
  const companyId = await resolveCompanyForActor(actor, body.companyId);
  assertCompanyAccess(actor, companyId);

  let validGroupId: string | null = null;
  if (body.groupId && body.groupId !== "none") {
    const group = await prisma.vehicleGroup.findFirst({
      where: { id: body.groupId, companyId },
    });
    if (!group) {
      if (actor.role === Role.SUPER_ADMIN) {
        const anyGroup = await prisma.vehicleGroup.findUnique({
          where: { id: body.groupId },
        });
        if (anyGroup) validGroupId = anyGroup.id;
      } else {
        throw new AppError("Vehicle group not found for this company", 404);
      }
    } else {
      validGroupId = group.id;
    }
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
        groupId: validGroupId,
        lastUpdate: new Date(),
      },
      include: {
        company: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new AppError("Registration number or device ID already exists", 409);
      }
      if (error.code === "P2003") {
        throw new AppError("Referenced company or vehicle group does not exist", 400);
      }
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

  let targetCompanyId = existing.companyId;
  if (body.companyId && actor.role === Role.SUPER_ADMIN) {
    targetCompanyId = await resolveCompanyForActor(actor, body.companyId);
  }

  let targetGroupId =
    body.groupId !== undefined
      ? body.groupId === "" || body.groupId === "none"
        ? null
        : body.groupId
      : undefined;

  if (targetGroupId) {
    const group = await prisma.vehicleGroup.findFirst({
      where: { id: targetGroupId, companyId: targetCompanyId },
    });
    if (!group) {
      throw new AppError("Vehicle group not found for this company", 404);
    }
  }

  try {
    return await prisma.vehicle.update({
      where: { id },
      data: {
        ...body,
        regNo: body.regNo?.toUpperCase(),
        groupId: targetGroupId,
        lastUpdate: new Date(),
        companyId: targetCompanyId,
      },
      include: {
        company: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new AppError("Registration number or device ID already exists", 409);
      }
      if (error.code === "P2003") {
        throw new AppError("Referenced company or vehicle group does not exist", 400);
      }
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
  let where: Prisma.VehicleWhereInput = {};
  if (actor.role === Role.COMPANY_ADMIN) {
    const validCompanyId = await resolveCompanyForActor(actor);
    where = { companyId: validCompanyId };
  }

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

