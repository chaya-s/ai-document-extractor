import {
  createModels,
  type AssistantMessage,
  type Context,
  type ToolCall,
} from '@earendil-works/pi-ai';

import {
  openrouterProvider,
} from '@earendil-works/pi-ai/providers/openrouter';

import fs from 'fs/promises';
import { randomUUID } from 'crypto';

import {
  documentTools,
  executeWorkspaceTool,
} from '@/lib/document-tools';

import {
  assertWorkspaceId,
  readSession,
  resolveWorkspacePath,
  writeSession,
  type WorkspaceSession,
} from '@/lib/pi-workspace';

export const runtime = 'nodejs';

const models = createModels();

models.setProvider(
  openrouterProvider()
);

const MAX_TOOL_CALLS = 40;

const THINKING_LEVEL = 'high';

type TraceEventType =
  | 'session'
  | 'model_change'
  | 'thinking_level_change'
  | 'message'
  | 'session.started'
  | 'model.started'
  | 'agent.trace'
  | 'tool.started'
  | 'tool.completed'
  | 'result.saved'
  | 'session.completed'
  | 'session.failed';

type TraceEvent = {
  type: TraceEventType;
  id: string;
  parentId: string | null;
  timestamp: string;
  [key: string]: unknown;
};

function serializableContext(
  context: Context
): Context {
  return {
    systemPrompt: context.systemPrompt,
    messages: context.messages,
  };
}

function toolCallsFromMessage(
  message: AssistantMessage
): ToolCall[] {
  return message.content.filter(
    (
      block
    ): block is ToolCall =>
      block.type === 'toolCall'
  );
}

const MAX_ASSISTANT_TRACE_TEXT_LENGTH = 2000;

function sanitizeAssistantToolArguments(
  block: ToolCall
): Record<string, unknown> {
  const args =
    block.arguments as Record<
      string,
      unknown
    >;

  if (
    block.name === 'grep_document'
  ) {
    const safeArgs: Record<
      string,
      unknown
    > = {};

    if (
      typeof args.query === 'string'
    ) {
      safeArgs.query = args.query;
    }

    if (
      args.maxMatches !== undefined
    ) {
      safeArgs.maxMatches =
        args.maxMatches;
    }

    return safeArgs;
  }

  if (
    block.name === 'read_document'
  ) {
    const safeArgs: Record<
      string,
      unknown
    > = {};

    if (
      args.offset !== undefined
    ) {
      safeArgs.offset = args.offset;
    }

    if (
      args.limit !== undefined
    ) {
      safeArgs.limit = args.limit;
    }

    return safeArgs;
  }

  if (
    block.name === 'save_result'
  ) {
    return {
      fields: [
        'Reporting Period',
        'Aircraft Serial Number',
        'Aircraft Type',
        'Total Month Cycles',
        'Total Month Hours',
        'Total New Cycles',
        'Total New Time',
        'Component List',
      ],
    };
  }

  return {};
}

function sanitizeAssistantContent(
  content: AssistantMessage['content']
): Record<string, unknown>[] {
  return content.map((block) => {
    if (block.type === 'text') {
      return {
        type: 'text',

        text:
          block.text.slice(
            0,
            MAX_ASSISTANT_TRACE_TEXT_LENGTH
          ),
      };
    }

    if (block.type === 'toolCall') {
      return {
        type: 'toolCall',

        id:
          block.id,

        name:
          block.name,

        arguments:
          sanitizeAssistantToolArguments(
            block
          ),
      };
    }

    if (block.type === 'thinking') {
      return {
        type: 'thinking',

        hasThinking:
          Boolean(block.thinking),

        thinkingCharacters:
          block.thinking?.length ?? 0,

        hasThinkingSignature:
          Boolean(
            block.thinkingSignature
          ),

        redacted:
          block.redacted ?? false,
      };
    }

    return {
      type: 'unknown',
    };
  });
}

type AgentTraceData = {
  objective: string;

  evidence: string[];

  missing: string[];

  action: {
    tool:
      | 'grep_document'
      | 'read_document'
      | 'save_result'
      | null;

    query?: string;

    offset?: number;

    limit?: number;
  };

  reason: string;

  uncertainty: string;

  next: string;
};

const MAX_TRACE_STRING_LENGTH = 300;
const MAX_TRACE_ARRAY_ITEMS = 12;

function sanitizeTraceString(
  value: unknown
): string {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TRACE_STRING_LENGTH);
}

