import { Router, Request, Response } from "express";
import { processGpsPing } from "../services/gps-ingest.service";

const router = Router();

/**
 * Public HTTP endpoint for GPS trackers (POST).
 * Accepts JSON or urlencoded data from IoT trackers, mobile driver apps, or test scripts.
 */
router.post("/track", async (req: Request, res: Response) => {
  try {
    const { deviceId, imei, latitude, lat, longitude, lng, lon, speed, recordedAt } = req.body;

    const targetDeviceId = String(deviceId || imei || "").trim();
    const targetLat = parseFloat(String(latitude ?? lat));
    const targetLng = parseFloat(String(longitude ?? lng ?? lon));
    const targetSpeed = speed != null ? parseFloat(String(speed)) : 0;

    if (!targetDeviceId) {
      return res.status(400).json({
        success: false,
        error: "Missing deviceId or imei in request body",
      });
    }

    if (isNaN(targetLat) || isNaN(targetLng)) {
      return res.status(400).json({
        success: false,
        error: "Invalid coordinates: latitude and longitude are required numbers",
      });
    }

    const result = await processGpsPing({
      deviceId: targetDeviceId,
      latitude: targetLat,
      longitude: targetLng,
      speed: isNaN(targetSpeed) ? 0 : targetSpeed,
      recordedAt: recordedAt || new Date(),
    });

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json({
      success: true,
      message: "GPS ping recorded and broadcasted live",
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Public HTTP endpoint for GPS trackers (GET).
 * Used by GPS devices that transmit data via HTTP GET query string.
 * Example: GET /api/gps/track?deviceId=868010341870381&lat=33.6844&lng=73.0479&speed=45
 */
router.get("/track", async (req: Request, res: Response) => {
  try {
    const { deviceId, imei, lat, latitude, lng, lon, longitude, speed } = req.query;

    const targetDeviceId = String(deviceId || imei || "").trim();
    const targetLat = parseFloat(String(lat ?? latitude));
    const targetLng = parseFloat(String(lng ?? lon ?? longitude));
    const targetSpeed = speed ? parseFloat(String(speed)) : 0;

    if (!targetDeviceId || isNaN(targetLat) || isNaN(targetLng)) {
      return res.status(400).json({
        success: false,
        error: "Missing deviceId, lat, or lng in query parameters",
      });
    }

    const result = await processGpsPing({
      deviceId: targetDeviceId,
      latitude: targetLat,
      longitude: targetLng,
      speed: targetSpeed,
      recordedAt: new Date(),
    });

    if (!result.success) {
      return res.status(404).json(result);
    }

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

/**
 * Test Simulator Endpoint (for client testing tomorrow):
 * Takes a deviceId and generates a realistic driving path near a center point.
 */
router.post("/simulate-trip", async (req: Request, res: Response) => {
  try {
    const { deviceId, centerLat = 33.6844, centerLng = 73.0479, count = 5 } = req.body;

    if (!deviceId) {
      return res.status(400).json({ success: false, error: "deviceId is required" });
    }

    const numPoints = Math.min(20, Math.max(1, Number(count) || 5));
    const results = [];

    let currentLat = Number(centerLat);
    let currentLng = Number(centerLng);

    const now = new Date();
    // Simulate points spaced 1 minute apart
    for (let i = 0; i < numPoints; i++) {
      const pingTime = new Date(now.getTime() - (numPoints - 1 - i) * 60 * 1000);
      currentLat += (Math.random() - 0.45) * 0.005;
      currentLng += (Math.random() - 0.45) * 0.005;
      const speed = Math.floor(35 + Math.random() * 45);

      const r = await processGpsPing({
        deviceId: String(deviceId),
        latitude: currentLat,
        longitude: currentLng,
        speed,
        recordedAt: pingTime,
      });

      if (!r.success) {
        return res.status(404).json(r);
      }
      results.push(r);
    }

    return res.json({
      success: true,
      message: `Successfully simulated ${results.length} GPS points for ${deviceId}`,
      lastLocation: { lat: currentLat, lng: currentLng },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
