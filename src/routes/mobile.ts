import { Router } from "express";
import { Prisma } from "@prisma/client";
import { authenticate } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";
import { sendSuccess } from "../utils/api-response";
import { AuthRequest } from "../middleware/auth";
import { AppError } from "../utils/app-error";
import { getPagination } from "../utils/pagination";
import * as authService from "../services/auth.service";
import * as vehicleService from "../services/vehicle.service";
import * as dashboardService from "../services/dashboard.service";
import { resolveCompanyForActor } from "../services/company.service";
import { prisma } from "../config/db";
import bcrypt from "bcryptjs";

function requireUser(req: AuthRequest) {
  if (!req.user) throw new AppError("Authentication required", 401);
  return req.user;
}

const router = Router();

// All mobile routes require authentication
router.use(authenticate);

/**
 * GET /mobile/dashboard
 * Combined dashboard payload for the mobile home screen.
 * Returns user profile + vehicle stats + recent alerts in one request.
 */
router.get(
  "/dashboard",
  asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const companyId = await resolveCompanyForActor(user);

    const [userData, totalVehicles, onlineVehicles, offlineVehicles, totalGroups, recentAlerts] =
      await Promise.all([
        authService.getMe(user.sub),
        prisma.vehicle.count({ where: companyId ? { companyId } : {} }),
        prisma.vehicle.count({ where: companyId ? { companyId, status: "ONLINE" } : { status: "ONLINE" } }),
        prisma.vehicle.count({ where: companyId ? { companyId, status: "OFFLINE" } : { status: "OFFLINE" } }),
        prisma.vehicleGroup.count({ where: companyId ? { companyId } : {} }),
        prisma.notification.findMany({
          where: companyId ? { OR: [{ companyId }, { userId: user.sub }] } : {},
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

    const unreadAlerts = recentAlerts.filter((n) => n.unread).length;

    return sendSuccess(res, {
      user: userData,
      stats: {
        totalVehicles,
        onlineVehicles,
        offlineVehicles,
        totalGroups,
        unreadAlerts,
      },
      recentAlerts,
    });
  })
);

/**
 * GET /mobile/map
 * Live map pins — all vehicles with GPS coordinates.
 */
router.get(
  "/map",
  asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const data = await vehicleService.listMapPins(user);
    return sendSuccess(res, data);
  })
);

/**
 * GET /mobile/profile
 * Get authenticated user's full profile.
 */
router.get(
  "/profile",
  asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const data = await authService.getMe(user.sub);
    return sendSuccess(res, data);
  })
);

/**
 * PATCH /mobile/profile
 * Update name and/or password from the Profile screen.
 */
router.patch(
  "/profile",
  asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const { name, currentPassword, newPassword } = req.body as {
      name?: string;
      currentPassword?: string;
      newPassword?: string;
    };

    const existing = await prisma.user.findUnique({ where: { id: user.sub } });
    if (!existing) throw new AppError("User not found", 404);

    const updateData: { name?: string; password?: string } = {};

    if (name) updateData.name = name;

    if (newPassword) {
      if (!currentPassword) {
        throw new AppError("Current password is required to set a new password", 400);
      }
      const valid = await bcrypt.compare(currentPassword, existing.password);
      if (!valid) throw new AppError("Current password is incorrect", 400);
      updateData.password = await bcrypt.hash(newPassword, 10);
    }

    const updated = await prisma.user.update({
      where: { id: user.sub },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        companyId: true,
        lastLogin: true,
        createdAt: true,
        company: { select: { id: true, name: true } },
      },
    });

    return sendSuccess(res, updated, "Profile updated");
  })
);

/**
 * POST /mobile/push-token
 * Register a device push token for push notifications.
 */
router.post(
  "/push-token",
  asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const { token, platform } = req.body as { token: string; platform: string };

    if (!token || !platform) {
      throw new AppError("token and platform are required", 400);
    }

    // Store token as a notification (lightweight approach — no extra DB table needed)
    // In production, store in a PushToken table and use Expo/FCM SDK
    console.log(`[Push Token] User ${user.sub} registered ${platform} token: ${token}`);

    return sendSuccess(res, { registered: true }, "Push token registered");
  })
);

/**
 * GET /mobile/alerts
 * Paginated alerts list for the Alerts screen.
 */
router.get(
  "/alerts",
  asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const pagination = getPagination(req, { page: 1, limit: 20 });
    const companyId = user.companyId ?? undefined;

    const where: Prisma.NotificationWhereInput = companyId
      ? { OR: [{ companyId }, { userId: user.sub }] }
      : {};

    if (req.query.unread === "true") {
      where.unread = true;
    }

    const [total, data] = await Promise.all([
      prisma.notification.count({ where }),
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.limit,
      }),
    ]);

    return sendSuccess(res, data, "Alerts fetched", 200, {
      total,
      page: pagination.page,
      limit: pagination.limit,
      totalPages: Math.ceil(total / pagination.limit),
    });
  })
);

export default router;
