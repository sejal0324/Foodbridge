/**
 * Central TanStack Query keys. Invalidate with the shortest prefix that covers
 * what changed, e.g. `queryClient.invalidateQueries({ queryKey: qk.donations.all })`.
 */
export const qk = {
  me: ['auth', 'me'] as const,
  publicImpact: ['public', 'impact'] as const,
  foodCategories: ['food-categories'] as const,

  donations: {
    all: ['donations'] as const,
    list: (params: object) => ['donations', 'list', params] as const,
    detail: (id: string) => ['donations', 'detail', id] as const,
  },
  requests: {
    all: ['requests'] as const,
    list: (params: object) => ['requests', 'list', params] as const,
  },
  allocations: {
    all: ['allocations'] as const,
    list: (params: object) => ['allocations', 'list', params] as const,
  },
  matching: {
    all: ['matching'] as const,
    ngosForDonation: (donationId: string) => ['matching', 'ngos', donationId] as const,
    donorsForRequest: (requestId: string) => ['matching', 'donors', requestId] as const,
    requestsForDonor: ['matching', 'assistance-requests'] as const,
    donationsForNgo: ['matching', 'donations'] as const,
  },
  assistance: {
    all: ['assistance'] as const,
    list: (params: object) => ['assistance', 'list', params] as const,
    detail: (id: string) => ['assistance', 'detail', id] as const,
    myOffers: ['assistance', 'offers', 'mine'] as const,
  },
  pickups: {
    all: ['pickups'] as const,
    list: (params: object) => ['pickups', 'list', params] as const,
    detail: (id: string) => ['pickups', 'detail', id] as const,
  },
  tracking: {
    session: (id: string) => ['tracking', id] as const,
    path: (id: string) => ['tracking', id, 'path'] as const,
  },
  rewards: {
    all: ['rewards'] as const,
    balance: ['rewards', 'balance'] as const,
    history: (page: number) => ['rewards', 'history', page] as const,
    leaderboard: (month: string | undefined) => ['rewards', 'leaderboard', month ?? 'current'] as const,
    certificates: ['rewards', 'certificates'] as const,
  },
  billing: {
    feeEstimate: (unit: string, quantity: number) => ['billing', 'fee-estimate', unit, quantity] as const,
  },
  predictions: {
    surplus: (date?: string) => ['predictions', 'surplus', date ?? 'next'] as const,
    accuracy: ['predictions', 'accuracy'] as const,
    metrics: (days: number) => ['predictions', 'metrics', days] as const,
  },
  analytics: {
    role: (role: string) => ['analytics', role] as const,
    insights: ['analytics', 'insights'] as const,
  },
  notifications: {
    all: ['notifications'] as const,
    list: (params: object) => ['notifications', 'list', params] as const,
    unread: ['notifications', 'unread'] as const,
    preferences: ['notifications', 'preferences'] as const,
  },
  assistant: {
    suggestions: ['assistant', 'suggestions'] as const,
    conversations: ['assistant', 'conversations'] as const,
    messages: (id: string) => ['assistant', 'messages', id] as const,
  },
  profile: {
    donor: ['profile', 'donor'] as const,
    ngo: ['profile', 'ngo'] as const,
    documents: ['profile', 'documents'] as const,
  },
  representatives: {
    photo: (id: string) => ['representatives', id, 'photo'] as const,
  },
} as const;
