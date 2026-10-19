import { describe, it, expect } from "vitest";
import {
  buildEventQrPayload,
  isValidEventId,
  parseEventQrPayload,
} from "../eventQr";

const EVENT_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("buildEventQrPayload", () => {
  it("encodes exactly the shape the mobile scanner accepts", () => {
    expect(buildEventQrPayload(EVENT_ID)).toBe(
      `{"type":"event","eventId":"${EVENT_ID}"}`
    );
  });

  it("uses only the type and eventId keys", () => {
    const parsed = JSON.parse(buildEventQrPayload(EVENT_ID));
    expect(Object.keys(parsed)).toEqual(["type", "eventId"]);
  });

  it.each([
    ["empty string", ""],
    ["undefined", undefined],
    ["null", null],
    ["slug", "sunday-mass"],
    ["title", "Sunday Mass"],
    ["number", 42],
    ["object", { id: EVENT_ID }],
  ])("returns null for %s", (_label, value) => {
    expect(buildEventQrPayload(value)).toBeNull();
    expect(isValidEventId(value)).toBe(false);
  });
});

describe("parseEventQrPayload", () => {
  it("reads the eventId from the event payload", () => {
    expect(parseEventQrPayload(buildEventQrPayload(EVENT_ID))).toBe(EVENT_ID);
  });

  it("accepts a bare UUID from QR codes made before the payload change", () => {
    expect(parseEventQrPayload(EVENT_ID)).toBe(EVENT_ID);
  });

  it.each([
    ["wrong type value", `{"type":"Event","eventId":"${EVENT_ID}"}`],
    ["other type", `{"type":"user","eventId":"${EVENT_ID}"}`],
    ["non-string eventId", '{"type":"event","eventId":42}'],
    ["missing eventId", '{"type":"event"}'],
    ["array", `["event","${EVENT_ID}"]`],
    ["JSON null", "null"],
    ["JSON string", `"${EVENT_ID}"`],
    ["not JSON", "hello world"],
    ["empty string", ""],
    ["undefined", undefined],
  ])("returns null for %s", (_label, value) => {
    expect(parseEventQrPayload(value)).toBeNull();
  });
});
