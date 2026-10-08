DELETE FROM "GpsPoint";
DELETE FROM "Maintenance";
DELETE FROM "Payment";
DELETE FROM "Activity";
DELETE FROM "Notification";
DELETE FROM "Vehicle";
DELETE FROM "VehicleGroup";
DELETE FROM "Company";
DELETE FROM "User" WHERE email NOT IN ('super-admin@gmail.com', 'admin@gmail.com');