import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEvent, fetchEventVolunteers } from "@/services/eventService";

vi.mock("@/services/supabaseClient", () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() } },
}));

import { supabase } from "@/services/supabaseClient";

describe("fetchEventVolunteers", () => {
  const mockEq = vi.fn();
  const mockSelect = vi.fn(() => ({ eq: mockEq }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(supabase.from).mockReturnValue({ select: mockSelect });
  });

  it("does not select columns that profiles lacks", async () => {
    mockEq.mockResolvedValueOnce({ data: [], error: null });

    await fetchEventVolunteers("event-1");

    expect(supabase.from).toHaveBeenCalledWith("event_volunteers");
    expect(mockEq).toHaveBeenCalledWith("event_id", "event-1");

    // event_volunteers.volunteer_id references profiles, which has no email
    // column; selecting it makes PostgREST reject the whole query.
    const select = mockSelect.mock.calls[0][0];
    expect(select).toContain("users:volunteer_id");
    expect(select).not.toMatch(/email/);
  });

  it("returns the rows on success", async () => {
    const rows = [{ volunteer_id: "v1", users: { first_name: "Jim" } }];
    mockEq.mockResolvedValueOnce({ data: rows, error: null });

    await expect(fetchEventVolunteers("event-1")).resolves.toEqual({
      success: true,
      data: rows,
    });
  });

  it("reports failure instead of throwing when Supabase errors", async () => {
    mockEq.mockResolvedValueOnce({
      data: null,
      error: { message: "column profiles_1.email does not exist" },
    });

    await expect(fetchEventVolunteers("event-1")).resolves.toEqual({
      success: false,
      error: "column profiles_1.email does not exist",
    });
  });
});

describe("createEvent", () => {
  const eventData = {
    eventName: "Children's Liturgy",
    eventCategory: "mass",
    eventVisibility: "public",
    ministry: "",
    eventDate: "2026-10-18",
    eventTime: "11:15:00",
    eventObservation: true,
    eventDescription: "",
    userId: "user-1",
    assignVolunteer: ["vol-1"],
    eventPosterImage: null,
  };

  const mockSingle = vi.fn();
  const mockDeleteEq = vi.fn();
  const mockVolunteerInsert = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});

    mockDeleteEq.mockResolvedValue({ error: null });
    vi.mocked(supabase.from).mockImplementation((table) =>
      table === "events"
        ? {
            insert: () => ({ select: () => ({ single: mockSingle }) }),
            delete: () => ({ eq: mockDeleteEq }),
          }
        : { insert: mockVolunteerInsert }
    );
  });

  it("returns the created event when everything succeeds", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "evt-1" }, error: null });
    mockVolunteerInsert.mockResolvedValueOnce({ error: null });

    await expect(createEvent(eventData)).resolves.toEqual({
      success: true,
      data: { id: "evt-1" },
    });
    expect(mockDeleteEq).not.toHaveBeenCalled();
  });

  it("rejects and rolls the event back when assigning volunteers fails", async () => {
    mockSingle.mockResolvedValueOnce({ data: { id: "evt-1" }, error: null });
    mockVolunteerInsert.mockResolvedValueOnce({
      error: { message: "insert failed" },
    });

    await expect(createEvent(eventData)).rejects.toThrow("insert failed");
    expect(mockDeleteEq).toHaveBeenCalledWith("id", "evt-1");
  });

  it("rejects without a rollback when the event insert fails", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "event insert failed" },
    });

    await expect(createEvent(eventData)).rejects.toThrow("event insert failed");
    expect(mockDeleteEq).not.toHaveBeenCalled();
    expect(mockVolunteerInsert).not.toHaveBeenCalled();
  });
});