function sanitizeTraceStringArray(
  value: unknown
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, MAX_TRACE_ARRAY_ITEMS)
    .map(sanitizeTraceString)
    .filter(Boolean);
}

function sanitizeTraceNumber(
  value: unknown
): number | undefined {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value)
  ) {
    return undefined;
  }

  return value;
}

function sanitizeTraceTool(
  value: unknown
): AgentTraceData['action']['tool'] {
  if (
    value === 'grep_document' ||
    value === 'read_document' ||
    value === 'save_result'
  ) {
    return value;
  }

  return null;
}

function agentTraceFromMessage(
  message: AssistantMessage
): AgentTraceData | null {
  const textBlocks =
    message.content
      .filter(
        (block) =>
          block.type === 'text'
      )
      .map((block) =>
        'text' in block
          ? String(block.text)
          : ''
      )
      .join('\n');

  if (!textBlocks.trim()) {
    return null;
  }

  const match =
    textBlocks.match(
      /\[AGENT_TRACE\]([\s\S]*?)\[\/AGENT_TRACE\]/
    );

  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      match[1].trim()
    ) as Record<string, unknown>;

    const action =
      typeof parsed.action === 'object' &&
      parsed.action !== null
        ? (parsed.action as Record<string, unknown>)
        : {};

    const sanitized: AgentTraceData = {
      objective: sanitizeTraceString(
        parsed.objective
      ),

      evidence: sanitizeTraceStringArray(
        parsed.evidence
      ),

      missing: sanitizeTraceStringArray(
        parsed.missing
      ),

      action: {
        tool: sanitizeTraceTool(
          action.tool
        ),
      },

      reason: sanitizeTraceString(
        parsed.reason
      ),

      uncertainty: sanitizeTraceString(
        parsed.uncertainty
      ),

      next: sanitizeTraceString(
        parsed.next
      ),
    };

    const query = sanitizeTraceString(
      action.query
    );

    if (query) {
      sanitized.action.query = query;
    }

    const offset = sanitizeTraceNumber(
      action.offset
    );

    if (offset !== undefined) {
      sanitized.action.offset = offset;
    }

    const limit = sanitizeTraceNumber(
      action.limit
    );

    if (limit !== undefined) {
      sanitized.action.limit = limit;
    }

    return sanitized;
  } catch {
    return null;
  }
}

function buildSafeToolStartedData(
  toolCall: ToolCall
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    tool: toolCall.name,
  };

  const args =
    toolCall.arguments as
      | Record<string, unknown>
      | undefined;

  if (
    toolCall.name === 'grep_document'
  ) {
    if (
      typeof args?.query === 'string'
    ) {
      data.query = args.query;
    }

    if (
      args?.maxMatches !== undefined
    ) {
      data.maxMatches =
        args.maxMatches;
    }
  }

  if (
    toolCall.name === 'read_document'
  ) {
    if (
      args?.offset !== undefined
    ) {
      data.offset = args.offset;
    }

    if (
      args?.limit !== undefined
    ) {
      data.limit = args.limit;
    }
  }

  if (
    toolCall.name === 'save_result'
  ) {
    data.fields = [
      'Reporting Period',
      'Aircraft Serial Number',
      'Aircraft Type',
      'Total Month Cycles',
      'Total Month Hours',
      'Total New Cycles',
      'Total New Time',
      'Component List',
    ];
  }

  return data;
}

