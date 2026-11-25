export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  linkPath: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH';
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  emailEnabled: boolean;
  maxPerHour: number;
  maxDistanceKm: number | null;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  emailDeliveryAvailable: boolean;
}

export type NotificationPreferencesInput = Omit<NotificationPreferences, 'emailDeliveryAvailable'>;
