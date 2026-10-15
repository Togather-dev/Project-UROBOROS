import { paginate } from "@/lib/utils";
import { supabase } from "@/services/supabaseClient";
import { deleteImageFromStorage } from "./ministryService";

export const fetchSelectedEvents = async (date) => {
  if (!date) {
    return { allDayEvents: [], otherEvents: [] };
  }
  const jsDate = new Date(date);
  const formattedDate = `${jsDate.getFullYear()}-${String(jsDate.getMonth() + 1).padStart(2, "0")}-${String(jsDate.getDate()).padStart(2, "0")}`;
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("date", formattedDate)
    .order("time", { ascending: true });
  if (error) {
    throw new Error(`Error fetching today's events: ${error.message}`);
  }
  const getEventStatus = (event) => {
    const now = new Date();
    const eventDate = new Date(
      `${event.date}T${event.time || "24:00:00"}` // Default to midnight if no time is provided
    );

    if (eventDate < now || (event.time === null && eventDate < now)) {
      return "Done";
    } else if (event.time === null && eventDate > now) {
      return "All Day";
    } else if (eventDate === now) {
      return "Ongoing";
    } else if (eventDate > now) {
      return "Upcoming";
    }
  };

  const formattedData = data.map((event) => {
    const status = getEventStatus(event);

    return {
      ...event,
      status,
    };
  });

  const allDayEvents = formattedData.filter(
    (event) => event.status === "All Day"
  );

  const otherEvents = formattedData.filter(
    (event) => event.status !== "All Day"
  );
  const segregatedData = {
    allDayEvents,
    otherEvents,
  };
  return segregatedData;
};

export const createEvent = async (eventData) => {
  const {
    eventName,
    eventCategory,
    eventVisibility,
    ministry,
    eventDate,
    eventTime,
    eventObservation,
    eventDescription,
    userId, // Creator's ID
    assignVolunteer,
    eventPosterImage,
  } = eventData;

  let imagePath = null;
  let createdEventId = null;

  try {
    //  Upload the image (if provided)
    if (eventPosterImage) {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("Uroboros")
        .upload(`event_images/${eventName}_${Date.now()}`, eventPosterImage);

      if (uploadError) {
        throw new Error(`Image upload failed: ${uploadError.message}`);
      }

      imagePath = uploadData.path;
    }

    // Step 1: Insert event data into Supabase
    const { data: event, error: eventError } = await supabase
      .from("events")
      .insert([
        {
          name: eventName,
          category: eventCategory,
          visibility: eventVisibility,
          ministry_id: ministry || null,
          date: eventDate,
          time: eventTime,
          description: eventDescription || null,
          created_by: userId,
          requires_attendance: eventObservation,
          image_url: imagePath,
        },
      ])
      .select("id") // Return the new event ID
      .single(); // Single object

    if (eventError) {
      throw new Error(eventError.message);
    }

    createdEventId = event.id;

    // Step 2: Insert assigned volunteers into event_volunteers table
    if (assignVolunteer?.length > 0) {
      const volunteerData = assignVolunteer.map((volunteerId) => ({
        event_id: event.id, // Use the created event ID
        volunteer_id: volunteerId,
        assigner_id: userId,
      }));

      const { error: volunteerError } = await supabase
        .from("event_volunteers")
        .insert(volunteerData);

      if (volunteerError) {
        throw new Error(volunteerError.message); // Handle any errors
      }
    }

    return { success: true, data: event };
  } catch (error) {
    console.error("Error creating event:", error);

    // Undo the partial create so a retry doesn't leave a duplicate event
    // (or an orphaned poster) behind.
    if (createdEventId) {
      const { error: rollbackError } = await supabase
        .from("events")
        .delete()
        .eq("id", createdEventId);
      if (rollbackError) {
        console.error("Error rolling back event:", rollbackError.message);
      }
    }
    await deleteImageFromStorage(imagePath);

    // Rethrow so the mutation's onError runs instead of reporting success.
    throw error;
  }
};

// Function to update an existing event

