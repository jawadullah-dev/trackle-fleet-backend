import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { AppError } from "../utils/app-error";
import { sendError } from "../utils/api-response";
import { JwtPayload, verifyToken } from "../utils/auth";

export type AuthRequest = Request & {
  user?: JwtPayload;
};

export function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new AppError("Authentication required", 401);
    }
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError("Invalid or expired token", 401));
  }
}

export function authorize(...roles: Role[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new AppError("Authentication required", 401));
    if (!roles.includes(req.user.role)) {
      return next(new AppError("You do not have permission for this action", 403));
    }
    next();
  };
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return sendError(res, err.message, err.statusCode, err.errors);
  }

  console.error(err);
  return sendError(res, "Internal server error", 500);
}

export function notFound(_req: Request, res: Response) {
  return sendError(res, "Route not found", 404);
}
