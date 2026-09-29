import { Response } from "express";
import { Role } from "@prisma/client";
import { AuthRequest } from "../middleware/auth";
import { sendSuccess } from "../utils/api-response";
import { getPagination } from "../utils/pagination";
import { asyncHandler } from "../utils/async-handler";
import * as authService from "../services/auth.service";
import * as companyService from "../services/company.service";
import * as userService from "../services/user.service";
import * as vehicleService from "../services/vehicle.service";
import * as groupService from "../services/group.service";
import * as paymentService from "../services/payment.service";
import * as maintenanceService from "../services/maintenance.service";
import * as dashboardService from "../services/dashboard.service";
import * as historyService from "../services/history.service";
import { createAndEmitNotification } from "../services/socket.service";
import { AppError } from "../utils/app-error";

function requireUser(req: AuthRequest) {
  if (!req.user) throw new AppError("Authentication required", 401);
  return req.user;
}

export const authController = {
  login: asyncHandler(async (req, res) => {
    const data = await authService.login(req.body.email, req.body.password);
    return sendSuccess(res, data, "Logged in successfully");
  }),
  me: asyncHandler(async (req: AuthRequest, res: Response) => {
    const user = requireUser(req);
    const data = await authService.getMe(user.sub);
    return sendSuccess(res, data);
  }),
};

export const companyController = {
  list: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    if (user.role !== Role.SUPER_ADMIN) {
      throw new AppError("Only super admin can list companies", 403);
    }
    const pagination = getPagination(req);
    const result = await companyService.listCompanies({
      ...pagination,
      user,
      filters: {
        status: req.query.status,
        plan: req.query.plan,
      },
    });
    return sendSuccess(res, result.data, "Companies fetched", 200, result.meta);
  }),
  get: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    if (user.role !== Role.SUPER_ADMIN) {
      throw new AppError("Only super admin can view companies", 403);
    }
    const data = await companyService.getCompany(String(req.params.id));
    return sendSuccess(res, data);
  }),
  create: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    if (user.role !== Role.SUPER_ADMIN) {
      throw new AppError("Only super admin can create companies", 403);
    }
    const data = await companyService.createCompany(req.body);
    return sendSuccess(res, data, "Company created", 201);
  }),
  update: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    if (user.role !== Role.SUPER_ADMIN) {
      throw new AppError("Only super admin can update companies", 403);
    }
    const data = await companyService.updateCompany(String(req.params.id), req.body);
    return sendSuccess(res, data, "Company updated");
  }),
  remove: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    if (user.role !== Role.SUPER_ADMIN) {
      throw new AppError("Only super admin can delete companies", 403);
    }
    const data = await companyService.deleteCompany(String(req.params.id));
    return sendSuccess(res, data, "Company deleted");
  }),
};

export const userController = {
  list: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const pagination = getPagination(req);
    const result = await userService.listUsers({
      ...pagination,
      user,
      filters: {
        status: req.query.status,
        role: req.query.role,
        companyId: req.query.companyId,
      },
    });
    return sendSuccess(res, result.data, "Users fetched", 200, result.meta);
  }),
  get: asyncHandler(async (req: AuthRequest, res) => {
    const data = await userService.getUser(String(req.params.id), requireUser(req));
    return sendSuccess(res, data);
  }),
  create: asyncHandler(async (req: AuthRequest, res) => {
    const data = await userService.createUser(req.body, requireUser(req));
    return sendSuccess(res, data, "User created", 201);
  }),
  update: asyncHandler(async (req: AuthRequest, res) => {
    const data = await userService.updateUser(
      String(req.params.id),
      req.body,
      requireUser(req)
    );
    return sendSuccess(res, data, "User updated");
  }),
  remove: asyncHandler(async (req: AuthRequest, res) => {
    const data = await userService.deleteUser(String(req.params.id), requireUser(req));
    return sendSuccess(res, data, "User deleted");
  }),
};

