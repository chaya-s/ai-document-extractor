import Link from 'next/link';

import Documentloader from '@/components/Documentloader';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-10">
      <h1 className="mb-2 text-3xl font-bold">
        Document Reader
      </h1>

      <p className="mb-4 text-gray-500">
        Upload a PDF or Word document
      </p>

      <Link
        href="/replays"
        className="mb-8 rounded-xl bg-[#e0e7ff] px-6 py-3 text-sm font-medium text-[#6366f1] transition hover:bg-[#c7d2fe]"
      >
        View Replays
      </Link>

      <Documentloader />
    </main>
  );
}