import {
  normalizeAssistantToolInput,
  type AssistantToolInput,
  type AssistantToolName,
  type AssistantToolResult,
  type AssistantUserQuestion,
  type NormalizedAssistantToolInput,
} from '@common';
import {
  getDataPointStats,
  getDataPointsForDevice,
  getLocationsForTeamId,
  getUserFromUuid,
  ensureDefaultLocation,
  toPublicDevice,
} from './db';
import { getTeamForUser, getTeamMembers } from './db/teams';
import { getTeamContext } from './teamContext';
import { getTeamMemberRole, toTeamMembers } from './teamAccess';
import {
  extendedAssistantToolData,
  resolveAssistantDevice,
  resolveAssistantScope,
} from './assistantToolData';

export type AssistantDataProviders = {
  listDevices(userUuid: string, limit: number): Promise<unknown>;
  readDeviceData(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'deviceId' | 'metric' | 'hours' | 'limit'>,
  ): Promise<unknown>;
  listLocations(userUuid: string, limit: number): Promise<unknown>;
  getTeamSettings(userUuid: string): Promise<unknown>;
  listTeamMembers(userUuid: string, limit: number): Promise<unknown>;
} & typeof extendedAssistantToolData;

export type AssistantToolExecutionContext = {
  userUuid: string;
  chatId?: string;
  requestId: string;
  toolId: string;
  input: AssistantToolInput;
  askUser: (question: AssistantUserQuestion) => Promise<Record<string, string>>;
};

export type AssistantToolExecutor = (
  context: AssistantToolExecutionContext,
) => Promise<AssistantToolResult>;

const METRICS = ['temperature', 'humidity', 'airPressure'] as const;

const requireUser = async (userUuid: string) => {
  const user = await getUserFromUuid(userUuid);
  if (!user) throw new Error('User not found');
  return user;
};

const defaultProviders: AssistantDataProviders = {
  ...extendedAssistantToolData,

  async listDevices(userUuid, limit) {
    const { devices } = await resolveAssistantScope(userUuid);
    const stats = await getDataPointStats(devices.map((device) => device.serial));
    return {
      devices: devices.slice(0, limit).map((device) => {
        const publicDevice = toPublicDevice(device);
        const deviceStats = stats.get(device.serial);
        return {
          ...publicDevice,
          dataPointCount: deviceStats?.count ?? 0,
          latestDataPoint: deviceStats?.latest ?? null,
        };
      }),
    };
  },

  async readDeviceData(userUuid, input) {
    const { device } = await resolveAssistantDevice(userUuid, input.deviceId);
    const since = new Date(Date.now() - input.hours * 60 * 60 * 1000);
    const { points, totalCount } = await getDataPointsForDevice(device.serial, {
      since,
      maxPoints: input.limit,
    });
    const metric = METRICS.find((item) => item === input.metric);
    const dataPoints = metric
      ? points.map((point) => ({ timestamp: point.timestamp, [metric]: point[metric] }))
      : points;
    return {
      serial: device.serial,
      name: device.name,
      metric: metric ?? 'all',
      hours: input.hours,
      totalCount,
      dataPoints,
    };
  },

  async listLocations(userUuid, limit) {
    const user = await requireUser(userUuid);
    const { scopeUuid, scopeUsername } = await getTeamContext(user);
    const defaultLocation = await ensureDefaultLocation(scopeUuid, scopeUsername);
    const locations = await getLocationsForTeamId(scopeUuid);
    return {
      locations: [
        defaultLocation,
        ...locations.filter((location) => location.id !== defaultLocation.id),
      ].slice(0, limit),
    };
  },

  async getTeamSettings(userUuid) {
    const user = await requireUser(userUuid);
    const team = await getTeamForUser(user);
    const role = team ? getTeamMemberRole(user, team) : 'member';
    if (!team) {
      return {
        role,
        team: { id: user.uuid, name: 'Personal workspace', tier: 'free' },
      };
    }
    return {
      role,
      team: {
        id: team.id,
        name: team.name,
        tier: team.tier,
        seats: team.seats,
        subscriptionStatus: team.subscriptionStatus,
        currentPeriodEnd: team.currentPeriodEnd,
        gifted: team.gifted,
      },
    };
  },

  async listTeamMembers(userUuid, limit) {
    const user = await requireUser(userUuid);
    const team = await getTeamForUser(user);
    if (!team) {
      return {
        members: [
          {
            uuid: user.uuid,
            username: user.username,
            role: 'member' as const,
            joinedAt: user.createdAt,
          },
        ],
      };
    }
    return { members: toTeamMembers(await getTeamMembers(team.id), team).slice(0, limit) };
  },
};