export const vehicleController = {
  list: asyncHandler(async (req: AuthRequest, res) => {
    const pagination = getPagination(req);
    const result = await vehicleService.listVehicles({
      ...pagination,
      user: requireUser(req),
      filters: {
        status: req.query.status,
        companyId: req.query.companyId,
        groupId: req.query.groupId,
      },
    });
    return sendSuccess(res, result.data, "Vehicles fetched", 200, result.meta);
  }),
  get: asyncHandler(async (req: AuthRequest, res) => {
    const data = await vehicleService.getVehicle(String(req.params.id), requireUser(req));
    return sendSuccess(res, data);
  }),
  create: asyncHandler(async (req: AuthRequest, res) => {
    const data = await vehicleService.createVehicle(req.body, requireUser(req));
    return sendSuccess(res, data, "Vehicle created", 201);
  }),
  update: asyncHandler(async (req: AuthRequest, res) => {
    const data = await vehicleService.updateVehicle(
      String(req.params.id),
      req.body,
      requireUser(req)
    );
    return sendSuccess(res, data, "Vehicle updated");
  }),
  remove: asyncHandler(async (req: AuthRequest, res) => {
    const data = await vehicleService.deleteVehicle(
      String(req.params.id),
      requireUser(req)
    );
    return sendSuccess(res, data, "Vehicle deleted");
  }),
  mapPins: asyncHandler(async (req: AuthRequest, res) => {
    const data = await vehicleService.listMapPins(requireUser(req));
    return sendSuccess(res, data);
  }),
};

export const groupController = {
  list: asyncHandler(async (req: AuthRequest, res) => {
    const pagination = getPagination(req, { page: 1, limit: 50 });
    const result = await groupService.listGroups({
      ...pagination,
      user: requireUser(req),
      filters: { companyId: req.query.companyId },
    });
    return sendSuccess(res, result.data, "Groups fetched", 200, result.meta);
  }),
  get: asyncHandler(async (req: AuthRequest, res) => {
    const data = await groupService.getGroup(String(req.params.id), requireUser(req));
    return sendSuccess(res, data);
  }),
  create: asyncHandler(async (req: AuthRequest, res) => {
    const data = await groupService.createGroup(req.body, requireUser(req));
    return sendSuccess(res, data, "Group created", 201);
  }),
  update: asyncHandler(async (req: AuthRequest, res) => {
    const data = await groupService.updateGroup(
      String(req.params.id),
      req.body,
      requireUser(req)
    );
    return sendSuccess(res, data, "Group updated");
  }),
  remove: asyncHandler(async (req: AuthRequest, res) => {
    const data = await groupService.deleteGroup(String(req.params.id), requireUser(req));
    return sendSuccess(res, data, "Group deleted");
  }),
};

export const paymentController = {
  list: asyncHandler(async (req: AuthRequest, res) => {
    const pagination = getPagination(req);
    const result = await paymentService.listPayments({
      ...pagination,
      user: requireUser(req),
      filters: {
        status: req.query.status,
        companyId: req.query.companyId,
      },
    });
    return sendSuccess(res, result.data, "Payments fetched", 200, result.meta);
  }),
  get: asyncHandler(async (req: AuthRequest, res) => {
    const data = await paymentService.getPayment(String(req.params.id), requireUser(req));
    return sendSuccess(res, data);
  }),
  create: asyncHandler(async (req: AuthRequest, res) => {
    const data = await paymentService.createPayment(req.body, requireUser(req));
    return sendSuccess(res, data, "Payment created", 201);
  }),
  update: asyncHandler(async (req: AuthRequest, res) => {
    const data = await paymentService.updatePayment(
      String(req.params.id),
      req.body,
      requireUser(req)
    );
    return sendSuccess(res, data, "Payment updated");
  }),
  remove: asyncHandler(async (req: AuthRequest, res) => {
    const data = await paymentService.deletePayment(
      String(req.params.id),
      requireUser(req)
    );
    return sendSuccess(res, data, "Payment deleted");
  }),
};

