import { Prisma, Role } from "@prisma/client";
import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import { buildMeta } from "../utils/pagination";
import { JwtPayload } from "../utils/auth";

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

export async function listPayments(args: ListArgs) {
  if (args.user.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can manage payments", 403);
  }

  const where: Prisma.PaymentWhereInput = {};
  if (args.filters?.status && args.filters.status !== "ALL") {
    where.status = args.filters.status as Prisma.EnumPaymentStatusFilter;
  }
  if (args.filters?.companyId && args.filters.companyId !== "ALL") {
    where.companyId = String(args.filters.companyId);
  }
  if (args.search) {
    where.OR = [
      { invoice: { contains: args.search, mode: "insensitive" } },
      { period: { contains: args.search, mode: "insensitive" } },
      { company: { name: { contains: args.search, mode: "insensitive" } } },
    ];
  }

  const [total, data] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      skip: args.skip,
      take: args.limit,
      orderBy: { [args.sortBy]: args.sortOrder },
      include: { company: { select: { id: true, name: true } } },
    }),
  ]);

  return { data, meta: buildMeta(total, args.page, args.limit) };
}

export async function createPayment(
  body: {
    companyId: string;
    invoice: string;
    amount: number;
    period: string;
    method?: string | null;
    status?: "PAID" | "UNPAID" | "PENDING" | "OVERDUE";
    dueDate: Date;
    paidAt?: Date | null;
  },
  actor: JwtPayload
) {
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can manage payments", 403);
  }

  const company = await prisma.company.findUnique({ where: { id: body.companyId } });
  if (!company) throw new AppError("Company not found", 404);

  try {
    const payment = await prisma.payment.create({
      data: {
        ...body,
        method: body.method || null,
        status: body.status ?? "PENDING",
        paidAt: body.status === "PAID" ? body.paidAt ?? new Date() : null,
      },
      include: { company: { select: { id: true, name: true } } },
    });

    if (payment.status === "PAID") {
      await prisma.activity.create({
        data: {
          title: "Payment Received",
          detail: `${company.name} — ${payment.period} subscription paid`,
          type: "SUCCESS",
          companyId: company.id,
        },
      });
    }

    return payment;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("Invoice already exists", 409);
    }
    throw error;
  }
}

export async function updatePayment(
  id: string,
  body: Partial<{
    companyId: string;
    invoice: string;
    amount: number;
    period: string;
    method: string | null;
    status: "PAID" | "UNPAID" | "PENDING" | "OVERDUE";
    dueDate: Date;
    paidAt: Date | null;
  }>,
  actor: JwtPayload
) {
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can manage payments", 403);
  }
  const existing = await prisma.payment.findUnique({ where: { id } });
  if (!existing) throw new AppError("Payment not found", 404);

  return prisma.payment.update({
    where: { id },
    data: {
      ...body,
      paidAt:
        body.status === "PAID"
          ? body.paidAt ?? existing.paidAt ?? new Date()
          : body.status
            ? null
            : body.paidAt,
    },
    include: { company: { select: { id: true, name: true } } },
  });
}

export async function deletePayment(id: string, actor: JwtPayload) {
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can manage payments", 403);
  }
  const existing = await prisma.payment.findUnique({ where: { id } });
  if (!existing) throw new AppError("Payment not found", 404);
  await prisma.payment.delete({ where: { id } });
  return { id };
}

export async function getPayment(id: string, actor: JwtPayload) {
  if (actor.role !== Role.SUPER_ADMIN) {
    throw new AppError("Only super admin can manage payments", 403);
  }
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { company: { select: { id: true, name: true } } },
  });
  if (!payment) throw new AppError("Payment not found", 404);
  return payment;
}
