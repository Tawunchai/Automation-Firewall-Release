import { baseApi } from "./http";

export interface CalendarEvent {
  id: number;
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  category: string;
  color: string;
  created_at: string;
}

export interface CalendarEventPayload {
  title: string;
  description: string;
  start_date: string;
  end_date: string;
  all_day: boolean;
  category: string;
  color: string;
}

export const ListCalendarEvents = async (): Promise<CalendarEvent[]> => {
  const res = await baseApi.get<{ data: CalendarEvent[] }>("/calendar-events");
  return res.data.data ?? [];
};

export const CreateCalendarEvent = async (
  payload: CalendarEventPayload
): Promise<CalendarEvent> => {
  const res = await baseApi.post<CalendarEvent>("/calendar-events", payload);
  return res.data;
};

export const UpdateCalendarEvent = async (
  id: number,
  payload: CalendarEventPayload
): Promise<CalendarEvent> => {
  const res = await baseApi.patch<CalendarEvent>(`/calendar-events/${id}`, payload);
  return res.data;
};

export const DeleteCalendarEvent = async (id: number): Promise<void> => {
  await baseApi.delete(`/calendar-events/${id}`);
};