export const maintenanceController = {
  list: asyncHandler(async (req: AuthRequest, res) => {
    const pagination = getPagination(req);
    const result = await maintenanceService.listMaintenance({
      ...pagination,
      user: requireUser(req),
      filters: {
        status: req.query.status,
        serviceType: req.query.serviceType,
        vehicleId: req.query.vehicleId,
        companyId: req.query.companyId,
      },
    });
    return sendSuccess(res, result.data, "Maintenance fetched", 200, result.meta);
  }),
  summary: asyncHandler(async (req: AuthRequest, res) => {
    const data = await maintenanceService.maintenanceSummary(requireUser(req));
    return sendSuccess(res, data);
  }),
  get: asyncHandler(async (req: AuthRequest, res) => {
    const data = await maintenanceService.getMaintenance(
      String(req.params.id),
      requireUser(req)
    );
    return sendSuccess(res, data);
  }),
  create: asyncHandler(async (req: AuthRequest, res) => {
    const data = await maintenanceService.createMaintenance(req.body, requireUser(req));
    return sendSuccess(res, data, "Maintenance created", 201);
  }),
  update: asyncHandler(async (req: AuthRequest, res) => {
    const data = await maintenanceService.updateMaintenance(
      String(req.params.id),
      req.body,
      requireUser(req)
    );
    return sendSuccess(res, data, "Maintenance updated");
  }),
  remove: asyncHandler(async (req: AuthRequest, res) => {
    const data = await maintenanceService.deleteMaintenance(
      String(req.params.id),
      requireUser(req)
    );
    return sendSuccess(res, data, "Maintenance deleted");
  }),
};

export const dashboardController = {
  stats: asyncHandler(async (req: AuthRequest, res) => {
    const data = await dashboardService.getDashboardStats(requireUser(req));
    return sendSuccess(res, data);
  }),
  activities: asyncHandler(async (req: AuthRequest, res) => {
    const pagination = getPagination(req, { page: 1, limit: 10 });
    const result = await dashboardService.listActivities(
      requireUser(req),
      pagination.page,
      pagination.limit,
      pagination.skip
    );
    return sendSuccess(res, result.data, "Activities fetched", 200, result.meta);
  }),
  notifications: asyncHandler(async (req: AuthRequest, res) => {
    const pagination = getPagination(req);
    const result = await dashboardService.listNotifications(
      requireUser(req),
      pagination.page,
      pagination.limit,
      pagination.skip
    );
    return sendSuccess(res, result.data, "Notifications fetched", 200, result.meta);
  }),
  markRead: asyncHandler(async (req: AuthRequest, res) => {
    const data = await dashboardService.markNotificationRead(
      String(req.params.id),
      requireUser(req)
    );
    if (!data) throw new AppError("Notification not found", 404);
    return sendSuccess(res, data, "Notification updated");
  }),
  markAllRead: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const data = await dashboardService.markAllNotificationsRead(user);
    return sendSuccess(res, data, "All notifications marked as read");
  }),
  sendTestNotification: asyncHandler(async (req: AuthRequest, res) => {
    const user = requireUser(req);
    const title = req.body?.title || "Real-Time Fleet Alert";
    const body =
      req.body?.body ||
      `Live WebSocket notification triggered at ${new Date().toLocaleTimeString()}`;
    const notification = await createAndEmitNotification({
      title,
      body,
      companyId: user.companyId ?? undefined,
      userId: user.role === Role.SUPER_ADMIN ? undefined : user.sub,
    });
    return sendSuccess(
      res,
      notification,
      "Test notification dispatched via Socket.IO",
      201
    );
  }),
};

export const historyController = {
  day: asyncHandler(async (req: AuthRequest, res) => {
    const data = await historyService.getDayHistory(
      requireUser(req),
      String(req.query.vehicleId || ""),
      String(req.query.date || "")
    );
    return sendSuccess(res, data, "History fetched");
  }),
  days: asyncHandler(async (req: AuthRequest, res) => {
    const data = await historyService.getHistoryDays(
      requireUser(req),
      String(req.query.vehicleId || ""),
      String(req.query.month || "")
    );
    return sendSuccess(res, data, "History days fetched");
  }),
  ingest: asyncHandler(async (req: AuthRequest, res) => {
    const data = await historyService.ingestGpsPoints(requireUser(req), req.body);
    return sendSuccess(res, data, "GPS points ingested", 201);
  }),
};
