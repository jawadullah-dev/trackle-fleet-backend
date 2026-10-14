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

function ensureCompanyAdmin(user: JwtPayload) {
  if (user.role === Role.SUPER_ADMIN) {
    throw new AppError(
      "Access denied: Super Admin cannot access company vehicles or live tracking data",
      403
    );
  }
}

export async function listVehicles(args: ListArgs) {
  ensureCompanyAdmin(args.user);
  const companyId = await resolveCompanyForActor(args.user);

  const where: Prisma.VehicleWhereInput = {
    companyId,
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

  const [total, rawData] = await Promise.all([
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

  const data = rawData.map((v) => ({
    ...v,
    lastLocation:
      v.latitude != null && v.longitude != null
        ? { lat: v.latitude, lng: v.longitude }
        : null,
    lastSeen: v.lastUpdate,
  }));

  return { data, meta: buildMeta(total, args.page, args.limit) };
}

export async function listLiveVehicles(actor: JwtPayload) {
  ensureCompanyAdmin(actor);
  const companyId = await resolveCompanyForActor(actor);

  const rawVehicles = await prisma.vehicle.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      regNo: true,
      type: true,
      deviceId: true,
      status: true,
      latitude: true,
      longitude: true,
      lastUpdate: true,
      company: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return rawVehicles.map((v) => ({
    id: v.id,
    name: v.name,
    regNo: v.regNo,
    type: v.type,
    deviceId: v.deviceId,
    status: v.status,
    latitude: v.latitude,
    longitude: v.longitude,
    lastLocation:
      v.latitude != null && v.longitude != null
        ? { lat: v.latitude, lng: v.longitude }
        : null,
    lastSeen: v.lastUpdate,
    lastUpdate: v.lastUpdate,
    company: v.company,
    group: v.group,
  }));
}

export async function getVehicle(id: string, actor: JwtPayload) {
  ensureCompanyAdmin(actor);
  const companyId = await resolveCompanyForActor(actor);

  const vehicle = await prisma.vehicle.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      maintenance: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!vehicle) throw new AppError("Vehicle not found", 404);

  if (vehicle.companyId !== companyId) {
    throw new AppError("Access denied for this company", 403);
  }

  return {
    ...vehicle,
    lastLocation:
      vehicle.latitude != null && vehicle.longitude != null
        ? { lat: vehicle.latitude, lng: vehicle.longitude }
        : null,
    lastSeen: vehicle.lastUpdate,
  };
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
  ensureCompanyAdmin(actor);
  const companyId = await resolveCompanyForActor(actor, body.companyId);
  assertCompanyAccess(actor, companyId);

  const cleanDeviceId = String(body.deviceId || "").trim();
  const cleanRegNo = String(body.regNo || "").trim().toUpperCase();

  // Validate unique deviceId across the entire system
  const existingDevice = await prisma.vehicle.findUnique({
    where: { deviceId: cleanDeviceId },
  });
  if (existingDevice) {
    throw new AppError(
      `Device ID "${cleanDeviceId}" already exists across the system. Each tracker must have a unique ID.`,
      409
    );
  }

  // Validate unique registration number
  const existingRegNo = await prisma.vehicle.findUnique({
    where: { regNo: cleanRegNo },
  });
  if (existingRegNo) {
    throw new AppError(`Registration number "${cleanRegNo}" already exists`, 409);
  }

  let validGroupId: string | null = null;
  if (body.groupId && body.groupId !== "none") {
    const group = await prisma.vehicleGroup.findFirst({
      where: { id: body.groupId, companyId },
    });
    if (!group) {
      throw new AppError("Vehicle group not found for this company", 404);
    }
    validGroupId = group.id;
  }

  try {
    const created = await prisma.vehicle.create({
      data: {
        name: body.name.trim(),
        regNo: cleanRegNo,
        type: body.type,
        deviceId: cleanDeviceId,
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

    return {
      ...created,
      lastLocation:
        created.latitude != null && created.longitude != null
          ? { lat: created.latitude, lng: created.longitude }
          : null,
      lastSeen: created.lastUpdate,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new AppError("Registration number or Device ID already exists", 409);
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
  ensureCompanyAdmin(actor);
  const existing = await getVehicle(id, actor);
  const targetCompanyId = existing.companyId;

  // Validate deviceId uniqueness if updated
  if (body.deviceId) {
    const cleanDeviceId = body.deviceId.trim();
    const existingDevice = await prisma.vehicle.findFirst({
      where: {
        deviceId: cleanDeviceId,
        NOT: { id },
      },
    });
    if (existingDevice) {
      throw new AppError(
        `Device ID "${cleanDeviceId}" is already registered to another vehicle`,
        409
      );
    }
  }

  // Validate regNo uniqueness if updated
  if (body.regNo) {
    const cleanRegNo = body.regNo.trim().toUpperCase();
    const existingReg = await prisma.vehicle.findFirst({
      where: {
        regNo: cleanRegNo,
        NOT: { id },
      },
    });
    if (existingReg) {
      throw new AppError(`Registration number "${cleanRegNo}" already exists`, 409);
    }
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
    const updated = await prisma.vehicle.update({
      where: { id },
      data: {
        ...body,
        name: body.name?.trim(),
        deviceId: body.deviceId ? body.deviceId.trim() : undefined,
        regNo: body.regNo?.trim().toUpperCase(),
        groupId: targetGroupId,
        lastUpdate: new Date(),
        companyId: targetCompanyId,
      },
      include: {
        company: { select: { id: true, name: true } },
        group: { select: { id: true, name: true } },
      },
    });

    return {
      ...updated,
      lastLocation:
        updated.latitude != null && updated.longitude != null
          ? { lat: updated.latitude, lng: updated.longitude }
          : null,
      lastSeen: updated.lastUpdate,
    };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new AppError("Registration number or Device ID already exists", 409);
      }
      if (error.code === "P2003") {
        throw new AppError("Referenced company or vehicle group does not exist", 400);
      }
    }
    throw error;
  }
}

export async function deleteVehicle(id: string, actor: JwtPayload) {
  ensureCompanyAdmin(actor);
  await getVehicle(id, actor);
  await prisma.vehicle.delete({ where: { id } });
  return { id };
}

export async function listMapPins(actor: JwtPayload) {
  ensureCompanyAdmin(actor);
  const companyId = await resolveCompanyForActor(actor);

  return prisma.vehicle.findMany({
    where: { companyId },
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
