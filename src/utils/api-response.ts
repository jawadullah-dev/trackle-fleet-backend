import { Response } from "express";

export type ApiSuccess<T> = {
  success: true;
  message?: string;
  data: T;
  meta?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "Success",
  status = 200,
  meta?: ApiSuccess<T>["meta"]
) {
  return res.status(status).json({
    success: true,
    message,
    data,
    ...(meta ? { meta } : {}),
  });
}

export function sendError(
  res: Response,
  message: string,
  status = 400,
  errors?: unknown
) {
  return res.status(status).json({
    success: false,
    message,
    ...(errors ? { errors } : {}),
  });
}