// export const updateEvent = async (eventData) => {
//   try {
//     const {
//       eventName,
//       eventCategory,
//       eventVisibility,
//       ministry,
//       eventDate, // formatted date from the form
//       eventTime, // formatted time from the form
//       eventDescription,
//       // userId, // Creator's ID
//     } = eventData.updatedData;

//     // Step 1: Update the event data in the 'events' table
//     const { data: updatedEvent, error: eventError } = await supabase
//       .from("events")
//       .update({
//         name: eventName,
//         category: eventCategory,
//         visibility: eventVisibility,
//         ministry_id: ministry || null, // Ministry is optional
//         date: eventDate, // formatted date (yyyy-MM-dd)
//         time: eventTime, // formatted time (HH:mm:ss)
//         description: eventDescription || null, // Optional field
//       })
//       .eq("id", eventData.eventId) // Update the event with the matching ID
//       .select("id") // Return the updated event ID
//       .single(); // Return single object

//     if (eventError) {
//       throw new Error(eventError.message); // Handle any errors
//     }

//     // // Step 2: Remove all existing volunteer assignments for the event
//     // const { error: removeError } = await supabase
//     //   .from("event_volunteers")
//     //   .delete()
//     //   .eq("event_id", eventData.eventId); // Remove all existing volunteer assignments for the event

//     // if (removeError) {
//     //   throw new Error(removeError.message); // Handle any errors
//     // }

//     // // Step 3: Insert new volunteer assignments (if any volunteers are selected)
//     // if (assignVolunteer?.length > 0) {
//     //   const volunteerData = assignVolunteer.map((volunteerId) => ({
//     //     event_id: eventData.eventId, // Use the event ID to assign volunteers
//     //     volunteer_id: volunteerId,
//     //   }));

//     //   const { error: volunteerError } = await supabase
//     //     .from("event_volunteers")
//     //     .insert(volunteerData);

//     //   if (volunteerError) {
//     //     throw new Error(volunteerError.message); // Handle any errors
//     //   }
//     // }

//     return { success: true, data: updatedEvent }; // Return success structure
//   } catch (error) {
//     console.error("Error updating event:", error);
//     return { success: false, error: error.message }; // Return error structure
//   }
// };

export const updateEvent = async ({ eventId, updatedData }) => {
  try {
    const { eventPosterImage, ...eventDetails } = updatedData;

    const updatePayload = {
      name: eventDetails.eventName,
      category: eventDetails.eventCategory,
      visibility: eventDetails.eventVisibility,
      ministry_id: eventDetails.ministry || null,
      date: eventDetails.eventDate,
      time: eventDetails.eventTime,
      description: eventDetails.eventDescription || null,
      requires_attendance: eventDetails.eventObservation,
    };

    // Step 1: Update the event data in the 'events' table
    const { error } = await supabase
      .from("events")
      .update(updatePayload)
      .eq("id", eventId);

    if (error) {
      throw new Error(error.message);
    }

    // Handle image upload if a new one is provided
    if (eventPosterImage instanceof File) {
      // Get current image URL to delete later
      const { data: currentEvent, error: fetchError } = await supabase
        .from("events")
        .select("image_url")
        .eq("id", eventId)
        .single();

      if (fetchError) {
        throw new Error(`Error fetching current event: ${fetchError.message}`);
      }

      // Generate a unique file name to prevent conflicts
      const fileName = `event_images/${eventDetails.eventName}_${Date.now()}`;

      // Upload new image
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("Uroboros")
        .upload(fileName, eventPosterImage);

      if (uploadError) {
        throw new Error(`Error uploading new poster: ${uploadError.message}`);
      }

      // Update event with new image URL
      const { error: imageUpdateError } = await supabase
        .from("events")
        .update({ image_url: uploadData.path })
        .eq("id", eventId);

      if (imageUpdateError) {
        // If update fails, remove the uploaded image
        await supabase.storage.from("Uroboros").remove([uploadData.path]);
        throw new Error(
          `Error updating event poster: ${imageUpdateError.message}`
        );
      }

      // Delete old image if exists and is different
      if (
        currentEvent?.image_url &&
        currentEvent.image_url !== uploadData.path
      ) {
        await deleteImageFromStorage(currentEvent.image_url);
      }
    }
    // Handle case where image is explicitly removed (set to null)
    else if (eventPosterImage === null) {
      const { data: currentEvent, error: fetchError } = await supabase
        .from("events")
        .select("image_url")
        .eq("id", eventId)
        .single();

      if (!fetchError && currentEvent?.image_url) {
        // Delete the existing image
        await deleteImageFromStorage(currentEvent.image_url);

        // Update event to clear poster field
        const { error: clearImageError } = await supabase
          .from("events")
          .update({ image_url: null })
          .eq("id", eventId);

        if (clearImageError) {
          throw new Error(
            `Error clearing event image: ${clearImageError.message}`
          );
        }
      }
    }

    // Return the updated event
    const { data: updatedEvent, error: getError } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();

    if (getError) {
      throw new Error(`Error fetching updated event: ${getError.message}`);
    }

    // Transform image_url to public URL if it exists
    if (updatedEvent.image_url) {
      const { data: urlData } = supabase.storage
        .from("Uroboros")
        .getPublicUrl(updatedEvent.image_url);

      updatedEvent.image_url = urlData.publicUrl;
    }

    return { success: true, data: updatedEvent };
  } catch (error) {
    console.error("Error updating event:", error);
    return { success: false, error: error.message };
  }
};

