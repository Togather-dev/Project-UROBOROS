import { validate as isUuid } from "uuid";

// The mobile scanner (event-qr-scanner.tsx) accepts only
// {"type":"event","eventId":"<events.id>"}. Keep this identical to the
// payload built in the mobile app's event-qr-code.tsx.
export const EVENT_QR_OPTIONS = {
  errorCorrectionLevel: "M",
  margin: 4,
  width: 1024,
  color: { dark: "#000000", light: "#ffffff" },
};

export const isValidEventId = (eventId) =>
  typeof eventId === "string" && eventId.length > 0 && isUuid(eventId);

export const buildEventQrPayload = (eventId) =>
  isValidEventId(eventId) ? JSON.stringify({ type: "event", eventId }) : null;

// Returns the eventId from a scanned value, or null if it isn't an event QR.
// A bare UUID is accepted so QR codes generated before the payload change
// keep working.
export const parseEventQrPayload = (rawValue) => {
  if (typeof rawValue !== "string") return null;

  try {
    const parsed = JSON.parse(rawValue);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      parsed.type === "event" &&
      typeof parsed.eventId === "string"
    ) {
      return parsed.eventId;
    }
  } catch {
    // Not JSON, fall through to the legacy check.
  }

  return isValidEventId(rawValue) ? rawValue : null;
};
