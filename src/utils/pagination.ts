import { Request } from "express";

export type PaginationQuery = {
  page: number;
  limit: number;
  skip: number;
  search?: string;
  sortBy: string;
  sortOrder: "asc" | "desc";
};

export function getPagination(req: Request, defaults = { page: 1, limit: 10 }): PaginationQuery {
  const page = Math.max(1, Number(req.query.page) || defaults.page);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || defaults.limit));
  const search = typeof req.query.search === "string" ? req.query.search.trim() : undefined;
  const sortBy = typeof req.query.sortBy === "string" ? req.query.sortBy : "createdAt";
  const sortOrder = req.query.sortOrder === "asc" ? "asc" : "desc";

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    search: search || undefined,
    sortBy,
    sortOrder,
  };
}

export function buildMeta(total: number, page: number, limit: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}
