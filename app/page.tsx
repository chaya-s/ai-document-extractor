import Documentloader from '@/components/Documentloader';

export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center p-10">
      <h1 className="mb-2 text-3xl font-bold">
        Document Reader
      </h1>

      <p className="mb-8 text-gray-500">
        Upload a PDF or Word document
      </p>

      <Documentloader />
    </main>
  );
}