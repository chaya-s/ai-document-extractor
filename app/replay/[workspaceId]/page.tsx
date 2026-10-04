import { redirect } from 'next/navigation';

type ReplayPageProps = {
  params: Promise<{
    workspaceId: string;
  }>;
};

export default async function ReplayPage({
  params,
}: ReplayPageProps) {
  const { workspaceId } = await params;

  redirect(`/replays/${workspaceId}`);
}
