import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { buildMeta } from "../utils/pagination";
import { JwtPayload } from "../utils/auth";
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

export async function listCompanies(args: ListArgs) {
  const where: Prisma.CompanyWhereInput = {};

  if (args.search) {
    where.name = { contains: args.search, mode: "insensitive" };
  }
  if (args.filters?.status && args.filters.status !== "ALL") {
    where.status = args.filters.status as Prisma.EnumCompanyStatusFilter;
  }
  if (args.filters?.plan && args.filters.plan !== "ALL") {
    where.plan = args.filters.plan as Prisma.EnumPlanTypeFilter;
  }

  const [total, rows] = await Promise.all([
    prisma.company.count({ where }),
    prisma.company.findMany({
      where,
      skip: args.skip,
      take: args.limit,
      orderBy: { [args.sortBy]: args.sortOrder },
      include: {
        _count: { select: { vehicles: true, users: true } },
      },
    }),
  ]);

  const data = rows.map((c) => ({
    ...c,
    vehicles: c._count.vehicles,
    users: c._count.users,
    _count: undefined,
  }));

  return { data, meta: buildMeta(total, args.page, args.limit) };
}

export async function getCompany(id: string) {
  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      _count: { select: { vehicles: true, users: true, groups: true } },
    },
  });
  if (!company) throw new AppError("Company not found", 404);
  return company;
}

export async function createCompany(body: {
  name: string;
  logo?: string | null;
  plan?: "BASIC" | "PRO" | "ENTERPRISE";
  status?: "ACTIVE" | "INACTIVE" | "PENDING";
}) {
  const exists = await prisma.company.findFirst({
    where: { name: { equals: body.name, mode: "insensitive" } },
  });
  if (exists) throw new AppError("Company name already exists", 409);

  const company = await prisma.company.create({
    data: {
      name: body.name,
      logo: body.logo || null,
      plan: body.plan ?? "PRO",
      status: body.status ?? "ACTIVE",
    },
  });

  await prisma.activity.create({
    data: {
      title: "New Company Registration",
      detail: `${company.name} joined TrackFleet`,
      type: "INFO",
      companyId: company.id,
    },
  });

  await createAndEmitNotification({
    title: "New Company Registered",
    body: `${company.name} has registered on TrackFleet (${company.plan} plan)`,
    companyId: company.id,
  });

  return company;
}

export async function updateCompany(
  id: string,
  body: Partial<{
    name: string;
    logo: string | null;
    plan: "BASIC" | "PRO" | "ENTERPRISE";
    status: "ACTIVE" | "INACTIVE" | "PENDING";
  }>
) {
  await getCompany(id);
  return prisma.company.update({ where: { id }, data: body });
}

export async function deleteCompany(id: string) {
  await getCompany(id);
  await prisma.company.delete({ where: { id } });
  return { id };
}

export function assertCompanyAccess(user: JwtPayload, companyId: string) {
  if (user.role === Role.SUPER_ADMIN) return;
  if (user.companyId !== companyId) {
    throw new AppError("Access denied for this company", 403);
  }
}