let providers: AssistantDataProviders = defaultProviders;

/** Lets tests or deployments override where assistant tools read data from. */
export function registerAssistantDataProviders(next: Partial<AssistantDataProviders>): void {
  providers = { ...defaultProviders, ...next };
}

const requireProviders = (): AssistantDataProviders => providers;

const summarize = (data: unknown, limit = 600): string => {
  try {
    const text = JSON.stringify(data);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  } catch {
    return 'Result could not be serialized';
  }
};

const callProvider = async (
  context: AssistantToolExecutionContext,
  name: AssistantToolName,
  read: (source: AssistantDataProviders) => Promise<unknown>,
  errorSummary: string,
): Promise<AssistantToolResult> => {
  try {
    const data = await read(requireProviders());
    return { toolId: context.toolId, name, status: 'ok', summary: summarize(data), data };
  } catch (error) {
    return {
      toolId: context.toolId,
      name,
      status: 'error',
      summary: errorSummary,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

const readProvider = (
  context: AssistantToolExecutionContext,
  name: AssistantToolName,
  read: (source: AssistantDataProviders) => Promise<unknown>,
) => callProvider(context, name, read, 'Could not read the requested data.');

const writeProvider = (
  context: AssistantToolExecutionContext,
  name: AssistantToolName,
  read: (source: AssistantDataProviders) => Promise<unknown>,
) => callProvider(context, name, read, 'Could not complete that change.');

const executors: Record<AssistantToolName, AssistantToolExecutor> = {
  'devices.list': (context) => {
    const input = normalizeAssistantToolInput('devices.list', context.input);
    return readProvider(context, 'devices.list', (source) =>
      source.listDevices(context.userUuid, input.limit),
    );
  },
  'devices.data': (context) => {
    const input = normalizeAssistantToolInput('devices.data', context.input);
    return readProvider(context, 'devices.data', (source) =>
      source.readDeviceData(context.userUuid, input),
    );
  },
  'devices.uptime': (context) => {
    const input = normalizeAssistantToolInput('devices.uptime', context.input);
    return readProvider(context, 'devices.uptime', (source) =>
      source.getDeviceUptime(context.userUuid, input.deviceId),
    );
  },
  'devices.logs': (context) => {
    const input = normalizeAssistantToolInput('devices.logs', context.input);
    return readProvider(context, 'devices.logs', (source) =>
      source.listDeviceLogs(context.userUuid, input),
    );
  },
  'devices.tokens': (context) => {
    const input = normalizeAssistantToolInput('devices.tokens', context.input);
    return readProvider(context, 'devices.tokens', (source) =>
      source.listDeviceTokens(context.userUuid, input.deviceId, input.limit),
    );
  },
  'devices.forecast': (context) => {
    const input = normalizeAssistantToolInput('devices.forecast', context.input);
    return readProvider(context, 'devices.forecast', (source) =>
      source.forecastDevice(context.userUuid, input),
    );
  },
  'locations.list': (context) => {
    const input = normalizeAssistantToolInput('locations.list', context.input);
    return readProvider(context, 'locations.list', (source) =>
      source.listLocations(context.userUuid, input.limit),
    );
  },
  'locations.detail': (context) => {
    const input = normalizeAssistantToolInput('locations.detail', context.input);
    return readProvider(context, 'locations.detail', (source) =>
      source.getLocation(context.userUuid, input.locationId),
    );
  },
  'alerts.list': (context) => {
    const input = normalizeAssistantToolInput('alerts.list', context.input);
    return readProvider(context, 'alerts.list', (source) =>
      source.listAlerts(context.userUuid, input),
    );
  },
  'alerts.create': (context) => {
    const input = normalizeAssistantToolInput('alerts.create', context.input);
    return writeProvider(context, 'alerts.create', (source) =>
      source.createAlert(context.userUuid, input),
    );
  },
  'alerts.update': (context) => {
    const input = normalizeAssistantToolInput('alerts.update', context.input);
    return writeProvider(context, 'alerts.update', (source) =>
      source.updateAlert(context.userUuid, input),
    );
  },
  'alerts.delete': (context) => {
    const input = normalizeAssistantToolInput('alerts.delete', context.input);
    return writeProvider(context, 'alerts.delete', (source) =>
      source.deleteAlert(context.userUuid, input.id as string),
    );
  },
  'alerts.test': (context) => {
    const input = normalizeAssistantToolInput('alerts.test', context.input);
    return writeProvider(context, 'alerts.test', (source) =>
      source.testAlert(context.userUuid, input.id as string),
    );
  },
  'integrations.list': (context) =>
    readProvider(context, 'integrations.list', (source) =>
      source.listIntegrations(context.userUuid),
    ),
  'team.settings': (context) =>
    readProvider(context, 'team.settings', (source) => source.getTeamSettings(context.userUuid)),
  'team.members': (context) => {
    const input = normalizeAssistantToolInput('team.members', context.input);
    return readProvider(context, 'team.members', (source) =>
      source.listTeamMembers(context.userUuid, input.limit),
    );
  },
  'team.audit': (context) => {
    const input = normalizeAssistantToolInput('team.audit', context.input);
    return readProvider(context, 'team.audit', (source) =>
      source.listTeamAudit(context.userUuid, input.limit),
    );
  },
  'team.invites': (context) => {
    const input = normalizeAssistantToolInput('team.invites', context.input);
    return readProvider(context, 'team.invites', (source) =>
      source.listTeamInvites(context.userUuid, input.limit),
    );
  },
  'credits.balance': (context) =>
    readProvider(context, 'credits.balance', (source) =>
      source.getCreditBalance(context.userUuid),
    ),
  'notifications.list': (context) => {
    const input = normalizeAssistantToolInput('notifications.list', context.input);
    return readProvider(context, 'notifications.list', (source) =>
      source.listNotifications(context.userUuid, input),
    );
  },
  'notifications.read': (context) => {
    const input = normalizeAssistantToolInput('notifications.read', context.input);
    return writeProvider(context, 'notifications.read', (source) =>
      source.markNotificationRead(context.userUuid, input),
    );
  },
  'sessions.list': (context) => {
    const input = normalizeAssistantToolInput('sessions.list', context.input);
    return readProvider(context, 'sessions.list', (source) =>
      source.listSessions(context.userUuid, input.limit),
    );
  },
  'user.profile': (context) =>
    readProvider(context, 'user.profile', (source) => source.getUserProfile(context.userUuid)),
  'assistant.chats': (context) => {
    const input = normalizeAssistantToolInput('assistant.chats', context.input);
    return readProvider(context, 'assistant.chats', (source) =>
      source.listAssistantChats(context.userUuid, input.limit),
    );
  },
  'help.search': (context) => {
    const input = normalizeAssistantToolInput('help.search', context.input);
    return readProvider(context, 'help.search', (source) =>
      source.searchHelp(input.query as string, input.limit),
    );
  },
  'alerts.mute': (context) => {
    const input = normalizeAssistantToolInput('alerts.mute', context.input);
    return writeProvider(context, 'alerts.mute', (source) =>
      source.muteAlert(context.userUuid, input),
    );
  },
  'location.create': (context) => {
    const input = normalizeAssistantToolInput('location.create', context.input);
    return writeProvider(context, 'location.create', (source) =>
      source.createLocation(context.userUuid, input.displayName as string),
    );
  },
  'device.rename': (context) => {
    const input = normalizeAssistantToolInput('device.rename', context.input);
    return writeProvider(context, 'device.rename', (source) =>
      source.renameDevice(context.userUuid, input.deviceId, input.displayName as string),
    );
  },
  'user.question': async (context) => {
    const input = normalizeAssistantToolInput('user.question', context.input);
    const question = input.question;
    if (!question) {
      return {
        toolId: context.toolId,
        name: 'user.question',
        status: 'error',
        summary: 'Question details were invalid.',
        error: 'Missing question',
      };
    }
    try {
      const answers = await context.askUser(question);
      return {
        toolId: context.toolId,
        name: 'user.question',
        status: 'ok',
        summary: `You answered ${Object.keys(answers).length} question(s).`,
        question,
        answers,
        data: answers,
      };
    } catch (error) {
      return {
        toolId: context.toolId,
        name: 'user.question',
        status: 'error',
        summary: 'No answer was received.',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  },
};

export async function executeAssistantTool(
  name: unknown,
  context: AssistantToolExecutionContext,
): Promise<AssistantToolResult> {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(executors, name)) {
    return {
      toolId: context.toolId,
      name: String(name),
      status: 'error',
      summary: 'Unknown tool.',
      error: `Unknown tool: ${String(name)}`,
    };
  }
  try {
    return await executors[name as AssistantToolName](context);
  } catch (error) {
    return {
      toolId: context.toolId,
      name: name as AssistantToolName,
      status: 'error',
      summary: 'Invalid tool arguments.',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
