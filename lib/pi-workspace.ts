import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Context } from '@earendil-works/pi-ai';

export type SessionStatus =
  | 'ready'
  | 'running'
  | 'completed'
  | 'failed';

export type WorkspaceSession = {
  workspaceId: string;
  sessionId: string;
  originalFilename: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  context: Context;
};

const WORKSPACE_ID_PATTERN =
  /^workspace-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function workspaceRoot() {
  return path.resolve(process.cwd(), 'workspace');
}

export function assertWorkspaceId(
  workspaceId: unknown
): string {
  if (
    typeof workspaceId !== 'string' ||
    !WORKSPACE_ID_PATTERN.test(workspaceId)
  ) {
    throw new Error('Invalid workspace ID.');
  }

  return workspaceId;
}

export function resolveWorkspacePath(
  workspaceId: string,
  ...segments: string[]
) {
  const safeWorkspaceId =
    assertWorkspaceId(workspaceId);

  const root = workspaceRoot();
  const workspacePath = path.resolve(
    root,
    safeWorkspaceId,
    ...segments
  );

  const allowedRoot = path.resolve(
    root,
    safeWorkspaceId
  );

  if (
    workspacePath !== allowedRoot &&
    !workspacePath.startsWith(
      `${allowedRoot}${path.sep}`
    )
  ) {
    throw new Error('Workspace path escaped root.');
  }

  return workspacePath;
}

export async function createWorkspace(
  originalFilename: string,
  extension: string
) {
  const id = randomUUID();
  const workspaceId = `workspace-${id}`;
  const sessionId = id;

  const workspaceDir = resolveWorkspacePath(
    workspaceId
  );

  const uploadsDir = resolveWorkspacePath(
    workspaceId,
    'uploads'
  );
  const resultsDir = resolveWorkspacePath(
    workspaceId,
    'results'
  );
  const tracesDir = resolveWorkspacePath(
    workspaceId,
    'traces'
  );

  await fs.mkdir(uploadsDir, { recursive: true });
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.mkdir(tracesDir, { recursive: true });

  const originalPath = resolveWorkspacePath(
    workspaceId,
    'uploads',
    `original${extension}`
  );
  const documentPath = resolveWorkspacePath(
    workspaceId,
    'uploads',
    'document.md'
  );

  return {
    workspaceId,
    sessionId,
    workspaceDir,
    uploadsDir,
    resultsDir,
    tracesDir,
    originalPath,
    documentPath,
  };
}

export async function readSession(
  workspaceId: string
): Promise<WorkspaceSession> {
  const sessionPath = resolveWorkspacePath(
    workspaceId,
    'session.json'
  );

  const raw = await fs.readFile(
    sessionPath,
    'utf-8'
  );

  return JSON.parse(raw) as WorkspaceSession;
}

export async function writeSession(
  session: WorkspaceSession
) {
  const sessionPath = resolveWorkspacePath(
    session.workspaceId,
    'session.json'
  );

  const updatedSession = {
    ...session,
    updatedAt: new Date().toISOString(),
  };

  await fs.writeFile(
    sessionPath,
    JSON.stringify(updatedSession, null, 2),
    'utf-8'
  );

  return updatedSession;
}