// Function to fetch all events (optionally filter by date, creator, etc.)
export const getEvents = async ({
  page = 1,
  pageSize,
  query,
  role,
  userId,
  selectedYear,
  eventFilter,
  selectedMonth,
} = {}) => {
  try {
    const filters = {};

    // Date filters
    if (selectedYear && selectedMonth) {
      const formattedMonth = String(selectedMonth).padStart(2, "0");
      const selectedDate = `${selectedYear}-${formattedMonth}`;

      const [year, month] = selectedDate.split("-");
      const startOfMonth = `${year}-${month}-01`;
      const lastDayOfMonth = new Date(year, month, 0).getDate();
      const endOfMonth = `${year}-${month}-${lastDayOfMonth}`;

      filters.gte = { date: startOfMonth };
      filters.lte = { date: endOfMonth };
    }

    // Search filter
    if (query) {
      filters.ilike = { name: query };
    }

    // Role-based access
    if (role === "admin" || role === "coordinator") {
      if (eventFilter === "public") {
        filters.eq = [{ column: "visibility", value: "public" }];
      } else if (eventFilter === "private") {
        filters.eq = [{ column: "visibility", value: "private" }];
      } else if (eventFilter === "owned") {
        filters.eq = [{ column: "created_by", value: userId }];
      } else if (eventFilter === "ministry") {
        const { data: userCoordinator, error: coordinatorError } =
          // Fetch coordinator ministries
          await supabase
            .from("ministry_coordinators")
            .select("ministry_id")
            .eq("coordinator_id", userId);
        if (coordinatorError) {
          throw new Error(
            `Error fetching coordinator data: ${coordinatorError.message}`
          );
        }
        // Fetch group memberships to get ministry IDs
        const { data: groupMemberships, error: memberError } = await supabase
          .from("group_members")
          .select("groups(ministry_id)")
          .eq("user_id", userId);
        if (memberError) {
          throw new Error(
            `Error fetching group memberships: ${memberError.message}`
          );
        }

        const coordinatorMinistryIds =
          userCoordinator?.map((i) => i.ministry_id) || [];
        const memberMinistryIds =
          groupMemberships
            ?.filter((i) => i.groups?.ministry_id)
            .map((i) => i.groups.ministry_id) || [];

        const allMinistryIds = [
          ...new Set([...coordinatorMinistryIds, ...memberMinistryIds]),
        ];

        if (allMinistryIds.length > 0) {
          filters.in = { column: "ministry_id", value: allMinistryIds };
        } else {
          filters.id = []; // no connected ministries
        }
      } else if (eventFilter === "assigned") {
        const { data: volunteerEvents } = await supabase
          .from("event_volunteers")
          .select("event_id")
          .eq("volunteer_id", userId)
          .eq("replaced", false);
        const volunteerEventIds = volunteerEvents?.map((e) => e.event_id) || [];

        const { data: replacementEvents } = await supabase
          .from("event_volunteers")
          .select("event_id")
          .eq("replacedby_id", userId);
        const replacementEventIds =
          replacementEvents?.map((e) => e.event_id) || [];

        const allEventIds = [
          ...new Set([...volunteerEventIds, ...replacementEventIds]),
        ];
        filters.id = allEventIds.length > 0 ? allEventIds : [];
      }
    } else if (role === "volunteer") {
      const { data: volunteerEvents } = await supabase
        .from("event_volunteers")
        .select("event_id")
        .eq("volunteer_id", userId)
        .eq("replaced", false);
      const volunteerEventIds = volunteerEvents?.map((e) => e.event_id) || [];

      const { data: replacementEvents } = await supabase
        .from("event_volunteers")
        .select("event_id")
        .eq("replacedby_id", userId);
      const replacementEventIds =
        replacementEvents?.map((e) => e.event_id) || [];

      const allEventIds = [
        ...new Set([...volunteerEventIds, ...replacementEventIds]),
      ];
      filters.id = allEventIds.length > 0 ? allEventIds : [];
    } else if (role === "parishioner") {
      const { data: groupMemberships } = await supabase
        .from("group_members")
        .select("groups(ministry_id)")
        .eq("user_id", userId);

      const ministryIds =
        groupMemberships
          ?.filter((i) => i.groups?.ministry_id)
          .map((i) => i.groups.ministry_id) || [];

      if (ministryIds.length > 0) {
        // OR filter (public OR ministry_id in X)
        filters.or = [
          {
            column: "ministry_id",
            operator: "in",
            value: `(${ministryIds.join(",")})`,
          },
          { column: "visibility", operator: "eq", value: "public" },
        ];
      } else {
        filters.eq = [{ column: "visibility", value: "public" }];
      }
    }

    const order = [{ column: "date", ascending: true }];

    // Paginated fetch
    const paginatedData = await paginate({
      key: "events",
      select: `*, created_by(first_name, last_name), event_volunteers (volunteer_id)`,
      page,
      pageSize,
      filters,
      order,
    });

    if (paginatedData && paginatedData.items) {
      paginatedData.items = paginatedData.items.map((evt) => {
        if (evt.image_url) {
          return { ...evt, image_url: getPublicImageUrl(evt.image_url) };
        }
        return evt;
      });
      return paginatedData;
    }
  } catch (error) {
    console.error("Error fetching events:", error);
    return { success: false, error: error.message };
  }
};

