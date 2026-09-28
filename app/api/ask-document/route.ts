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

import {
  documentTools,
  executeWorkspaceTool,
  saveResultTool,
} from '@/lib/document-tools';

import {
  assertWorkspaceId,
  readSession,
  resolveWorkspacePath,
  writeSession,
  type WorkspaceSession,
} from '@/lib/pi-workspace';

export const runtime =
  'nodejs';

const models =
  createModels();

models.setProvider(
  openrouterProvider()
);

const MAX_TOOL_CALLS =
  12;

const FORCE_SAVE_AFTER =
  5;

type TraceEvent = {
  timestamp: string;

  type:
    | 'session.started'
    | 'model.started'
    | 'tool.started'
    | 'tool.completed'
    | 'result.saved'
    | 'session.completed'
    | 'session.failed';

  data:
    Record<
      string,
      unknown
    >;
};

function serializableContext(
  context: Context
): Context {
  return {
    systemPrompt:
      context.systemPrompt,

    messages:
      context.messages,
  };
}

function toolCallsFromMessage(
  message:
    AssistantMessage
): ToolCall[] {
  return message.content.filter(
    (
      block
    ): block is ToolCall =>
      block.type ===
      'toolCall'
  );
}

function buildSafeToolStartedData(
  toolCall: ToolCall
): Record<
  string,
  unknown
> {
  const data:
    Record<
      string,
      unknown
    > = {
    tool:
      toolCall.name,
  };

  const args =
    toolCall.arguments as
      | Record<
          string,
          unknown
        >
      | undefined;

  if (
    toolCall.name ===
    'grep_document'
  ) {
    if (
      typeof args?.query ===
      'string'
    ) {
      data.query =
        args.query;
    }

    if (
      args?.maxMatches !==
      undefined
    ) {
      data.maxMatches =
        args.maxMatches;
    }
  }

  if (
    toolCall.name ===
    'read_document'
  ) {
    if (
      args?.offset !==
      undefined
    ) {
      data.offset =
        args.offset;
    }

    if (
      args?.limit !==
      undefined
    ) {
      data.limit =
        args.limit;
    }
  }

  if (
    toolCall.name ===
    'save_result'
  ) {
    data.fields = [
      'Total Month Cycles',
      'Total Month Hours',
      'Total New Cycles',
      'Total New Time',
      'Aircraft Type',
    ];
  }

  return data;
}

export async function POST(
  request: Request
) {
  let workspaceId:
    string;

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
      async start(
        controller
      ) {
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

        async function trace(
          type:
            TraceEvent['type'],

          data:
            Record<
              string,
              unknown
            >
        ) {
          if (!session) {
            return;
          }

          const event:
            TraceEvent = {
            timestamp:
              new Date().toISOString(),

            type,

            data,
          };

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

          send(event);
        }

        try {
          // -----------------------------
          // Load session
          // -----------------------------

          session =
            await readSession(
              workspaceId
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
            }
          );

          // -----------------------------
          // Select model
          // -----------------------------

          const model =
            models.getModel(
              'openrouter',
              'openai/gpt-4o-mini'
            );

          if (!model) {
            throw new Error(
              'OpenRouter model was not found.'
            );
          }

          let context:
            Context = {
            ...session.context,

            tools:
              documentTools,
          };

          let toolCallCount =
            0;

          let nonTerminalToolCount =
            0;

          let savedResult:
            unknown = null;

          // -----------------------------
          // Pi tool loop
          // -----------------------------

          while (
            toolCallCount <
            MAX_TOOL_CALLS
          ) {
            // After enough read/grep operations,
            // only expose save_result.
            if (
              nonTerminalToolCount >=
              FORCE_SAVE_AFTER
            ) {
              context.tools = [
                saveResultTool,
              ];
            } else {
              context.tools =
                documentTools;
            }

            await trace(
              'model.started',
              {
                model:
                  model.id,
              }
            );

            const stream =
              models.stream(
                model,
                context,
                {
                  sessionId:
                    session.sessionId,
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

            // Store assistant response
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

            // -----------------------------
            // Execute tools
            // -----------------------------

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

                // Feed tool result back to Pi
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
                  !execution.terminal
                ) {
                  nonTerminalToolCount++;
                }

                // -----------------------------
                // save_result completed
                // -----------------------------

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
                      workspaceId:
                        session.workspaceId,

                      result:
                        savedResult,

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
              } catch (
                error
              ) {
                const message =
                  error
                    instanceof Error
                    ? error.message
                    : 'Tool execution failed.';

                // Send failure back into Pi
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
            error
              instanceof Error
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