import type { AssistantVariants } from './assistant';
import type { SubscriptionTier } from './subscription';

export type UserAccessCount = number | 'team';

export type EventsAccess = 'limited' | 'standard' | 'priority';

export type PlanTier = 'free' | SubscriptionTier;

export type PlanFeatures = {
  sharedMaxDataPointsPerUser: number;
  dataRetentionDays: number;
  maxDevices: number;
  maxLocations: number;
  maxAdditionalUsersAccess: UserAccessCount;
  sharedMonthlyCreditsPerUser: number;
  sharedMaxAdditionalCredits: number;
  sharedQueryBoostLimitMonthlyPerUser: number;
  queryComputeUnitLimit: number;
  queryCostCredits: number;
  boostedQueryCostCredits: number;
  availableAssistantVariants: AssistantVariants[];
  dataShared: boolean;
  eventsAccess: EventsAccess;
  maxUsers: number;
};

export const PLAN_FEATURES: Record<PlanTier, PlanFeatures> = {
  free: {
    sharedMaxDataPointsPerUser: 500_000,
    dataRetentionDays: 7,
    maxDevices: 2,
    maxLocations: 1,
    maxAdditionalUsersAccess: 0,
    sharedMonthlyCreditsPerUser: 0,
    sharedMaxAdditionalCredits: 200,
    sharedQueryBoostLimitMonthlyPerUser: 0,
    queryComputeUnitLimit: 15,
    queryCostCredits: 0.5,
    boostedQueryCostCredits: 4,
    availableAssistantVariants: ['nano'],
    dataShared: true,
    eventsAccess: 'limited',
    maxUsers: 1,
  },
  lite: {
    sharedMaxDataPointsPerUser: 10_000_000,
    dataRetentionDays: 30,
    maxDevices: 10,
    maxLocations: 1,
    maxAdditionalUsersAccess: 0,
    sharedMonthlyCreditsPerUser: 500,
    sharedMaxAdditionalCredits: 750,
    sharedQueryBoostLimitMonthlyPerUser: 1,
    queryComputeUnitLimit: 100,
    queryCostCredits: 0.3,
    boostedQueryCostCredits: 4,
    availableAssistantVariants: ['nano', 'lite'],
    dataShared: true,
    eventsAccess: 'limited',
    maxUsers: 1,
  },
  plus: {
    sharedMaxDataPointsPerUser: 20_000_000,
    dataRetentionDays: 60,
    maxDevices: 25,
    maxLocations: 2,
    maxAdditionalUsersAccess: 1,
    sharedMonthlyCreditsPerUser: 750,
    sharedMaxAdditionalCredits: 1000,
    sharedQueryBoostLimitMonthlyPerUser: 100,
    queryComputeUnitLimit: 500,
    queryCostCredits: 0.2,
    boostedQueryCostCredits: 3,
    availableAssistantVariants: ['nano', 'lite', 'standard'],
    dataShared: true,
    eventsAccess: 'standard',
    maxUsers: 1,
  },
  ultra: {
    sharedMaxDataPointsPerUser: 150_000_000,
    dataRetentionDays: 365,
    maxDevices: 50,
    maxLocations: 5,
    maxAdditionalUsersAccess: 5,
    sharedMonthlyCreditsPerUser: 5000,
    sharedMaxAdditionalCredits: 7500,
    sharedQueryBoostLimitMonthlyPerUser: 1000,
    queryComputeUnitLimit: 1000,
    queryCostCredits: 0.15,
    boostedQueryCostCredits: 2,
    availableAssistantVariants: [
      'nano',
      'lite',
      'standard',
      'plus',
      'turbo'
    ],
    dataShared: false,
    eventsAccess: 'standard',
    maxUsers: 1,
  },
  'team-lite': {
    sharedMaxDataPointsPerUser: 25_000_000,
    dataRetentionDays: 30,
    maxDevices: 50,
    maxLocations: 5,
    maxAdditionalUsersAccess: 'team',
    sharedMonthlyCreditsPerUser: 200,
    sharedMaxAdditionalCredits: 2000,
    sharedQueryBoostLimitMonthlyPerUser: 50,
    queryComputeUnitLimit: 150,
    queryCostCredits: 0.25,
    boostedQueryCostCredits: 3.5,
    availableAssistantVariants: ['nano', 'lite', 'standard'],
    dataShared: true,
    eventsAccess: 'limited',
    maxUsers: 5,
  },
  'team-plus': {
    sharedMaxDataPointsPerUser: 50_000_000,
    dataRetentionDays: 365,
    maxDevices: 100,
    maxLocations: 10,
    maxAdditionalUsersAccess: 'team',
    sharedMonthlyCreditsPerUser: 1000,
    sharedMaxAdditionalCredits: 20000,
    sharedQueryBoostLimitMonthlyPerUser: 250,
    queryComputeUnitLimit: 500,
    queryCostCredits: 0.15,
    boostedQueryCostCredits: 3,
    availableAssistantVariants: [
      'nano',
      'lite',
      'standard',
      'plus',
    ],
    dataShared: false,
    eventsAccess: 'standard',
    maxUsers: 15,
  },
  'team-ultra': {
    sharedMaxDataPointsPerUser: 150_000_000,
    dataRetentionDays: 730,
    maxDevices: 250,
    maxLocations: 25,
    maxAdditionalUsersAccess: 'team',
    sharedMonthlyCreditsPerUser: 5000,
    sharedMaxAdditionalCredits: 400000,
    sharedQueryBoostLimitMonthlyPerUser: 2000,
    queryComputeUnitLimit: 1500,
    queryCostCredits: 0.1,
    boostedQueryCostCredits: 2,
    availableAssistantVariants: [
      'nano',
      'lite',
      'standard',
      'plus',
      'turbo',
      'ultra',
    ],
    dataShared: false,
    eventsAccess: 'priority',
    maxUsers: 50,
  },
};
