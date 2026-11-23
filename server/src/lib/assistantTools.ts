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
  getDevicesForTeamId,
  getLocationsForTeamId,
  getUserFromUuid,
  ensureDefaultLocation,
  toPublicDevice,
} from './db';
import { getTeamForUser, getTeamMembers, getTeamScopeUuid } from './db/teams';
import { getTeamContext } from './teamContext';
import { getTeamMemberRole, toTeamMembers } from './teamAccess';

export interface AssistantDataProviders {
  listDevices(userUuid: string, limit: number): Promise<unknown>;
  readDeviceData(
    userUuid: string,
    input: Pick<NormalizedAssistantToolInput, 'deviceId' | 'metric' | 'hours' | 'limit'>,
  ): Promise<unknown>;
  listLocations(userUuid: string, limit: number): Promise<unknown>;
  getTeamSettings(userUuid: string): Promise<unknown>;
  listTeamMembers(userUuid: string, limit: number): Promise<unknown>;
}

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
  async listDevices(userUuid, limit) {
    const user = await requireUser(userUuid);
    const scopeUuid = await getTeamScopeUuid(user);
    const devices = (await getDevicesForTeamId(scopeUuid)).slice(0, limit);
    const stats = await getDataPointStats(devices.map((device) => device.serial));
    return {
      devices: devices.map((device) => {
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
    const user = await requireUser(userUuid);
    const scopeUuid = await getTeamScopeUuid(user);
    const devices = await getDevicesForTeamId(scopeUuid);
    const device = input.deviceId
      ? devices.find(
          (candidate) =>
            String(candidate.serial) === input.deviceId ||
            candidate.name?.toLowerCase() === input.deviceId?.toLowerCase(),
        )
      : devices[0];
    if (!device) throw new Error('Device not found');
    if (device.teamId !== scopeUuid) throw new Error('Device is outside your team scope');

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
export function registerAssistantDataProviders(next: AssistantDataProviders): void {
  providers = next;
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

const readProvider = async (
  context: AssistantToolExecutionContext,
  name: AssistantToolName,
  read: (source: AssistantDataProviders) => Promise<unknown>,
): Promise<AssistantToolResult> => {
  try {
    const data = await read(requireProviders());
    return { toolId: context.toolId, name, status: 'ok', summary: summarize(data), data };
  } catch (error) {
    return {
      toolId: context.toolId,
      name,
      status: 'error',
      summary: 'Could not read the requested data.',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

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
  'locations.list': (context) => {
    const input = normalizeAssistantToolInput('locations.list', context.input);
    return readProvider(context, 'locations.list', (source) =>
      source.listLocations(context.userUuid, input.limit),
    );
  },
  'team.settings': (context) =>
    readProvider(context, 'team.settings', (source) => source.getTeamSettings(context.userUuid)),
  'team.members': (context) => {
    const input = normalizeAssistantToolInput('team.members', context.input);
    return readProvider(context, 'team.members', (source) =>
      source.listTeamMembers(context.userUuid, input.limit),
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
