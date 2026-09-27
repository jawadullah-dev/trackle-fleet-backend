import { MaintenanceStatus } from "@prisma/client";

export function computeMaintenanceStatus(
  currentKm: number,
  nextServiceKm: number
): MaintenanceStatus {
  const remaining = nextServiceKm - currentKm;
  if (remaining <= 0) return MaintenanceStatus.OVERDUE;
  if (remaining <= 500) return MaintenanceStatus.DUE_SOON;
  return MaintenanceStatus.ON_TRACK;
}
