
export interface ProfileSource {
  title: string;
  uri: string;
}

export interface Profile {
  id: string;
  name: string;
  headline: string;
  about: string;
  interests: string[];
  skills: string[];
  linkedinUrl: string;
  imageUrl?: string;
  lastUpdated: number;
  sources?: ProfileSource[];
}

export interface NetworkingSynergy {
  pair: [string, string]; // User IDs
  reason: string;
  topic: string;
  strength: number; // 0-100
}

export interface MeetingSession {
  id: string; // 6-digit code
  name: string;
  hostId: string;
  createdAt: number;
  participants: Profile[];
  status: 'active' | 'archived';
}
