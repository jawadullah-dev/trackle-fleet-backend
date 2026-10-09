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

export async function resolveCompanyForActor(
  actor: JwtPayload,
  requestedCompanyId?: string | null
): Promise<string> {
  // 1. Super Admin: use explicitly requested company, or fallback to first active company
  if (actor.role === Role.SUPER_ADMIN) {
    if (requestedCompanyId) {
      const company = await prisma.company.findUnique({
        where: { id: requestedCompanyId },
      });
      if (!company) throw new AppError("Company not found", 404);
      return company.id;
    }

    if (actor.companyId) {
      const company = await prisma.company.findUnique({
        where: { id: actor.companyId },
      });
      if (company) return company.id;
    }

    const defaultCompany =
      (await prisma.company.findFirst({
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
      })) ??
      (await prisma.company.findFirst({
        orderBy: { createdAt: "asc" },
      }));

    if (!defaultCompany) {
      throw new AppError("No company found. Please create a company first.", 400);
    }
    return defaultCompany.id;
  }

  // 2. Company Admin / tenant user: verify candidate exists in DB
  const candidateId = requestedCompanyId || actor.companyId;
  if (candidateId) {
    const existing = await prisma.company.findUnique({
      where: { id: candidateId },
    });
    if (existing) {
      actor.companyId = existing.id;
      return existing.id;
    }
  }

  // If candidate was stale or missing, look up user's active record from DB
  const dbUser = await prisma.user.findUnique({
    where: { id: actor.sub },
    include: { company: true },
  });

  if (dbUser?.company) {
    actor.companyId = dbUser.company.id;
    return dbUser.company.id;
  }

  // Self-heal: link user to first active company so foreign keys never fail
  const fallbackCompany =
    (await prisma.company.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.company.findFirst({
      orderBy: { createdAt: "asc" },
    }));

  if (!fallbackCompany) {
    throw new AppError("No active company found for this user", 400);
  }

  await prisma.user
    .update({
      where: { id: actor.sub },
      data: { companyId: fallbackCompany.id },
    })
    .catch(() => {});

  actor.companyId = fallbackCompany.id;
  return fallbackCompany.id;
}

export function assertCompanyAccess(user: JwtPayload, companyId: string) {
  if (user.role === Role.SUPER_ADMIN) return;
  if (user.companyId && user.companyId !== companyId) {
    throw new AppError("Access denied for this company", 403);
  }
}

