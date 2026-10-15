import { useEffect, memo, useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import QRCode from "qrcode";
import { Icon } from "@iconify/react";
import { Description, Title } from "@/components/Title";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

import {
  getEventById,
  fetchEventVolunteers,
  deleteEvent,
  removeAssignedVolunteer,
  addAssignedVolunteer,
} from "@/services/eventService";
import {
  getEventAttendance,
  updateAttendeeStatus,
  countEventAttendance,
  updateTimeOut,
} from "@/services/attendanceService";

import { useUser } from "@/context/useUser";
import {
  cn,
  downloadExcel,
  exportAttendanceList,
  formatEventDate,
  formatEventTimeCompact,
} from "@/lib/utils";
import { buildEventQrPayload, EVENT_QR_OPTIONS } from "@/lib/eventQr";
import { Label } from "../ui/label";
import { useToast } from "@/hooks/use-toast";
import AddRecord from "./AddRecord";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import AddAttendee from "./AddAttendee";
import Loading from "../Loading";
import useUsersByRole from "@/hooks/useUsersByRole";
import ParentAddLogs from "./AttendeeAddLogs";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "../ui/form";
import VolunteerSelect from "./VolunteerSelect";
import { Input } from "../ui/input";
import { Search } from "@/assets/icons/icons";
import { useDebounce } from "@/hooks/useDebounce";
import AttendanceTable from "./AttendanceTable";
import AddExistingRecord from "./AddExistingRecord";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import CustomReactSelect from "../CustomReactSelect";
import {
  fetchAllMinistryVolunteers,
  getMinistryVolunteers,
} from "@/services/ministryService";
import { ROLES } from "@/constants/roles";

//Fetch volunteer based on Ministry
const useMinistryVolunteers = (ministryId) => {
  return useQuery({
    queryKey: ["ministry-volunteers", ministryId],
    queryFn: () => getMinistryVolunteers(ministryId),
    enabled: !!ministryId,
  });
};

//Fetch all volunteer in all ministries coordinating by users
const useFetchAllMinistryVolunteers = (userId) => {
  return useQuery({
    queryKey: ["user-group-members", userId],
    queryFn: () => fetchAllMinistryVolunteers(userId),
    enabled: !!userId,
  });
};

const ScheduleDetails = () => {
  const [qrCode, setQRCode] = useState(null);
  const [qrError, setQrError] = useState(false);
  const [disableSchedule, setDisableSchedule] = useState(false);
  const [urlPrms, setUrlPrms] = useSearchParams();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [filteredParentAttendance, setFilteredParentAttendance] = useState([]);
  const [filteredChildAttendance, setFilteredChildAttendance] = useState([]);
  const eventId = urlPrms.get("event") || null;
  const { userData } = useUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const role = userData?.role;
  // Fetch volunteers and admins for assigning volunteers
  const { data: volunteers } = useUsersByRole("volunteer");
  const { data: admins } = useUsersByRole("admin");
  const { data: coordinators } = useUsersByRole("coordinator");

  // Fetch event base on eventId
  const fetchedEvent = useMemo(
    () => ({
      queryKey: ["event", eventId],
      queryFn: async () => {
        const response = await getEventById(eventId);
        return response;
      },
      enabled: !!eventId,
    }),
    [eventId]
  );
  const { data: event, isLoading } = useQuery(fetchedEvent);

  const { data: ministryVolunteers, isLoading: _ministryVolunteersLoading } =
    useMinistryVolunteers(event?.ministry_id);

  const { data: allMinistryVolunteers, isLoading: _allMinistryVolunteers } =
    useFetchAllMinistryVolunteers(userData?.id);

  const deleteMutation = useMutation({
    mutationFn: async () => await deleteEvent(eventId),
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Event deleted!",
      });
      setDeleteDialogOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: `${error.message}`,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries([
        "schedules",
        "events",
        userData,
        role,
        urlPrms.get("month")?.toString(),
        urlPrms.get("year")?.toString(),
        urlPrms.get("query")?.toString() || "",
      ]);
      urlPrms.delete("event");
      setUrlPrms(urlPrms);
    },
  });

  const { data: eventVolunteers, isLoading: _volunteersLoading } = useQuery({
    queryKey: ["event_volunteers", eventId],
    queryFn: async () => {
      const response = await fetchEventVolunteers(eventId);
      return response.data;
    },
    enabled: !!eventId,
  });

  const assignedUsers = [
    ...(volunteers || []),
    ...(admins || []),
    ...(coordinators || []),
  ];

  // For tracking volunteers who have been replaced (original volunteers)
  const previousVolunteerIds = useMemo(() => {
    return new Set(
      eventVolunteers
        ?.filter((volunteer) => volunteer.replaced) // Filter for volunteers that have been replaced
        .map((volunteer) => volunteer.volunteer_id) // Get IDs of original volunteers
    );
  }, [eventVolunteers]);

  // For tracking volunteers who are acting as replacements
  const replacementVolunteerIds = useMemo(() => {
    return new Set(
      eventVolunteers
        ?.filter((volunteer) => volunteer.replacedby_id) // Filter volunteers that have a replacement
        .map((volunteer) => volunteer.replacedby_id) // Get IDs of replacement volunteers
    );
  }, [eventVolunteers]);

  const filteredVolunteers = assignedUsers?.filter(
    (volunteer) =>
      // Include volunteers that are either not yet assigned or are previous replacements
      (!eventVolunteers?.some(
        (assignedVolunteer) => assignedVolunteer.volunteer_id === volunteer.id
      ) ||
        previousVolunteerIds.has(volunteer.id)) &&
      // Exclude volunteers who are currently replacements
      !replacementVolunteerIds.has(volunteer.id)
  );

  // Fetch all volunteers
  const allVolunteersRole = filteredVolunteers?.map((volunteer) => ({
    value: volunteer.id,
    label: `${volunteer.first_name} ${volunteer.last_name}`,
  }));

  // Fetch all volunteers on all ministry of user
  const ministriesVolunteers = useMemo(() => {
    if (!allMinistryVolunteers) return [];

    // Filter out volunteers that are already assigned to the event
    const filteredVolunteers = allMinistryVolunteers.filter(
      (volunteer) =>
        // Include users that are either not yet assigned or are previous replacements
        (!eventVolunteers?.some(
          (assignedVolunteer) => assignedVolunteer.volunteer_id === volunteer.id
        ) ||
          previousVolunteerIds.has(volunteer.id)) &&
        // Exclude volunteers who are currently replacements
        !replacementVolunteerIds.has(volunteer.id)
    );

    // Map the filtered volunteers to the options format
    return filteredVolunteers.map((volunteer) => ({
      value: volunteer.id,
      label: `${volunteer.first_name} ${volunteer.last_name}`,
    }));
  }, [
    allMinistryVolunteers,
    eventVolunteers,
    previousVolunteerIds,
    replacementVolunteerIds,
  ]);

  // Fetch volunteers based on ministry
  const ministryVolunteerOptions = useMemo(() => {
    if (!ministryVolunteers || !Array.isArray(ministryVolunteers)) return [];

    // Fetch volunteers based on ministry
    const ministryUsers = ministryVolunteers.flatMap((item) => {
      if (item?.users) {
        return [
          {
            id: item.users.id,
            first_name: item.users.first_name,
            last_name: item.users.last_name,
          },
        ];
      }
      return [];
    });

    // Filter out volunteers that are already assigned to the event
    const filteredMinistryUsers = ministryUsers.filter(
      (volunteer) =>
        // Include users that are either not yet assigned or are previous replacements
        (!eventVolunteers?.some(
          (assignedVolunteer) => assignedVolunteer.volunteer_id === volunteer.id
        ) ||
          previousVolunteerIds.has(volunteer.id)) &&
        // Exclude volunteers who are currently replacements
        !replacementVolunteerIds.has(volunteer.id)
    );

    // Convert filtered data to options format
    return filteredMinistryUsers.map((volunteer) => ({
      value: volunteer.id,
      label: `${volunteer.first_name} ${volunteer.last_name}`,
    }));
  }, [
    ministryVolunteers,
    eventVolunteers,
    previousVolunteerIds,
    replacementVolunteerIds,
  ]);

  //Admin Role
  //If public event show all volunteers, coordinators and admins role
  //If private event show only the coordinator and member in volunteer group to the ministry
  const getVolunteerOptionsForRole = () => {
    if (role === ROLES.ADMIN) {
      return event?.visibility === "public"
        ? allVolunteersRole
        : ministryVolunteerOptions;
    }

    //Coordinator role
    //If public event show all members in volunteer group and their coordinator in their ministry
    //If private event show only volunteers in their volunteer group
    if (role === ROLES.COORDINATOR || role === ROLES.VOLUNTEER) {
      return event?.visibility === "public"
        ? ministriesVolunteers
        : ministryVolunteerOptions;
    }
  };

  const { data: attendance, isLoading: attendanceLoading } = useQuery({
    queryKey: ["attendance", eventId],
    queryFn: async () => {
      const response = await getEventAttendance(eventId);
      return response;
    },
    enabled: !!eventId,
  });
  const { data: attendanceCount } = useQuery({
    queryKey: ["attendance-count", eventId],
    queryFn: async () => {
      const response = await countEventAttendance(eventId);

      return response;
    },
  });

  const debouncedSearch = useDebounce(search, 300);

  const handleSearch = (e) => {
    setSearch(e.target.value);
  };

  useEffect(() => {
    const allAttendance = attendance?.data?.flatMap((family) => [
      ...family.parents.map((parent) => parent),
      ...family.children.map((child) => child),
    ]);

    const filteredSearch = allAttendance?.filter((attendee) =>
      `${attendee.first_name} ${attendee.last_name}`
        .toLocaleLowerCase()
        .includes(debouncedSearch.toLocaleLowerCase())
    );

    if (filteredSearch?.length === 0) {
      // If no search term or all attendees match, clear filters
      setFilteredParentAttendance([]);
      setFilteredChildAttendance([]);
    } else {
      // Separate filtered results into parents and children
      setFilteredParentAttendance(
        filteredSearch?.filter(
          (attendee) => attendee.attendee_type === "parents"
        )
      );
      setFilteredChildAttendance(
        filteredSearch?.filter(
          (attendee) => attendee.attendee_type === "children"
        )
      );
    }
  }, [debouncedSearch, attendance?.data]);

  // Generate the check-in QR for the loaded event (see lib/eventQr.js)
  useEffect(() => {
    let cancelled = false;
    setQRCode(null);

    const payload = buildEventQrPayload(event?.id);
    if (!payload) {
      setQrError(true);
      return;
    }
    setQrError(false);

    QRCode.toDataURL(payload, EVENT_QR_OPTIONS)
      .then((url) => {
        if (!cancelled) setQRCode(url);
      })
      .catch((error) => {
        console.error("Error generating QR code:", error.message);
        if (!cancelled) setQrError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [event?.id]);

  const onRowAttend = async (attendeeId, state) => {
    try {
      // Update attendee status in your database
      await updateAttendeeStatus(attendeeId, state);

      // Invalidate the related query to refetch fresh data
      queryClient.invalidateQueries(["attendance", eventId]);
      queryClient.invalidateQueries(["event-attendance", eventId]);
    } catch (error) {
      console.error("Error updating attendee status:", error);
    }
  };

  const onTimeOut = async (attendeeId) => {
    await updateTimeOut(attendeeId);

    queryClient.invalidateQueries(["attendance", eventId]);
  };

  const handleDownloadExcel = () => {
    downloadExcel(event, eventVolunteers, attendance, attendanceCount);
  };

  const handleDownloadPDF = () => {
    exportAttendanceList(event, eventVolunteers, attendance, attendanceCount);
  };

  useEffect(() => {
    if (!event || !role) {
      return;
    }

    const eventDate = event?.date;
    const eventTime = event?.time || "12:00:00";

    const eventDateTime = new Date(`${eventDate}T${eventTime}Z`);
    const currentDateTime = new Date();

    let offset = 0;
    if (role === "volunteer") {
      // 24 hours ahead for volunteer
      offset = 30 * 24 * 60 * 60 * 1000; //temporary set to 30days
    } else if (role === "admin" || role === "coordinator") {
      // 7 days ahead for admin
      offset = 30 * 24 * 60 * 60 * 1000; // temporary set to 30days
    }

    const eventOffset = new Date(eventDateTime.getTime() + offset);

    if (currentDateTime > eventOffset) {
      setDisableSchedule(true);
    } else {
      setDisableSchedule(false);
    }
  }, [event, role]);

  const removeAssignedVolunteerMutation = useMutation({
    mutationFn: async (volunteerId) =>
      await removeAssignedVolunteer(volunteerId, eventId),
    onSuccess: () => {
      toast({
        title: "Volunteer removed successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error removing volunteer",
        description: `${error.message}`,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["event_volunteers", eventId],
      });
    },
  });

  const addVolunteerMutation = useMutation({
    mutationFn: async (data) =>
      addAssignedVolunteer({ ...data, userId: userData?.id }),
    onSuccess: () => {
      toast({
        title: "Volunteer added successfully",
      });
    },
    onError: (error) => {
      toast({
        title: "Error adding volunteer",
        description: `${error.message}`,
        variant: "destructive",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["event_volunteers", eventId],
      });
    },
  });

  const volunteerSchema = z.object({
    assignVolunteer: z
      .array(z.string())
      .min(1, "At least one volunteer must be assigned"),
  });
  const volunteerForm = useForm({
    resolver: zodResolver(volunteerSchema),
    defaultValues: {
      assignVolunteer: [],
    },
  });

  const addVolunteers = (data) => {
    addVolunteerMutation.mutate({
      assignVolunteer: data.assignVolunteer,
      eventId,
    });
  };

  if (isLoading || attendanceLoading) return <Loading />;

  if (!eventId)
    return (
      <div className="grid grow place-items-center">
        <Description>View Attendance</Description>
      </div>
    );

  if (!event) {
    return <p>No Events.</p>;
  }

  return (
    <div className="no-scrollbar flex h-full grow flex-col gap-2 overflow-y-scroll px-3 py-2 md:px-9 md:py-6">
      <div className="flex flex-wrap justify-between">
        <div>
          <Title className="text-2xl">
            {event.requires_attendance
              ? `${event.name}, ${formatEventTimeCompact(event.time)}`
              : event.name}
          </Title>
          <Label className="text-xl text-primary-text">
            Date: {formatEventDate(event?.date)}
          </Label>
          <Description>{event?.description}</Description>
        </div>
        <div className="flex">
          <div className="flex flex-col gap-1 md:flex-row">
            {!disableSchedule && (
              <div className="flex flex-wrap gap-1">
                <AddExistingRecord eventId={eventId} />
                <AddRecord eventId={eventId} />
              </div>
            )}
            <div className="flex gap-x-2">
              <div>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button>
                      <Icon icon={"mingcute:qrcode-2-line"} />
                    </Button>
                  </DialogTrigger>
                  <DialogContent aria-describedby="generate-qrcode">
                    <DialogHeader>
                      <DialogTitle>QR Code</DialogTitle>
                      <DialogDescription>
                        Scan this QR code to check the event.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-center">
                      {qrError ? (
                        <p
                          role="alert"
                          className="text-center text-sm font-semibold text-red-500"
                        >
                          QR code unavailable: this event has no valid ID.
                        </p>
                      ) : (
                        qrCode && (
                          <img
                            src={qrCode}
                            alt="QR Code"
                            className="h-80 w-80 max-w-full"
                          />
                        )
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="rounded-xl px-3 py-3">
                      <Icon icon={"mingcute:download-2-line"} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" side="bottom">
                    <DropdownMenuItem onClick={handleDownloadPDF}>
                      Download as PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleDownloadExcel}>
                      Download as Excel
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div>
                <Dialog
                  open={deleteDialogOpen}
                  onOpenChange={(isOpen) => {
                    setDeleteDialogOpen(isOpen);
                  }}
                >
                  {((!disableSchedule && role === ROLES.ADMIN) ||
                    (!disableSchedule && role === ROLES.COORDINATOR)) && (
                    <DialogTrigger asChild>
                      <Button className="rounded-xl px-3 py-3">
                        <Icon icon={"mingcute:delete-3-line"} />
                      </Button>
                    </DialogTrigger>
                  )}
                  <DialogContent
                    className="sm:rounded-3xl"
                    aria-describedby="delete-event"
                  >
                    <DialogHeader>
                      <DialogTitle className="text-2xl text-accent">
                        Delete Event?
                      </DialogTitle>
                    </DialogHeader>
                    <DialogDescription className="text-accent opacity-80">
                      Are you sure you want to delete this event?
                    </DialogDescription>
                    <DialogFooter className="mx-2 flex gap-2">
                      <Button
                        onClick={() => setDeleteDialogOpen(false)}
                        className="rounded-xl text-accent hover:text-accent"
                        variant="outline"
                      >
                        Cancel
                      </Button>
                      <Button
                        className="rounded-xl"
                        variant={"destructive"}
                        onClick={() => {
                          deleteMutation.mutate();
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        {deleteMutation.isPending ? "Deleting..." : "Delete"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <Label className="text-primary-text">
            List of Assigned Volunteer(s)
          </Label>
          <Dialog aria-describedby="assign-volunteer">
            {!disableSchedule && (
              <DialogTrigger asChild>
                <Button className="h-5 w-5" size="icon">
                  <Icon className="text-white" icon="mingcute:add-fill"></Icon>
                </Button>
              </DialogTrigger>
            )}
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Assign Volunteers</DialogTitle>
                <DialogDescription>
                  Select volunteers to assign on this event.
                </DialogDescription>
              </DialogHeader>
              <Form {...volunteerForm}>
                <form onSubmit={volunteerForm.handleSubmit(addVolunteers)}>
                  <FormField
                    control={volunteerForm.control}
                    name="assignVolunteer"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Assign Volunteer</FormLabel>
                        <FormControl>
                          <CustomReactSelect
                            options={getVolunteerOptionsForRole()}
                            onChange={(selectedOptions) => {
                              field.onChange(
                                selectedOptions.map((option) => option.value)
                              );
                            }}
                            placeholder="Select Volunteer"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <div className="mt-2 flex justify-end">
                    <DialogClose>
                      <Button type="submit">Add</Button>
                    </DialogClose>
                  </div>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </div>
        {eventVolunteers?.map((volunteer, i) => (
          <div key={i} className="flex gap-2">
            <p>{`${i + 1}.`}</p>
            <p
              className={cn("text-primary-text", {
                "line-through": volunteer.replaced === true,
              })}
            >{`${volunteer.users.first_name.toFirstUpperCase()} ${volunteer.users.last_name.toFirstUpperCase()} `}</p>
            {volunteer?.volunteer_replacement && (
              <p
                className={"text-primary-text"}
              >{`${volunteer?.volunteer_replacement?.first_name.toFirstUpperCase()} ${volunteer?.volunteer_replacement?.last_name.toFirstUpperCase()}`}</p>
            )}

            <div className="flex items-center justify-center gap-2">
              {!disableSchedule && (
                <VolunteerSelect
                  // setVolunteerDialogOpen={setVolunteerDialogOpen}
                  currentVolunteer={volunteer}
                  assignedVolunteers={eventVolunteers}
                  admins={admins}
                  oldVolunteerId={volunteer?.volunteer_id}
                  eventId={eventId}
                  eventVisibility={event?.visibility}
                  volunteers={volunteers}
                  volunteerOptions={getVolunteerOptionsForRole()}
                  newreplacement_id={volunteer?.replacedby_id}
                  replaced={volunteer.replaced}
                  disableSchedule={disableSchedule}
                />
              )}
              <Dialog>
                {!disableSchedule && (
                  <DialogTrigger>
                    <Icon
                      className="h-5 w-5 text-red-500 hover:cursor-pointer"
                      icon={"mingcute:delete-2-line"}
                    ></Icon>
                  </DialogTrigger>
                )}

                <DialogContent aria-describedby="update-volunteer">
                  <DialogHeader>
                    <DialogTitle>
                      Remove
                      {!volunteer?.volunteer_replacement
                        ? `${volunteer.users.first_name.toFirstUpperCase()} ${volunteer.users.last_name.toFirstUpperCase()} `
                        : `${volunteer?.volunteer_replacement?.first_name.toFirstUpperCase()} ${volunteer?.volunteer_replacement?.last_name.toFirstUpperCase()}?`}
                    </DialogTitle>
                    <DialogDescription>
                      Are you sure you want to remove this volunteer?
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button>Cancel</Button>
                    </DialogClose>
                    <DialogClose asChild>
                      <Button
                        onClick={() =>
                          removeAssignedVolunteerMutation.mutate(
                            volunteer.replaced
                              ? volunteer.replacedby_id
                              : volunteer.volunteer_id
                          )
                        }
                        className="rounded-lg"
                        variant={"destructive"}
                      >
                        Delete
                      </Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap justify-evenly font-montserrat font-semibold text-accent">
        <p>Total Registered: {attendanceCount?.total}</p>
        <p>Total Attended: {attendanceCount?.attended}</p>
        <p>
          Total Pending: {attendanceCount?.total - attendanceCount?.attended}
        </p>
      </div>
      <div className="flex items-center justify-center">
        <div className="relative w-8/12">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 transform text-2xl text-accent" />
          <Input
            value={search}
            onChange={handleSearch}
            className="border-none pl-12"
            placeholder="Search attendee"
          />
        </div>
      </div>

      {attendance?.data?.length < 1 && (
        <div className="flex items-center justify-center">
          <p>No Family registered yet.</p>
        </div>
      )}
      {debouncedSearch !== "" ? (
        <Card className="">
          <CardHeader className="p-2">
            <CardDescription className="sr-only">
              Family Details
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 p-1">
            <div className="flex justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-semibold text-accent">
                  Parent(s) / Guardian(s)
                </h3>
              </div>
            </div>
            <AttendanceTable
              updateTimeOut={onTimeOut}
              // onSubmit={onSubmit}
              attendeeType={"parents"}
              disableSchedule={disableSchedule}
              attendance={filteredParentAttendance}
              onRowAttend={onRowAttend}
            />

            <div className="flex items-center gap-2">
              <h3 className="text-xl font-semibold text-accent">Children</h3>
            </div>
            <AttendanceTable
              updateTimeOut={onTimeOut}
              // onSubmit={onSubmit}
              disableSchedule={disableSchedule}
              attendance={filteredChildAttendance}
              onRowAttend={onRowAttend}
            />
          </CardContent>
        </Card>
      ) : (
        attendance.data?.map((family, i) => {
          const mainApplicant = family?.registered_by;
          const walkInMainApplicant = family?.parents?.find(
            (parent) => parent.main_applicant
          );

          const applicantName = walkInMainApplicant
            ? `${walkInMainApplicant?.first_name} ${walkInMainApplicant?.last_name} Family`
            : `Added by ${mainApplicant?.first_name} ${mainApplicant?.last_name} `;

          return (
            <Card className="p-2" key={i}>
              <CardHeader className="p-2">
                <CardTitle className="font-montserrat font-bold text-accent">
                  {applicantName}
                </CardTitle>
                <CardDescription className="sr-only">
                  Family Details
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-1">
                <div className="flex justify-between">
                  <div className="flex items-center gap-2">
                    <h3 className="text-xl font-semibold text-accent">
                      Parent(s) / Guardian(s)
                    </h3>
                    {!disableSchedule && (
                      <>
                        <AddAttendee
                          attendee_type={"parents"}
                          family_id={family.family_id}
                          event_id={eventId}
                        />
                        <Popover>
                          <PopoverTrigger asChild>
                            <Icon
                              className="h-5 w-5 text-primary-text"
                              icon="mingcute:question-line"
                            />
                          </PopoverTrigger>
                          <PopoverContent>
                            <p>
                              This button allows you to add a parent or guardian
                              to this family.
                            </p>
                          </PopoverContent>
                        </Popover>
                      </>
                    )}
                  </div>
                  <ParentAddLogs family_id={family.family_id} />
                </div>
                <AttendanceTable
                  updateTimeOut={onTimeOut}
                  // onSubmit={onSubmit}
                  attendeeType="parents"
                  disableSchedule={disableSchedule}
                  attendance={family.parents}
                  onRowAttend={onRowAttend}
                />

                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-semibold text-accent">
                    Children
                  </h3>
                  {!disableSchedule && (
                    <>
                      <AddAttendee
                        attendee_type={"children"}
                        family_id={family.family_id}
                        event_id={eventId}
                      />
                      <Popover>
                        <PopoverTrigger asChild>
                          <Icon
                            className="h-5 w-5 text-primary-text"
                            icon="mingcute:question-line"
                          />
                        </PopoverTrigger>
                        <PopoverContent>
                          <p>
                            This button allows you to add a child to this
                            family.
                          </p>
                        </PopoverContent>
                      </Popover>
                    </>
                  )}
                </div>

                <AttendanceTable
                  updateTimeOut={onTimeOut}
                  // onSubmit={onSubmit}
                  disableSchedule={disableSchedule}
                  attendance={family.children}
                  onRowAttend={onRowAttend}
                />
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
};

export default memo(ScheduleDetails);
