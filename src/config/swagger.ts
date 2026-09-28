import type { OpenAPIV3 } from "openapi-types";

const spec: OpenAPIV3.Document = {
  openapi: "3.0.0",
  info: {
    title: "TrackFleet API",
    version: "1.0.0",
    description:
      "Complete REST API for the TrackFleet GPS Fleet Tracking Platform.\n\n" +
      "Supports the Web Admin Panel and Mobile App (iOS/Android).\n\n" +
      "**Authentication:** All protected endpoints require `Authorization: Bearer <token>`.\n\n" +
      "**Mobile endpoints** are prefixed with `/mobile` and tagged as Mobile.",
    contact: { name: "TrackFleet Team", email: "support@trackfleet.io" },
  },
  servers: [{ url: "/api", description: "API Server" }],
  tags: [
    { name: "Health", description: "API health check" },
    { name: "Auth", description: "Login and get current user" },
    { name: "Mobile", description: "Mobile-specific endpoints (iOS/Android)" },
    { name: "Vehicles", description: "Vehicle CRUD and map pins" },
    { name: "Groups", description: "Vehicle groups management" },
    { name: "Service History", description: "Vehicle service and maintenance history" },
    { name: "Notifications", description: "Alerts and notifications" },
    { name: "Dashboard", description: "Stats and recent activity" },
    { name: "Users", description: "User management" },
    { name: "Companies", description: "Company management (Super Admin only)" },
    { name: "Payments", description: "Payment management (Super Admin only)" },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT token from POST /auth/login",
      },
    },
    schemas: {
      LoginRequest: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email", example: "admin@globaltrucks.com" },
          password: { type: "string", example: "admin@123" },
        },
      },
      LoginResponse: {
        type: "object",
        properties: {
          token: { type: "string", example: "eyJhbGci..." },
          user: { $ref: "#/components/schemas/User" },
        },
      },
      User: {
        type: "object",
        properties: {
          id: { type: "string", example: "clxyz1234" },
          name: { type: "string", example: "John Smith" },
          email: { type: "string", example: "john@globaltrucks.com" },
          role: { type: "string", enum: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
          status: { type: "string", enum: ["ACTIVE", "INACTIVE", "PENDING"] },
          companyId: { type: "string", nullable: true },
          company: { $ref: "#/components/schemas/CompanyBrief", nullable: true } as OpenAPIV3.ReferenceObject,
          lastLogin: { type: "string", format: "date-time", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      CompanyBrief: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
      GroupBrief: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
        },
      },
      Vehicle: {
        type: "object",
        properties: {
          id: { type: "string", example: "clveh001" },
          name: { type: "string", example: "Car 1" },
          regNo: { type: "string", example: "BX-001" },
          type: { type: "string", example: "Box Lift Car" },
          deviceId: { type: "string", example: "TK00345689" },
          currentKm: { type: "number", example: 48230 },
          status: { type: "string", enum: ["ONLINE", "OFFLINE"] },
          latitude: { type: "number", nullable: true },
          longitude: { type: "number", nullable: true },
          companyId: { type: "string" },
          groupId: { type: "string", nullable: true },
          lastUpdate: { type: "string", format: "date-time" },
          company: { $ref: "#/components/schemas/CompanyBrief", nullable: true } as OpenAPIV3.ReferenceObject,
          group: { $ref: "#/components/schemas/GroupBrief", nullable: true } as OpenAPIV3.ReferenceObject,
          maintenance: {
            type: "array",
            items: { $ref: "#/components/schemas/ServiceHistory" },
          },
        },
      },
      VehicleGroup: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string", example: "Box Lift Cars" },
          description: { type: "string", nullable: true },
          companyId: { type: "string" },
          count: { type: "number", example: 4 },
        },
      },
      ServiceHistory: {
        type: "object",
        properties: {
          id: { type: "string" },
          serviceType: { type: "string", example: "Engine Oil" },
          intervalKm: { type: "number", example: 10000 },
          lastServiceKm: { type: "number", example: 40000 },
          nextServiceKm: { type: "number", example: 50000 },
          status: { type: "string", enum: ["ON_TRACK", "DUE_SOON", "OVERDUE"] },
          vehicleId: { type: "string" },
        },
      },
      Notification: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string", example: "Engine oil service due" },
          body: { type: "string", example: "Car 1 - 50,000 km" },
          unread: { type: "boolean", example: true },
          userId: { type: "string", nullable: true },
          companyId: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      MapPin: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          status: { type: "string", enum: ["ONLINE", "OFFLINE"] },
          latitude: { type: "number", nullable: true },
          longitude: { type: "number", nullable: true },
        },
      },
      MobileDashboard: {
        type: "object",
        properties: {
          user: { $ref: "#/components/schemas/User" },
          stats: {
            type: "object",
            properties: {
              totalVehicles: { type: "number", example: 12 },
              onlineVehicles: { type: "number", example: 10 },
              offlineVehicles: { type: "number", example: 2 },
              totalGroups: { type: "number", example: 3 },
              unreadAlerts: { type: "number", example: 2 },
            },
          },
          recentAlerts: {
            type: "array",
            items: { $ref: "#/components/schemas/Notification" },
          },
        },
      },
      ApiResponse: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          message: { type: "string" },
          data: {},
          meta: {
            type: "object",
            nullable: true,
            properties: {
              total: { type: "number" },
              page: { type: "number" },
              limit: { type: "number" },
              totalPages: { type: "number" },
            },
          },
        },
      },
      Error: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          message: { type: "string", example: "Authentication required" },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        security: [],
        responses: {
          "200": { description: "API is running" },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Login",
        description: "Authenticate with email and password. Returns a JWT token.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/LoginRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginResponse" },
              },
            },
          },
          "401": { description: "Invalid credentials" },
        },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current user",
        responses: {
          "200": {
            description: "Current user",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/mobile/dashboard": {
      get: {
        tags: ["Mobile"],
        summary: "[Mobile] Home dashboard",
        description:
          "Combined dashboard payload for the mobile home screen. Returns user profile, vehicle stats, and recent alerts in one request.",
        responses: {
          "200": {
            description: "Mobile dashboard data",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MobileDashboard" },
              },
            },
          },
        },
      },
    },
    "/mobile/map": {
      get: {
        tags: ["Mobile"],
        summary: "[Mobile] Live map pins",
        description: "All vehicles with GPS coordinates for the Live Map screen.",
        responses: {
          "200": {
            description: "Map pins",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/MapPin" },
                },
              },
            },
          },
        },
      },
    },
    "/mobile/profile": {
      get: {
        tags: ["Mobile"],
        summary: "[Mobile] Get profile",
        description: "Returns the authenticated user profile for the Profile screen.",
        responses: {
          "200": {
            description: "User profile",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/User" },
              },
            },
          },
        },
      },
      patch: {
        tags: ["Mobile"],
        summary: "[Mobile] Update profile",
        description: "Update name and/or change password from the Profile screen.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", example: "John Smith" },
                  currentPassword: { type: "string", example: "oldPass123" },
                  newPassword: { type: "string", example: "newPass456" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Profile updated" },
          "400": { description: "Current password incorrect" },
        },
      },
    },
    "/mobile/push-token": {
      post: {
        tags: ["Mobile"],
        summary: "[Mobile] Register push token",
        description: "Register a device push token (Expo/FCM/APNs) for push notifications.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token", "platform"],
                properties: {
                  token: { type: "string", example: "ExponentPushToken[xxxxxx]" },
                  platform: { type: "string", enum: ["ios", "android"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Token registered" },
        },
      },
    },
    "/mobile/alerts": {
      get: {
        tags: ["Mobile"],
        summary: "[Mobile] Get alerts",
        description: "Paginated alerts list for the Alerts screen.",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          {
            name: "unread",
            in: "query",
            schema: { type: "boolean" },
            description: "Filter to unread only",
          },
        ],
        responses: {
          "200": {
            description: "Alerts list",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Notification" },
                },
              },
            },
          },
        },
      },
    },
    "/vehicles": {
      get: {
        tags: ["Vehicles"],
        summary: "List vehicles",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "groupId", in: "query", schema: { type: "string" } },
          { name: "companyId", in: "query", schema: { type: "string" }, description: "Super Admin only" },
        ],
        responses: {
          "200": {
            description: "Vehicles list",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Vehicle" } },
              },
            },
          },
        },
      },
      post: {
        tags: ["Vehicles"],
        summary: "Create vehicle",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "regNo", "type", "deviceId"],
                properties: {
                  name: { type: "string", example: "Car 1" },
                  regNo: { type: "string", example: "BX-001" },
                  type: { type: "string", example: "Box Lift Car" },
                  deviceId: { type: "string", example: "TK00345689" },
                  currentKm: { type: "number", example: 0 },
                  groupId: { type: "string", nullable: true },
                  companyId: { type: "string", description: "Required for Super Admin" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Vehicle created" } },
      },
    },
    "/vehicles/{id}": {
      get: {
        tags: ["Vehicles"],
        summary: "Get vehicle by ID",
        description: "Returns full vehicle details including service history.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": {
            description: "Vehicle details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Vehicle" },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
      patch: {
        tags: ["Vehicles"],
        summary: "Update vehicle",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  currentKm: { type: "number" },
                  status: { type: "string", enum: ["ONLINE", "OFFLINE"] },
                  latitude: { type: "number" },
                  longitude: { type: "number" },
                  groupId: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Vehicle updated" } },
      },
      delete: {
        tags: ["Vehicles"],
        summary: "Delete vehicle",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Vehicle deleted" } },
      },
    },
    "/vehicles/map-pins": {
      get: {
        tags: ["Vehicles"],
        summary: "Get live map pins",
        description: "Minimal vehicle data (id, name, status, lat, lng) for map rendering.",
        responses: {
          "200": {
            description: "Map pins",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/MapPin" } },
              },
            },
          },
        },
      },
    },
    "/groups": {
      get: {
        tags: ["Groups"],
        summary: "List vehicle groups",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Groups list" } },
      },
      post: {
        tags: ["Groups"],
        summary: "Create group",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", example: "Box Lift Cars" },
                  description: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Group created" } },
      },
    },
    "/groups/{id}": {
      get: {
        tags: ["Groups"],
        summary: "Get group by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Group details" } },
      },
      patch: {
        tags: ["Groups"],
        summary: "Update group",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Group updated" } },
      },
      delete: {
        tags: ["Groups"],
        summary: "Delete group",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Group deleted" } },
      },
    },
    "/maintenance": {
      get: {
        tags: ["Service History"],
        summary: "List service history records",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "vehicleId", in: "query", schema: { type: "string" } },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["ON_TRACK", "DUE_SOON", "OVERDUE"] },
          },
        ],
        responses: {
          "200": {
            description: "Service records",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/ServiceHistory" } },
              },
            },
          },
        },
      },
      post: {
        tags: ["Service History"],
        summary: "Add service record",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["vehicleId", "serviceType", "intervalKm", "lastServiceKm", "nextServiceKm"],
                properties: {
                  vehicleId: { type: "string" },
                  serviceType: { type: "string", example: "Engine Oil" },
                  intervalKm: { type: "number", example: 10000 },
                  lastServiceKm: { type: "number", example: 40000 },
                  nextServiceKm: { type: "number", example: 50000 },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Service record created" } },
      },
    },
    "/maintenance/summary": {
      get: {
        tags: ["Service History"],
        summary: "Service history summary",
        description: "Returns counts of ON_TRACK / DUE_SOON / OVERDUE records.",
        responses: { "200": { description: "Summary counts" } },
      },
    },
    "/maintenance/{id}": {
      get: {
        tags: ["Service History"],
        summary: "Get service record",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Service record" } },
      },
      patch: {
        tags: ["Service History"],
        summary: "Update service record",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  serviceType: { type: "string" },
                  intervalKm: { type: "number" },
                  lastServiceKm: { type: "number" },
                  nextServiceKm: { type: "number" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Record updated" } },
      },
      delete: {
        tags: ["Service History"],
        summary: "Delete service record",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Record deleted" } },
      },
    },
    "/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "List notifications",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: {
          "200": {
            description: "Notifications",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Notification" } },
              },
            },
          },
        },
      },
    },
    "/notifications/{id}/read": {
      patch: {
        tags: ["Notifications"],
        summary: "Mark notification as read",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Marked as read" } },
      },
    },
    "/notifications/read-all": {
      patch: {
        tags: ["Notifications"],
        summary: "Mark all notifications as read",
        responses: { "200": { description: "All marked as read" } },
      },
    },
    "/dashboard/stats": {
      get: {
        tags: ["Dashboard"],
        summary: "Dashboard stats",
        description:
          "Stat cards for the dashboard. Super Admin gets company + vehicle counts. Company Admin gets vehicle + online counts.",
        responses: { "200": { description: "Dashboard statistics" } },
      },
    },
    "/dashboard/activities": {
      get: {
        tags: ["Dashboard"],
        summary: "Recent activities",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
        ],
        responses: { "200": { description: "Activity feed" } },
      },
    },
    "/users": {
      get: {
        tags: ["Users"],
        summary: "List users",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "search", in: "query", schema: { type: "string" } },
          { name: "role", in: "query", schema: { type: "string", enum: ["SUPER_ADMIN", "COMPANY_ADMIN"] } },
        ],
        responses: { "200": { description: "Users list" } },
      },
      post: {
        tags: ["Users"],
        summary: "Create user (Super Admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "email", "password"],
                properties: {
                  name: { type: "string" },
                  email: { type: "string", format: "email" },
                  password: { type: "string" },
                  role: { type: "string", enum: ["SUPER_ADMIN", "COMPANY_ADMIN"] },
                  companyId: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "User created" } },
      },
    },
    "/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Get user by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "User details" } },
      },
      patch: {
        tags: ["Users"],
        summary: "Update user",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  status: { type: "string", enum: ["ACTIVE", "INACTIVE"] },
                },
              },
            },
          },
        },
        responses: { "200": { description: "User updated" } },
      },
      delete: {
        tags: ["Users"],
        summary: "Delete user (Super Admin only)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "User deleted" } },
      },
    },
    "/companies": {
      get: {
        tags: ["Companies"],
        summary: "List companies (Super Admin only)",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Companies list" } },
      },
      post: {
        tags: ["Companies"],
        summary: "Create company (Super Admin only)",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", example: "Global Trucks" },
                  plan: { type: "string", enum: ["BASIC", "PRO", "ENTERPRISE"] },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Company created" } },
      },
    },
    "/companies/{id}": {
      get: {
        tags: ["Companies"],
        summary: "Get company by ID",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Company details" } },
      },
      patch: {
        tags: ["Companies"],
        summary: "Update company",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  status: { type: "string", enum: ["ACTIVE", "INACTIVE", "PENDING"] },
                  plan: { type: "string", enum: ["BASIC", "PRO", "ENTERPRISE"] },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Company updated" } },
      },
      delete: {
        tags: ["Companies"],
        summary: "Delete company",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Company deleted" } },
      },
    },
    "/payments": {
      get: {
        tags: ["Payments"],
        summary: "List payments (Super Admin only)",
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
        ],
        responses: { "200": { description: "Payments list" } },
      },
    },
  },
};

export const swaggerSpec = spec;
