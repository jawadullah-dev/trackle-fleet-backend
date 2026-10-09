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

export async function listGroups(args: ListArgs) {
  const where: Prisma.VehicleGroupWhereInput = {};

  if (args.user.role === Role.COMPANY_ADMIN) {
    where.companyId = await resolveCompanyForActor(args.user);
  } else if (args.filters?.companyId && args.filters.companyId !== "ALL") {
    where.companyId = String(args.filters.companyId);
  }

  if (args.search) {
    where.name = { contains: args.search, mode: "insensitive" };
  }

  const [total, rows] = await Promise.all([
    prisma.vehicleGroup.count({ where }),
    prisma.vehicleGroup.findMany({
      where,
      skip: args.skip,
      take: args.limit,
      orderBy: { [args.sortBy]: args.sortOrder },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { vehicles: true } },
      },
    }),
  ]);

  return {
    data: rows.map((g) => ({
      ...g,
      count: g._count.vehicles,
      _count: undefined,
    })),
    meta: buildMeta(total, args.page, args.limit),
  };
}

export async function getGroup(id: string, actor: JwtPayload) {
  const group = await prisma.vehicleGroup.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true } },
      _count: { select: { vehicles: true } },
    },
  });
  if (!group) throw new AppError("Vehicle group not found", 404);

  if (actor.role !== Role.SUPER_ADMIN) {
    const validCompanyId = await resolveCompanyForActor(actor);
    if (group.companyId !== validCompanyId) {
      throw new AppError("Access denied for this company", 403);
    }
  }

  return { ...group, count: group._count.vehicles };
}

export async function createGroup(
  body: { name: string; description?: string | null; companyId?: string },
  actor: JwtPayload
) {
  const companyId = await resolveCompanyForActor(actor, body.companyId);
  assertCompanyAccess(actor, companyId);

  try {
    return await prisma.vehicleGroup.create({
      data: {
        name: body.name,
        description: body.description || null,
        companyId,
      },
      include: {
        company: { select: { id: true, name: true } },
        _count: { select: { vehicles: true } },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        throw new AppError("Group name already exists for this company", 409);
      }
      if (error.code === "P2003") {
        throw new AppError("Referenced company does not exist", 400);
      }
    }
    throw error;
  }
}

export async function updateGroup(
  id: string,
  body: Partial<{ name: string; description: string | null }>,
  actor: JwtPayload
) {
  await getGroup(id, actor);
  return prisma.vehicleGroup.update({
    where: { id },
    data: body,
    include: {
      company: { select: { id: true, name: true } },
      _count: { select: { vehicles: true } },
    },
  });
}

export async function deleteGroup(id: string, actor: JwtPayload) {
  await getGroup(id, actor);
  await prisma.vehicleGroup.delete({ where: { id } });
  return { id };
}

