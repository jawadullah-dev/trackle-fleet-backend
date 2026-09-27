import { prisma } from "../config/db";
import { AppError } from "../utils/app-error";
import {
  comparePassword,
  hashPassword,
  sanitizeUser,
  signToken,
} from "../utils/auth";
import { env } from "../config/env";

export async function login(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { company: { select: { id: true, name: true, status: true } } },
  });

  if (!user) throw new AppError("Invalid email or password", 401);
  if (user.status === "INACTIVE") throw new AppError("Account is inactive", 403);

  const ok = await comparePassword(password, user.password);
  if (!ok) throw new AppError("Invalid email or password", 401);

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const token = signToken({
    sub: user.id,
    email: user.email,
    role: user.role,
    companyId: user.companyId,
  });

  return {
    token,
    user: sanitizeUser(user),
  };
}

export async function getMe(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { company: { select: { id: true, name: true, status: true, plan: true } } },
  });
  if (!user) throw new AppError("User not found", 404);
  return sanitizeUser(user);
}

export async function ensureSuperAdmin() {
  const existing = await prisma.user.findUnique({
    where: { email: env.superAdminEmail.toLowerCase() },
  });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      name: env.superAdminName,
      email: env.superAdminEmail.toLowerCase(),
      password: await hashPassword(env.superAdminPassword),
      role: "SUPER_ADMIN",
      status: "ACTIVE",
    },
  });
}