// Function to delete an event by its ID
export const deleteEvent = async (eventId) => {
  try {
    // Step 1: Get the event details to retrieve image_url if exists
    const { data: eventData, error: fetchError } = await supabase
      .from("events")
      .select("image_url")
      .eq("id", eventId)
      .single();

    if (fetchError) {
      throw new Error(`Error fetching event details: ${fetchError.message}`);
    }

    // Step 2: Delete the event image from storage if one exists
    if (eventData?.image_url) {
      try {
        await deleteImageFromStorage(eventData.image_url);
      } catch (imageError) {
        console.error("Error deleting event image:", imageError);
        // Continue with event deletion even if image deletion fails
      }
    }

    // Step 3: Delete the event record
    const { data, error } = await supabase
      .from("events")
      .delete()
      .eq("id", eventId);

    if (error) {
      throw new Error(`Error deleting event record: ${error.message}`);
    }

    return { success: true, data };
  } catch (error) {
    console.error("Error deleting event:", error);
    return { success: false, error: error.message };
  }
};

// Function to fetch quick access events
export const getQuickAccessEvents = async () => {
  try {
    const { data, error } = await supabase
      .from("quick_access_events")
      .select("*");

    if (error) {
      throw new Error(error.message);
    }

    return data; // Return only the data directly
  } catch (error) {
    console.error("Error fetching quick access events:", error);
    throw new Error(error.message);
  }
};

