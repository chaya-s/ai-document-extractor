export function isSessionReplayEnabled() {
  return process.env.NEXT_PUBLIC_SESSION_REPLAY === 'true';
}
