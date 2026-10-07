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

export async function updateProfile(
  userId: string,
  body: {
    name?: string;
    email?: string;
    currentPassword?: string;
    newPassword?: string;
  }
) {
  const existing = await prisma.user.findUnique({ where: { id: userId } });
  if (!existing) throw new AppError("User not found", 404);

  if (body.email && body.email.toLowerCase() !== existing.email) {
    const taken = await prisma.user.findFirst({
      where: { email: body.email.toLowerCase(), NOT: { id: userId } },
    });
    if (taken) throw new AppError("Email already registered", 409);
  }

  if (body.newPassword) {
    if (!body.currentPassword) {
      throw new AppError("Current password is required to set a new password", 400);
    }
    const valid = await comparePassword(body.currentPassword, existing.password);
    if (!valid) throw new AppError("Current password is incorrect", 400);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(body.name ? { name: body.name } : {}),
      ...(body.email ? { email: body.email.toLowerCase() } : {}),
      ...(body.newPassword ? { password: await hashPassword(body.newPassword) } : {}),
    },
    include: {
      company: { select: { id: true, name: true, status: true, plan: true } },
    },
  });

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
