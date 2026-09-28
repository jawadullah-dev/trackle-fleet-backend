import swaggerJsdoc from "swagger-jsdoc";

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "TrackFleet API",
      version: "1.0.0",
      description: `
## TrackFleet GPS Fleet Tracking API

Complete REST API for the TrackFleet platform. Supports both the **Web Admin Panel** and **Mobile App (iOS/Android)**.

### Authentication
All protected endpoints require a Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <your_jwt_token>
\`\`\`

### Base URL
- **Local:** \`http://localhost:5000/api\`
- **Production:** \`https://trackle-fleet-backend.vercel.app/api\`

### Roles
- \`SUPER_ADMIN\` — Platform-wide access
- \`COMPANY_ADMIN\` — Scoped to their company only

### Mobile Endpoints
All mobile-specific endpoints are prefixed with \`/mobile\` and documented in the **Mobile** tag.
      `,
      contact: {
        name: "TrackFleet Team",
        email: "support@trackfleet.io",
      },
    },
    servers: [
      {
        url: "/api",
        description: "API Server (works on both local and Vercel)",
      },
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT token obtained from POST /auth/login",
        },
      },
      schemas: {
        LoginRequest: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email", example: "company-admin@example.com" },
            password: { type: "string", example: "admin@123" },
          },
        },
        LoginResponse: {
          type: "object",
          properties: {
            token: { type: "string", example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." },
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
            company: { $ref: "#/components/schemas/CompanyBrief", nullable: true },
            lastLogin: { type: "string", format: "date-time", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Company: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string", example: "Global Trucks" },
            logo: { type: "string", nullable: true },
            plan: { type: "string", enum: ["BASIC", "PRO", "ENTERPRISE"] },
            status: { type: "string", enum: ["ACTIVE", "INACTIVE", "PENDING"] },
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
            latitude: { type: "number", nullable: true, example: 25.2048 },
            longitude: { type: "number", nullable: true, example: 55.2708 },
            companyId: { type: "string" },
            groupId: { type: "string", nullable: true },
            lastUpdate: { type: "string", format: "date-time" },
            company: { $ref: "#/components/schemas/CompanyBrief", nullable: true },
            group: { $ref: "#/components/schemas/GroupBrief", nullable: true },
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
            company: { $ref: "#/components/schemas/CompanyBrief", nullable: true },
          },
        },
        GroupBrief: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
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
            body: { type: "string", example: "Car 1 • 50,000 km" },
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
            company: { $ref: "#/components/schemas/CompanyBrief", nullable: true },
          },
        },
        DashboardStats: {
          type: "object",
          properties: {
            role: { type: "string" },
            stats: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  label: { type: "string" },
                  value: { type: "number" },
                  tone: { type: "string" },
                },
              },
            },
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
        PushTokenRequest: {
          type: "object",
          required: ["token", "platform"],
          properties: {
            token: { type: "string", example: "ExponentPushToken[xxxxxx]" },
            platform: { type: "string", enum: ["ios", "android"], example: "android" },
          },
        },
        UpdateProfileRequest: {
          type: "object",
          properties: {
            name: { type: "string", example: "John Smith" },
            currentPassword: { type: "string", example: "currentPass123" },
            newPassword: { type: "string", example: "newPass456" },
          },
        },
        ApiResponse: {
          type: "object",
          properties: {
            success: { type: "boolean", example: true },
            message: { type: "string", example: "Data fetched successfully" },
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
    tags: [
      { name: "Health", description: "API health check" },
      { name: "Auth", description: "Authentication — Login and get current user" },
      { name: "Mobile", description: "📱 Mobile-specific endpoints (iOS/Android)" },
      { name: "Vehicles", description: "Vehicle CRUD and map pins" },
      { name: "Groups", description: "Vehicle groups management" },
      { name: "Service History", description: "Vehicle service/maintenance history" },
      { name: "Notifications", description: "Alerts and notifications" },
      { name: "Dashboard", description: "Stats and recent activity" },
      { name: "Users", description: "User management" },
      { name: "Companies", description: "Company management (Super Admin only)" },
      { name: "Payments", description: "Payment management (Super Admin only)" },
    ],
    paths: {
      "/health": {
        get: {
          tags: ["Health"],
          summary: "Health check",
          security: [],
          responses: {
            "200": {
              description: "API is running",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiResponse" },
                },
              },
            },
          },
        },
      },
      "/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Login",
          description: "Authenticate with email and password. Returns a JWT token to use for all subsequent requests.",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LoginRequest" },
                examples: {
                  companyAdmin: {
                    summary: "Company Admin",
                    value: { email: "admin@globaltrucks.com", password: "admin@123" },
                  },
                  superAdmin: {
                    summary: "Super Admin",
                    value: { email: "super-admin@gmail.com", password: "admin@123" },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Login successful",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/ApiResponse" },
                      {
                        properties: {
                          data: { $ref: "#/components/schemas/LoginResponse" },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          },
        },
      },
      "/auth/me": {
        get: {
          tags: ["Auth"],
          summary: "Get current user",
          description: "Returns the authenticated user's profile including company info.",
          responses: {
            "200": {
              description: "Current user data",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/User" } } }] } } },
            },
            "401": { description: "Unauthorized" },
          },
        },
      },
      // ── MOBILE ──────────────────────────────────────────────────────────────
      "/mobile/dashboard": {
        get: {
          tags: ["Mobile"],
          summary: "📱 Mobile dashboard",
          description: "Returns a combined dashboard payload optimized for mobile: user profile, vehicle stats, and recent alerts in a single request.",
          responses: {
            "200": {
              description: "Mobile dashboard data",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/MobileDashboard" } } }] } } },
            },
          },
        },
      },
      "/mobile/map": {
        get: {
          tags: ["Mobile"],
          summary: "📱 Live map pins",
          description: "Returns all vehicles with GPS coordinates for the live map screen.",
          responses: {
            "200": {
              description: "Map pins",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { type: "array", items: { $ref: "#/components/schemas/MapPin" } } } }] } } },
            },
          },
        },
      },
      "/mobile/profile": {
        get: {
          tags: ["Mobile"],
          summary: "📱 Get profile",
          description: "Returns the current user's full profile for the Profile screen.",
          responses: {
            "200": {
              description: "User profile",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/User" } } }] } } },
            },
          },
        },
        patch: {
          tags: ["Mobile"],
          summary: "📱 Update profile",
          description: "Update name and/or change password from the mobile Profile screen.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateProfileRequest" } } },
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
          summary: "📱 Register push notification token",
          description: "Register a device push token (Expo/FCM/APNs) so the server can send push notifications to the device.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PushTokenRequest" } } },
          },
          responses: {
            "200": { description: "Token registered successfully" },
          },
        },
      },
      "/mobile/alerts": {
        get: {
          tags: ["Mobile"],
          summary: "📱 Get alerts",
          description: "Returns all notifications/alerts for the Alerts screen. Supports filtering by type (all/system).",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
            { name: "unread", in: "query", schema: { type: "boolean" }, description: "Filter to unread only" },
          ],
          responses: {
            "200": {
              description: "Alerts list",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { type: "array", items: { $ref: "#/components/schemas/Notification" } } } }] } } },
            },
          },
        },
      },
      // ── VEHICLES ────────────────────────────────────────────────────────────
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
              description: "List of vehicles",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { type: "array", items: { $ref: "#/components/schemas/Vehicle" } } } }] } } },
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
          description: "Returns full vehicle details including service history records.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Vehicle details",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/Vehicle" } } }] } } },
            },
            "404": { description: "Vehicle not found" },
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
                    regNo: { type: "string" },
                    type: { type: "string" },
                    deviceId: { type: "string" },
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
          description: "Returns minimal vehicle data (id, name, status, lat, lng) optimized for map rendering.",
          responses: {
            "200": {
              description: "Map pins",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { type: "array", items: { $ref: "#/components/schemas/MapPin" } } } }] } } },
            },
          },
        },
      },
      // ── GROUPS ──────────────────────────────────────────────────────────────
      "/groups": {
        get: {
          tags: ["Groups"],
          summary: "List vehicle groups",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
            { name: "search", in: "query", schema: { type: "string" } },
          ],
          responses: { "200": { description: "List of groups" } },
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
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } } } } } },
          responses: { "200": { description: "Group updated" } },
        },
        delete: {
          tags: ["Groups"],
          summary: "Delete group",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Group deleted" } },
        },
      },
      // ── SERVICE HISTORY ─────────────────────────────────────────────────────
      "/maintenance": {
        get: {
          tags: ["Service History"],
          summary: "List service history records",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
            { name: "vehicleId", in: "query", schema: { type: "string" } },
            { name: "status", in: "query", schema: { type: "string", enum: ["ON_TRACK", "DUE_SOON", "OVERDUE"] } },
          ],
          responses: { "200": { description: "Service history list", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { type: "array", items: { $ref: "#/components/schemas/ServiceHistory" } } } }] } } } },
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
          summary: "Get service record by ID",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Service record" } },
        },
        patch: {
          tags: ["Service History"],
          summary: "Update service record",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { serviceType: { type: "string" }, intervalKm: { type: "number" }, lastServiceKm: { type: "number" }, nextServiceKm: { type: "number" } } } } } },
          responses: { "200": { description: "Record updated" } },
        },
        delete: {
          tags: ["Service History"],
          summary: "Delete service record",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Record deleted" } },
        },
      },
      // ── NOTIFICATIONS ───────────────────────────────────────────────────────
      "/notifications": {
        get: {
          tags: ["Notifications"],
          summary: "List notifications",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          ],
          responses: { "200": { description: "Notifications list", content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { type: "array", items: { $ref: "#/components/schemas/Notification" } } } }] } } } },
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
      // ── DASHBOARD ───────────────────────────────────────────────────────────
      "/dashboard/stats": {
        get: {
          tags: ["Dashboard"],
          summary: "Dashboard stats",
          description: "Returns stat cards for the dashboard. Super Admin gets company + vehicle counts. Company Admin gets vehicle + online counts.",
          responses: {
            "200": {
              description: "Dashboard statistics",
              content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/ApiResponse" }, { properties: { data: { $ref: "#/components/schemas/DashboardStats" } } }] } } },
            },
          },
        },
      },
      "/dashboard/activities": {
        get: {
          tags: ["Dashboard"],
          summary: "Recent activities",
          parameters: [{ name: "limit", in: "query", schema: { type: "integer", default: 10 } }],
          responses: { "200": { description: "Activity feed" } },
        },
      },
    },
  },
  apis: [],
};

export const swaggerSpec = swaggerJsdoc(options);