// Function to fetch a single event by its ID
export const getEventById = async (eventId) => {
  try {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single(); // Fetch only one record

    if (error) {
      console.error("Error fetching event by ID:", error);
      throw new Error(error.message);
    }

    return data;
  } catch (error) {
    console.error("Error fetching event by ID:", error);
    return { success: false, error: error.message };
  }
};

export const getAllEvents = async () => {
  try {
    const { data, error } = await supabase.from("events").select("*"); // Select all columns from the events table

    if (error) {
      throw new Error(error.message); // Handle any errors
    }

    return { success: true, data }; // Return success structure with data
  } catch (error) {
    console.error("Error fetching events:", error);
    return { success: false, error: error.message }; // Return error structure
  }
};

const getPublicImageUrl = (path) => {
  if (!path) return null;

  // Handle if the path is already a full URL
  if (path.startsWith("http")) {
    return path;
  }

  // Use the Supabase client to get the public URL
  try {
    const { data } = supabase.storage.from("Uroboros").getPublicUrl(path);

    return data.publicUrl;
  } catch (error) {
    console.error("Error converting image path to URL:", error);
    // Fallback to constructing the URL manually
    return `https://spvkbkqezuwdkngytrnt.supabase.co/storage/v1/object/public/Uroboros/${encodeURIComponent(path)}`;
  }
};