export async function POST(
  request: Request
) {
  let workspaceId: string;

  try {
    const body =
      await request.json();

    workspaceId =
      assertWorkspaceId(
        body.workspaceId
      );
  } catch {
    return Response.json(
      {
        error:
          'Valid workspaceId is required.',
      },
      {
        status: 400,
      }
    );
  }

  const encoder =
    new TextEncoder();

  const responseStream =
    new ReadableStream({
      async start(controller) {
        let session:
          | WorkspaceSession
          | null = null;

        function send(
          event: TraceEvent
        ) {
          controller.enqueue(
            encoder.encode(
              `${JSON.stringify(
                event
              )}\n`
            )
          );
        }

        let parentEventId: string | null = null;

        async function trace(
          type: TraceEventType,

          data:
            Record<
              string,
              unknown
            >
        ) {
          if (!session) {
            return;
          }

          const eventId =
            randomUUID().slice(0, 8);

          const timestamp =
            new Date().toISOString();

          let event:
            TraceEvent;

          if (type === 'message') {
            const {
              role,
              content,
              timestamp: messageTimestamp,
              api,
              provider,
              model,
              usage,
              stopReason,
              rawStopReason,
              responseId,
              providerThinkingLevel,
              ...messageDetails
            } = data;

            event = {
              type,
              id: eventId,
              parentId: parentEventId,
              timestamp,
              message: {
                role,
                content,
                ...messageDetails,
                timestamp:
                  messageTimestamp ??
                  Date.now(),
              },
            };

            if (api !== undefined) {
              event.api = api;
            }

            if (provider !== undefined) {
              event.provider = provider;
            }

            if (model !== undefined) {
              event.model = model;
            }

            if (usage !== undefined) {
              event.usage = usage;
            }

            if (stopReason !== undefined) {
              event.stopReason = stopReason;
            }

            if (rawStopReason !== undefined) {
              event.rawStopReason = rawStopReason;
            }

            if (responseId !== undefined) {
              event.responseId = responseId;
            }

            if (providerThinkingLevel !== undefined) {
              event.providerThinkingLevel =
                providerThinkingLevel;
            }
          } else if (type === 'session') {
            event = {
              type,
              id: String(
                data.id ??
                  session.sessionId
              ),
              parentId: null,
              timestamp,
              version:
                data.version ?? 3,
              cwd:
                resolveWorkspacePath(
                  session.workspaceId
                ),
            };
          } else {
            event = {
              type,
              id: eventId,
              parentId:
                type ===
                  'model_change'
                  ? null
                  : parentEventId,
              timestamp,
              ...data,
            };
          }

          const tracePath =
            resolveWorkspacePath(
              session.workspaceId,
              'traces',
              `${session.sessionId}.jsonl`
            );

          await fs.appendFile(
            tracePath,
            `${JSON.stringify(
              event
            )}\n`,
            'utf-8'
          );

          parentEventId =
            event.id;

          send(event);
        }

        try {
          session =
            await readSession(
              workspaceId
            );

          await trace(
            'session',
            {
              version: 3,

              id:
                session.sessionId,
            }
          );

          session.status =
            'running';

          session =
            await writeSession(
              session
            );

          await trace(
            'session.started',
            {
              workspaceId:
                session.workspaceId,

              sessionId:
                session.sessionId,

              originalFilename:
                session.originalFilename,
            }
          );

          const model =
           models.getModel(
            'openrouter',
            'openai/o4-mini-high'
          );

          if (!model) {
            throw new Error(
              'OpenRouter model was not found.'
            );
          }

          await trace(
            'model_change',
            {
              provider:
                'openrouter',

              modelId:
                model.id,
            }
          );

          await trace(
            'thinking_level_change',
            {
              thinkingLevel:
                THINKING_LEVEL,
            }
          );

          let context: Context = {
            ...session.context,
            tools: documentTools,
          };

          let toolCallCount = 0;

          let savedResult:
            unknown = null;

          while (
            toolCallCount <
            MAX_TOOL_CALLS
          ) {
            context.tools =
              documentTools;

            await trace(
              'model.started',
              {
                model:
                  model.id,

                provider:
                  model.provider,

                messages:
                  context.messages.length,

                availableTools:
                  context.tools.map(
                    (tool) =>
                      tool.name
                  ),
              }
            );

            const stream =
              models.stream(
                model,
                context,
                {
                  sessionId:
                    session.sessionId,

                  reasoningEffort:
                    'high',
                }
              );

            let finalMessage:
              | AssistantMessage
              | null = null;

            for await (
              const event
              of stream
            ) {
              if (
                event.type ===
                'done'
              ) {
                finalMessage =
                  event.message;
              }

              if (
                event.type ===
                'error'
              ) {
                finalMessage =
                  event.error;
              }
            }

            finalMessage ??=
              await stream.result();

            await trace(
              'message',
              {
                role:
                  finalMessage.role,

                content:
                  sanitizeAssistantContent(
                    finalMessage.content
                  ),

                api:
                  finalMessage.api,

                provider:
                  finalMessage.provider,

                model:
                  finalMessage.model,

                usage:
                  finalMessage.usage,

                stopReason:
                  finalMessage.stopReason,

                rawStopReason:
                  finalMessage.rawStopReason,

                responseId:
                  finalMessage.responseId,

                providerThinkingLevel:
                  finalMessage.providerThinkingLevel,
              }
            );

            const agentTrace =
              agentTraceFromMessage(
                finalMessage
              );

            if (agentTrace) {
              await trace(
                'agent.trace',
                agentTrace
              );
            }

            context.messages.push(
              finalMessage
            );

            session.context =
              serializableContext(
                context
              );

            session =
              await writeSession(
                session
              );

            if (
              finalMessage.stopReason ===
                'error' ||
              finalMessage.stopReason ===
                'aborted'
            ) {
              throw new Error(
                finalMessage.errorMessage ||
                  'Pi model request failed.'
              );
            }

            const toolCalls =
              toolCallsFromMessage(
                finalMessage
              );

            if (
              toolCalls.length ===
              0
            ) {
              throw new Error(
                'The model did not call a document tool.'
              );
            }

            for (
              const toolCall
              of toolCalls
            ) {
              toolCallCount++;

              if (
                toolCallCount >
                MAX_TOOL_CALLS
              ) {
                throw new Error(
                  'Tool-call limit exceeded.'
                );
              }

              await trace(
                'tool.started',
                buildSafeToolStartedData(
                  toolCall
                )
              );

              try {
                const execution =
                  await executeWorkspaceTool(
                    session.workspaceId,
                    toolCall
                  );

                await trace(
                  'message',
                  {
                    role:
                      'toolResult',

                    toolCallId:
                      toolCall.id,

                    toolName:
                      toolCall.name,

                    details:
                      execution.summary,

                    isError:
                      false,
                  }
                );

                context.messages.push(
                  {
                    role:
                      'toolResult',

                    toolCallId:
                      toolCall.id,

                    toolName:
                      toolCall.name,

                    content: [
                      {
                        type:
                          'text',

                        text:
                          JSON.stringify(
                            execution.result
                          ),
                      },
                    ],

                    isError:
                      false,

                    timestamp:
                      Date.now(),
                  }
                );

                session.context =
                  serializableContext(
                    context
                  );

                session =
                  await writeSession(
                    session
                  );

                await trace(
                  'tool.completed',
                  {
                    tool:
                      toolCall.name,

                    ...execution.summary,
                  }
                );

                if (
                  execution.terminal
                ) {
                  const resultPath =
                    resolveWorkspacePath(
                      session.workspaceId,
                      'results',
                      'result.json'
                    );

                  const resultText =
                    await fs.readFile(
                      resultPath,
                      'utf-8'
                    );

                  savedResult =
                    JSON.parse(
                      resultText
                    );

                  await trace(
                    'result.saved',
                    {
                      result:
                        savedResult,
                    }
                  );

                  session.status =
                    'completed';

                  session =
                    await writeSession(
                      session
                    );

                  await trace(
                    'session.completed',
                    {
                      toolCalls:
                        toolCallCount,

                      stopReason:
                        finalMessage.stopReason,

                      usage:
                        finalMessage.usage,
                    }
                  );

                  controller.close();

                  return;
                }
              } catch (error) {
                const message =
                  error
                    instanceof Error
                    ? error.message
                    : 'Tool execution failed.';

                await trace(
                  'message',
                  {
                    role:
                      'toolResult',

                    toolCallId:
                      toolCall.id,

                    toolName:
                      toolCall.name,

                    isError:
                      true,

                    error:
                      message,
                  }
                );

                context.messages.push(
                  {
                    role:
                      'toolResult',

                    toolCallId:
                      toolCall.id,

                    toolName:
                      toolCall.name,

                    content: [
                      {
                        type:
                          'text',

                        text:
                          message,
                      },
                    ],

                    isError:
                      true,

                    timestamp:
                      Date.now(),
                  }
                );

                session.context =
                  serializableContext(
                    context
                  );

                session =
                  await writeSession(
                    session
                  );

                await trace(
                  'tool.completed',
                  {
                    tool:
                      toolCall.name,

                    error:
                      message,
                  }
                );
              }
            }
          }

          if (!savedResult) {
            throw new Error(
              'Extraction finished without saving a result.'
            );
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown extraction error';

          if (session) {
            session.status =
              'failed';

            session =
              await writeSession(
                session
              );

            await trace(
              'session.failed',
              {
                error:
                  message,
              }
            );
          }

          controller.close();
        }
      },
    });

  return new Response(
    responseStream,
    {
      headers: {
        'Content-Type':
          'application/x-ndjson; charset=utf-8',

        'Cache-Control':
          'no-cache',

        Connection:
          'keep-alive',
      },
    }
  );
}