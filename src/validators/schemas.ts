import Joi from "joi";

/** Keep messages aligned with admin/src/lib/validation.ts (Yup) */

export const loginSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email",
    "any.required": "Email is required",
    "string.empty": "Email is required",
  }),
  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters",
    "any.required": "Password is required",
    "string.empty": "Password is required",
  }),
});

export const companySchema = Joi.object({
  name: Joi.string().min(2).max(120).required().messages({
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name must be at most 120 characters",
    "any.required": "Company name is required",
    "string.empty": "Company name is required",
  }),
  logo: Joi.string().allow("", null),
  plan: Joi.string().valid("BASIC", "PRO", "ENTERPRISE").default("PRO").messages({
    "any.only": "Invalid plan",
  }),
  status: Joi.string().valid("ACTIVE", "INACTIVE", "PENDING").default("ACTIVE").messages({
    "any.only": "Invalid status",
  }),
});

export const companyUpdateSchema = companySchema.fork(
  ["name", "logo", "plan", "status"],
  (s) => s.optional()
);

export const userSchema = Joi.object({
  name: Joi.string().min(2).max(120).required().messages({
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name must be at most 120 characters",
    "any.required": "Name is required",
    "string.empty": "Name is required",
  }),
  email: Joi.string().email().required().messages({
    "string.email": "Enter a valid email",
    "any.required": "Email is required",
    "string.empty": "Email is required",
  }),
  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters",
    "any.required": "Password is required",
    "string.empty": "Password is required",
  }),
  role: Joi.string().valid("COMPANY_ADMIN").default("COMPANY_ADMIN"),
  status: Joi.string().valid("ACTIVE", "INACTIVE", "PENDING").default("ACTIVE").messages({
    "any.only": "Invalid status",
  }),
  companyId: Joi.string().required().messages({
    "any.required": "Company is required",
    "string.empty": "Company is required",
  }),
});

export const userUpdateSchema = Joi.object({
  name: Joi.string().min(2).max(120).messages({
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name must be at most 120 characters",
  }),
  email: Joi.string().email().messages({
    "string.email": "Enter a valid email",
  }),
  password: Joi.string().min(6).messages({
    "string.min": "Password must be at least 6 characters",
  }),
  status: Joi.string().valid("ACTIVE", "INACTIVE", "PENDING").messages({
    "any.only": "Invalid status",
  }),
  companyId: Joi.string().allow(null),
}).min(1);

export const groupSchema = Joi.object({
  name: Joi.string().min(2).max(120).required().messages({
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name must be at most 120 characters",
    "any.required": "Name is required",
    "string.empty": "Name is required",
  }),
  description: Joi.string().allow("", null),
  companyId: Joi.string().optional(),
});

export const groupUpdateSchema = Joi.object({
  name: Joi.string().min(2).max(120).messages({
    "string.min": "Name must be at least 2 characters",
    "string.max": "Name must be at most 120 characters",
  }),
  description: Joi.string().allow("", null),
}).min(1);

export const vehicleSchema = Joi.object({
  name: Joi.string().min(1).max(120).required().messages({
    "string.min": "Name is required",
    "string.max": "Name must be at most 120 characters",
    "any.required": "Name is required",
    "string.empty": "Name is required",
  }),
  regNo: Joi.string().min(2).max(40).required().messages({
    "string.min": "Registration No must be at least 2 characters",
    "string.max": "Registration No must be at most 40 characters",
    "any.required": "Registration No is required",
    "string.empty": "Registration No is required",
  }),
  type: Joi.string().min(2).max(80).required().messages({
    "string.min": "Type must be at least 2 characters",
    "string.max": "Type must be at most 80 characters",
    "any.required": "Type is required",
    "string.empty": "Type is required",
  }),
  deviceId: Joi.string().min(2).max(80).required().messages({
    "string.min": "Device ID must be at least 2 characters",
    "string.max": "Device ID must be at most 80 characters",
    "any.required": "Device ID is required",
    "string.empty": "Device ID is required",
  }),
  currentKm: Joi.number().integer().min(0).default(0).messages({
    "number.base": "Current KM is required",
    "number.integer": "Current KM must be a whole number",
    "number.min": "Current KM cannot be negative",
  }),
  status: Joi.string().valid("ONLINE", "OFFLINE").default("OFFLINE").messages({
    "any.only": "Invalid status",
  }),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  companyId: Joi.string().optional(),
  groupId: Joi.string().allow(null, ""),
});

