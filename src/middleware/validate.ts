import { NextFunction, Request, Response } from "express";
import Joi from "joi";
import { AppError } from "../utils/app-error";

type Source = "body" | "query" | "params";

export function validate(schema: Joi.ObjectSchema, source: Source = "body") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
      errors: { wrap: { label: false } },
    });

    if (error) {
      return next(
        new AppError(
          "Validation failed",
          422,
          error.details.map((d) => ({
            field: d.path.join("."),
            message: d.message.replace(/^"[^"]+"\s*/, "").trim(),
          }))
        )
      );
    }

    req[source] = value;
    next();
  };
}
