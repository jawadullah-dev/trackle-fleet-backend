import { Router } from "express";
import { Role } from "@prisma/client";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import {
  companyController,
  authController,
  userController,
  vehicleController,
  groupController,
  paymentController,
  maintenanceController,
  dashboardController,
  historyController,
} from "../controllers";
import {
  loginSchema,
  companySchema,
  companyUpdateSchema,
  userSchema,
  userUpdateSchema,
  vehicleSchema,
  vehicleUpdateSchema,
  groupSchema,
  groupUpdateSchema,
  paymentSchema,
  paymentUpdateSchema,
  maintenanceSchema,
  maintenanceUpdateSchema,
  idParamSchema,
  historyQuerySchema,
  historyDaysQuerySchema,
  gpsIngestSchema,
} from "../validators/schemas";

const router = Router();

router.get("/health", (_req, res) => {
  res.json({ success: true, message: "TrackFleet API is running" });
});

router.post("/auth/login", validate(loginSchema), authController.login);
router.get("/auth/me", authenticate, authController.me);

router.use(authenticate);

router.get("/dashboard/stats", dashboardController.stats);
router.get("/dashboard/activities", dashboardController.activities);
router.get("/notifications", dashboardController.notifications);
router.patch("/notifications/read-all", dashboardController.markAllRead);
router.patch("/notifications/:id/read", validate(idParamSchema, "params"), dashboardController.markRead);
router.post("/notifications/test", dashboardController.sendTestNotification);
router.get("/vehicles/map-pins", vehicleController.mapPins);

router.get(
  "/companies",
  authorize(Role.SUPER_ADMIN),
  companyController.list
);
router.get(
  "/companies/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  companyController.get
);
router.post(
  "/companies",
  authorize(Role.SUPER_ADMIN),
  validate(companySchema),
  companyController.create
);
router.patch(
  "/companies/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  validate(companyUpdateSchema),
  companyController.update
);
router.delete(
  "/companies/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  companyController.remove
);

router.get("/users", userController.list);
router.get("/users/:id", validate(idParamSchema, "params"), userController.get);
router.post(
  "/users",
  authorize(Role.SUPER_ADMIN),
  validate(userSchema),
  userController.create
);
router.patch(
  "/users/:id",
  validate(idParamSchema, "params"),
  validate(userUpdateSchema),
  userController.update
);
router.delete(
  "/users/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  userController.remove
);

router.get("/vehicles", vehicleController.list);
router.get("/vehicles/:id", validate(idParamSchema, "params"), vehicleController.get);
router.post("/vehicles", validate(vehicleSchema), vehicleController.create);
router.patch(
  "/vehicles/:id",
  validate(idParamSchema, "params"),
  validate(vehicleUpdateSchema),
  vehicleController.update
);
router.delete(
  "/vehicles/:id",
  validate(idParamSchema, "params"),
  vehicleController.remove
);

router.get("/groups", groupController.list);
router.get("/groups/:id", validate(idParamSchema, "params"), groupController.get);
router.post("/groups", validate(groupSchema), groupController.create);
router.patch(
  "/groups/:id",
  validate(idParamSchema, "params"),
  validate(groupUpdateSchema),
  groupController.update
);
router.delete(
  "/groups/:id",
  validate(idParamSchema, "params"),
  groupController.remove
);

router.get("/payments", authorize(Role.SUPER_ADMIN), paymentController.list);
router.get(
  "/payments/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  paymentController.get
);
router.post(
  "/payments",
  authorize(Role.SUPER_ADMIN),
  validate(paymentSchema),
  paymentController.create
);
router.patch(
  "/payments/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  validate(paymentUpdateSchema),
  paymentController.update
);
router.delete(
  "/payments/:id",
  authorize(Role.SUPER_ADMIN),
  validate(idParamSchema, "params"),
  paymentController.remove
);

router.get("/maintenance", maintenanceController.list);
router.get("/maintenance/summary", maintenanceController.summary);
router.get(
  "/maintenance/:id",
  validate(idParamSchema, "params"),
  maintenanceController.get
);
router.post(
  "/maintenance",
  validate(maintenanceSchema),
  maintenanceController.create
);
router.patch(
  "/maintenance/:id",
  validate(idParamSchema, "params"),
  validate(maintenanceUpdateSchema),
  maintenanceController.update
);
router.delete(
  "/maintenance/:id",
  validate(idParamSchema, "params"),
  maintenanceController.remove
);

router.get(
  "/history/days",
  validate(historyDaysQuerySchema, "query"),
  historyController.days
);
router.get(
  "/history",
  validate(historyQuerySchema, "query"),
  historyController.day
);
router.post(
  "/history/points",
  validate(gpsIngestSchema),
  historyController.ingest
);

export default router;
