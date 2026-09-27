import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { buildMeta } from "../utils/pagination";
import { hashPassword, JwtPayload, sanitizeUser } from "../utils/auth";
import { assertCompanyAccess } from "./company.service";
import { createAndEmitNotification } from "./socket.service";

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

export async function listUsers(args: ListArgs) {
  const where: Prisma.UserWhereInput = {
    role: { not: Role.SUPER_ADMIN },
  };

  if (args.user.role === Role.COMPANY_ADMIN) {
    where.companyId = args.user.companyId;
  } else if (args.filters?.companyId && args.filters.companyId !== "ALL") {
    where.companyId = String(args.filters.companyId);
  }

  if (args.filters?.status && args.filters.status !== "ALL") {
    where.status = args.filters.status as Prisma.EnumUserStatusFilter;
  }
  if (args.filters?.role && args.filters.role !== "ALL") {
    where.role = args.filters.role as Prisma.EnumRoleFilter;
  }
  if (args.search) {
    where.OR = [
      { name: { contains: args.search, mode: "insensitive" } },
      { email: { contains: args.search, mode: "insensitive" } },
    ];
  }

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: args.skip,
      take: args.limit,
      orderBy: { [args.sortBy]: args.sortOrder },
      include: { company: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    data: rows.map(sanitizeUser),
    meta: buildMeta(total, args.page, args.limit),
  };
}

export async function getUser(id: string, actor: JwtPayload) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!user || user.role === Role.SUPER_ADMIN) {
    throw new AppError("User not found", 404);
  }
  if (user.companyId) assertCompanyAccess(actor, user.companyId);
  return sanitizeUser(user);
}

export async function createUser(
  body: {
    name: string;
    email: string;
    password: string;
    companyId: string;
    status?: "ACTIVE" | "INACTIVE" | "PENDING";
  },
  actor: JwtPayload
) {
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can create admin accounts", 403);
  }

  const company = await prisma.company.findUnique({ where: { id: body.companyId } });
  if (!company) throw new AppError("Company not found", 404);

  const exists = await prisma.user.findUnique({
    where: { email: body.email.toLowerCase() },
  });
  if (exists) throw new AppError("Email already registered", 409);

  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email.toLowerCase(),
      password: await hashPassword(body.password),
      role: Role.COMPANY_ADMIN,
      status: body.status ?? "ACTIVE",
      companyId: body.companyId,
    },
    include: { company: { select: { id: true, name: true } } },
  });

  await createAndEmitNotification({
    title: "New User Invite",
    body: `${user.name} invited as Company Admin`,
    companyId: body.companyId,
  });

  return sanitizeUser(user);
}

export async function updateUser(
  id: string,
  body: Partial<{
    name: string;
    email: string;
    password: string;
    status: "ACTIVE" | "INACTIVE" | "PENDING";
    companyId: string | null;
  }>,
  actor: JwtPayload
) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role === Role.SUPER_ADMIN) {
    throw new AppError("User not found", 404);
  }
  if (existing.companyId) assertCompanyAccess(actor, existing.companyId);

  if (body.email) {
    const taken = await prisma.user.findFirst({
      where: { email: body.email.toLowerCase(), NOT: { id } },
    });
    if (taken) throw new AppError("Email already registered", 409);
  }

  const data: Prisma.UserUpdateInput = {
    name: body.name,
    email: body.email?.toLowerCase(),
    status: body.status,
  };

  if (body.password) data.password = await hashPassword(body.password);
  if (body.companyId !== undefined && actor.role === Role.SUPER_ADMIN) {
    data.company = body.companyId
      ? { connect: { id: body.companyId } }
      : { disconnect: true };
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    include: { company: { select: { id: true, name: true } } },
  });
  return sanitizeUser(user);
}

export async function deleteUser(id: string, actor: JwtPayload) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing || existing.role === Role.SUPER_ADMIN) {
    throw new AppError("User not found", 404);
  }
  if (existing.companyId) assertCompanyAccess(actor, existing.companyId);
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can delete users", 403);
  }
  await prisma.user.delete({ where: { id } });
  return { id };
}