// Get all events for calendar display (includes past events)
export const getAllEventsForCalendar = async (ministry = []) => {
  try {
    // Build base queries without date restrictions for calendar
    const publicEventsQuery = supabase
      .from("events")
      .select("*")
      .eq("visibility", "public")
      .order("date", { ascending: false });

    const privateEventsQuery =
      ministry.length > 0
        ? supabase
            .from("events")
            .select("*")
            .eq("visibility", "private")
            .in("ministry_id", ministry)
            .order("date", { ascending: false })
        : null;

    // Execute both queries in parallel
    const [publicEventsResult, privateEventsResult] = await Promise.all([
      publicEventsQuery,
      privateEventsQuery || Promise.resolve({ data: [] }),
    ]);

    // Check for errors
    if (publicEventsResult.error) {
      throw new Error(publicEventsResult.error.message);
    }
    if (privateEventsResult.error) {
      throw new Error(privateEventsResult.error.message);
    }

    // Combine and deduplicate events
    const allEvents = [
      ...(publicEventsResult.data || []),
      ...(privateEventsResult.data || []),
    ];

    // Remove duplicates based on event ID
    const uniqueEvents = allEvents.filter(
      (event, index, self) => index === self.findIndex((e) => e.id === event.id)
    );

    // Sort by date (newest first for calendar)
    uniqueEvents.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time || "00:00:00"}`);
      const dateB = new Date(`${b.date}T${b.time || "00:00:00"}`);
      return dateB - dateA;
    });

    // Transform image URLs
    uniqueEvents.forEach((event) => {
      if (event.image_url) {
        event.image_url = getPublicImageUrl(event.image_url);
      }
    });

    return { success: true, data: uniqueEvents };
  } catch (error) {
    console.error("Error fetching all events for calendar:", error);
    return { success: false, error: error.message };
  }
};

// Updated getEventsCalendar for infinite scroll (upcoming events only)
export const getEventsCalendar = async (ministry = [], options = {}) => {
  const {
    page = 1,
    limit = 12,
    cursor = null, // For cursor-based pagination
  } = options;

  try {
    const today = new Date().toISOString().split("T")[0];

    // Build base queries for upcoming events only
    let publicEventsQuery = supabase
      .from("events")
      .select("*", { count: "exact" })
      .eq("visibility", "public")
      .gte("date", today);

    let privateEventsQuery =
      ministry.length > 0
        ? supabase
            .from("events")
            .select("*", { count: "exact" })
            .eq("visibility", "private")
            .in("ministry_id", ministry)
            .gte("date", today)
        : null;

    // Apply cursor-based pagination if cursor is provided
    if (cursor) {
      publicEventsQuery = publicEventsQuery.gt("id", cursor);
      if (privateEventsQuery) {
        privateEventsQuery = privateEventsQuery.gt("id", cursor);
      }
    }

    // Apply sorting and pagination (ascending for upcoming events)
    publicEventsQuery = publicEventsQuery
      .order("date", { ascending: true })
      .order("time", { ascending: true })
      .limit(limit);

    if (privateEventsQuery) {
      privateEventsQuery = privateEventsQuery
        .order("date", { ascending: true })
        .order("time", { ascending: true })
        .limit(limit);
    }

    // Execute both queries in parallel
    const [publicEventsResult, privateEventsResult] = await Promise.all([
      publicEventsQuery,
      privateEventsQuery || Promise.resolve({ data: [], count: 0 }),
    ]);

    // Check for errors
    if (publicEventsResult.error) {
      throw new Error(publicEventsResult.error.message);
    }
    if (privateEventsResult.error) {
      throw new Error(privateEventsResult.error.message);
    }

    // Combine and deduplicate events
    const allEvents = [
      ...(publicEventsResult.data || []),
      ...(privateEventsResult.data || []),
    ];

    // Remove duplicates based on event ID
    const uniqueEvents = allEvents.filter(
      (event, index, self) => index === self.findIndex((e) => e.id === event.id)
    );

    // Sort combined results (upcoming events in chronological order)
    uniqueEvents.sort((a, b) => {
      const dateA = new Date(`${a.date}T${a.time || "00:00:00"}`);
      const dateB = new Date(`${b.date}T${b.time || "00:00:00"}`);
      return dateA - dateB;
    });

    // Take only the requested number of events
    const paginatedEvents = uniqueEvents.slice(0, limit);

    // Transform image URLs
    paginatedEvents.forEach((event) => {
      if (event.image_url) {
        event.image_url = getPublicImageUrl(event.image_url);
      }
    });

    // Determine if there are more events
    const hasMore = paginatedEvents.length === limit;
    const nextCursor =
      paginatedEvents.length > 0
        ? paginatedEvents[paginatedEvents.length - 1].id
        : null;

    return {
      success: true,
      data: paginatedEvents,
      pagination: {
        hasMore,
        nextCursor,
        page,
        limit,
      },
    };
  } catch (error) {
    console.error("Error fetching events:", error);
    return { success: false, error: error.message };
  }
};

export const fetchEventVolunteers = async (eventId) => {
  try {
    // Query the event_volunteers table for the given event ID
    const { data, error } = await supabase
      .from("event_volunteers")
      .select(
        `
        volunteer_id,
        assigned_at,
        replaced,
        replacedby_id,
        users:volunteer_id (
          first_name,
          last_name
        ),
         volunteer_replacement:replacedby_id (
          first_name,
          last_name
        )
        `
      )
      .eq("event_id", eventId); // Filter by event ID

    if (error) {
      throw new Error(error.message); // Handle errors
    }

    return { success: true, data }; // Return the fetched data
  } catch (error) {
    console.error("Error fetching event volunteers:", error);
    return { success: false, error: error.message }; // Return error structure
  }
};

// Function to fetch parishioner events
export const getParishionerEvents = async ({ page = 1, pageSize } = {}) => {
  try {
    // Get the current date in "YYYY-MM-DD" format
    const today = new Date().toISOString().split("T")[0];

    const data = await paginate({
      key: "events",
      page,
      pageSize,
      order: [{ column: "date", ascending: true }],
      filters: {
        gte: { date: today }, // Include events with dates greater than or equal to today
      },
    });

    return data;
  } catch (error) {
    console.error("Error fetching events:", error);
    return { success: false, error: error.message };
  }
};

export const getWalkInEvents = async () => {
  // Get the current date in "YYYY-MM-DD" format
  const today = new Date().toISOString().split("T")[0];

  // Query the Supabase database for events
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .order("date", { ascending: true })
    .gte("date", today);

  if (error) throw error; // React Query will handle this as a query failure

  return data; // Return the data directly
};

export const getEventsByMinistryId = async (ministryIds) => {
  const promises = ministryIds.map(async (ministry) => {
    const { data, error } = await supabase
      .from("events")
      .select("*")
      .eq("ministry_id", ministry.id);

    if (error) {
      throw new Error(error.message);
    }

    return data;
  });

  const events = await Promise.all(promises);

  return events;
};
export const getEventsByCreatorId = async (userId) => {
  const now = new Date();

  const { data, error } = await supabase
    .from("events")
    .select("*")
    .gte("date", now.toISOString())
    .eq("created_by", userId)
    .order("date", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

export const replaceVolunteer = async ({
  oldVolunteerId,
  eventId,
  replacedby_id,
  replaced,
  newreplacement_id,
}) => {
  if (replaced) {
    const { error } = await supabase
      .from("event_volunteers")
      .update({
        volunteer_id: newreplacement_id,
        replacedby_id,
        replaced: true,
      })
      .eq("event_id", eventId)
      .eq("volunteer_id", oldVolunteerId);

    if (error) {
      throw new Error(error.message);
    }
  }

  const { error } = await supabase
    .from("event_volunteers")
    .update({ replacedby_id, replaced: true })
    .eq("event_id", eventId)
    .eq("volunteer_id", oldVolunteerId);

  if (error) {
    throw new Error(error.message);
  }
};

export const removeAssignedVolunteer = async (volunteerId, eventId) => {
  if (!volunteerId) {
    throw new Error("Volunteer ID is required");
  }
  const { data } = await supabase
    .from("event_volunteers")
    .select("*")
    .eq("volunteer_id", volunteerId)
    .eq("replaced", false)
    .eq("event_id", eventId);

  const { data: replacementData } = await supabase
    .from("event_volunteers")
    .select("*")
    .eq("replacedby_id", volunteerId)
    .eq("replaced", true)
    .eq("event_id", eventId);

  if (data.length > 0) {
    const { error } = await supabase
      .from("event_volunteers")
      .delete()
      .eq("volunteer_id", volunteerId)
      .eq("replaced", false)
      .eq("event_id", eventId);

    if (error) {
      throw new Error(error.message);
    }
  }
  if (replacementData.length > 0) {
    const { error } = await supabase
      .from("event_volunteers")
      .delete()
      .eq("replacedby_id", volunteerId)
      .eq("replaced", true)

      .eq("event_id", eventId);
    if (error) {
      throw new Error(error.message);
    }
  }
};

export const addAssignedVolunteer = async ({
  eventId,
  assignVolunteer,
  userId,
}) => {
  try {
    const getPromises = assignVolunteer.map(async (volunteer_id) => {
      const { data, error } = await supabase
        .from("event_volunteers")
        .select("id")
        .eq("volunteer_id", volunteer_id)
        .eq("event_id", eventId)
        .eq("replaced", false);

      if (error) {
        throw new Error("Error checking existence of volunteers!");
      }

      if (data.length > 0) {
        throw new Error("Volunteer Already Assigned!");
      }

      const { data: replaceIdData, error: replaceIdError } = await supabase
        .from("event_volunteers")
        .select("id")
        .eq("replacedby_id", volunteer_id)
        .eq("event_id", eventId);

      if (replaceIdError) {
        throw new Error("Error checking existence of volunteers!");
      }

      if (replaceIdData.length > 0) {
        throw new Error("Volunteer Already Exist!");
      }
    });

    await Promise.all(getPromises);

    const Promises = assignVolunteer.map(async (volunteer_id) => {
      const { error } = await supabase.from("event_volunteers").insert([
        {
          event_id: eventId,
          assigner_id: userId,
          volunteer_id,
          assigned_at: new Date().toISOString(),
        },
      ]);

      if (error) {
        throw new Error(error.message);
      }
    });

    await Promise.all(Promises);
  } catch (err) {
    console.error("Error in adding volunteers:", err);
    throw err; // Ensure the error is propagated back to the mutation's onError handler
  }
};