export const vehicleUpdateSchema = vehicleSchema.fork(
  ["name", "regNo", "type", "deviceId", "currentKm", "status", "latitude", "longitude", "companyId", "groupId"],
  (s) => s.optional()
).min(1);

export const paymentSchema = Joi.object({
  companyId: Joi.string().required().messages({
    "any.required": "Company is required",
    "string.empty": "Company is required",
  }),
  invoice: Joi.string().min(3).max(60).required().messages({
    "string.min": "Invoice must be at least 3 characters",
    "string.max": "Invoice must be at most 60 characters",
    "any.required": "Invoice is required",
    "string.empty": "Invoice is required",
  }),
  amount: Joi.number().positive().required().messages({
    "number.base": "Amount is required",
    "number.positive": "Amount must be greater than 0",
    "any.required": "Amount is required",
  }),
  period: Joi.string().min(3).max(40).required().messages({
    "string.min": "Period must be at least 3 characters",
    "string.max": "Period must be at most 40 characters",
    "any.required": "Period is required",
    "string.empty": "Period is required",
  }),
  method: Joi.string().allow("", null),
  status: Joi.string().valid("PAID", "UNPAID", "PENDING", "OVERDUE").default("PENDING").messages({
    "any.only": "Invalid status",
  }),
  dueDate: Joi.date().iso().required().messages({
    "any.required": "Due date is required",
    "date.base": "Due date must be a valid date",
    "date.format": "Due date must be a valid date",
  }),
  paidAt: Joi.date().iso().allow(null),
});

export const paymentUpdateSchema = paymentSchema.fork(
  ["companyId", "invoice", "amount", "period", "method", "status", "dueDate", "paidAt"],
  (s) => s.optional()
).min(1);

export const maintenanceSchema = Joi.object({
  vehicleId: Joi.string().required().messages({
    "any.required": "Vehicle is required",
    "string.empty": "Vehicle is required",
  }),
  serviceType: Joi.string().min(2).max(120).required().messages({
    "string.min": "Service type must be at least 2 characters",
    "string.max": "Service type must be at most 120 characters",
    "any.required": "Service type is required",
    "string.empty": "Service type is required",
  }),
  intervalKm: Joi.number().integer().positive().required().messages({
    "number.base": "Interval KM is required",
    "number.integer": "Interval must be a whole number",
    "number.positive": "Interval must be greater than 0",
    "any.required": "Interval KM is required",
  }),
  lastServiceKm: Joi.number().integer().min(0).required().messages({
    "number.base": "Last service KM is required",
    "number.integer": "Last service must be a whole number",
    "number.min": "Last service cannot be negative",
    "any.required": "Last service KM is required",
  }),
  nextServiceKm: Joi.number().integer().min(0).required().messages({
    "number.base": "Next service KM is required",
    "number.integer": "Next service must be a whole number",
    "number.min": "Next service cannot be negative",
    "any.required": "Next service KM is required",
  }),
});

export const maintenanceUpdateSchema = Joi.object({
  serviceType: Joi.string().min(2).max(120).messages({
    "string.min": "Service type must be at least 2 characters",
    "string.max": "Service type must be at most 120 characters",
  }),
  intervalKm: Joi.number().integer().positive().messages({
    "number.integer": "Interval must be a whole number",
    "number.positive": "Interval must be greater than 0",
  }),
  lastServiceKm: Joi.number().integer().min(0).messages({
    "number.integer": "Last service must be a whole number",
    "number.min": "Last service cannot be negative",
  }),
  nextServiceKm: Joi.number().integer().min(0).messages({
    "number.integer": "Next service must be a whole number",
    "number.min": "Next service cannot be negative",
  }),
}).min(1);

export const idParamSchema = Joi.object({
  id: Joi.string().required(),
});
