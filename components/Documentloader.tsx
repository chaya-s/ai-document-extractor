'use client';

import { useState } from 'react';

// This matches the structured JSON returned by the backend
type ExtractedField = {
  name: string;
  value: string;
  confidence: number;
};

type AircraftData = {
  fields: ExtractedField[];
};

export default function Documentloader() {
  const [file, setFile] = useState<File | null>(null);
  const [documentText, setDocumentText] = useState('');

  const [aircraftData, setAircraftData] =
    useState<AircraftData | null>(null);

  const [uploading, setUploading] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState('');

  // Upload and read PDF/DOCX
  async function handleFile(selectedFile: File | undefined) {
    if (!selectedFile) return;

    setFile(selectedFile);
    setDocumentText('');
    setAircraftData(null);
    setError('');
    setUploading(true);

    try {
      const formData = new FormData();

      formData.append('file', selectedFile);

      const response = await fetch('/api/read-document', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || 'Unable to read document.'
        );
      }

      setDocumentText(data.text);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
      );
    } finally {
      setUploading(false);
    }
  }

  // Send extracted document text to Pi-AI
  async function extractAircraftData() {
    if (!documentText) {
      setError('Please upload a document first.');
      return;
    }

    setExtracting(true);
    setAircraftData(null);
    setError('');

    try {
      const response = await fetch('/api/ask-document', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          documentText,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data.error || 'Unable to extract information.'
        );
      }

      setAircraftData(data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong.'
      );
    } finally {
      setExtracting(false);
    }
  }

  return (
    <div className="w-full max-w-4xl">

      {/* Upload area */}
      <label
        className="
          flex min-h-64 cursor-pointer
          flex-col items-center justify-center
          rounded-3xl
          border-2 border-dashed border-[#c7d2fe]
          bg-[#f5f7ff]
          p-10
          text-center
          transition-all
          duration-300
          hover:border-[#a5b4fc]
          hover:bg-[#eef2ff]
        "
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();

          handleFile(
            e.dataTransfer.files[0]
          );
        }}
      >
        <input
          type="file"
          className="hidden"
          accept=".pdf,.docx"
          onChange={(e) =>
            handleFile(
              e.target.files?.[0]
            )
          }
        />

        <h2 className="text-xl font-semibold text-[#4b5563]">
          Drop your document here
        </h2>

        <p className="mt-2 text-[#9ca3af]">
          PDF or DOCX files
        </p>

        <p className="mt-5 rounded-full bg-[#e0e7ff] px-6 py-2 text-sm font-medium text-[#6366f1]">
          Browse files
        </p>
      </label>

      {/* Reading status */}
      {uploading && (
        <p className="mt-5 text-center text-gray-500">
          Reading document...
        </p>
      )}

      {/* Document ready */}
      {file && documentText && (
        <div className="mt-5 rounded-xl bg-green-50 p-4">
          <p className="font-medium text-green-700">
            Document ready
          </p>

          <p className="mt-1 text-sm text-green-600">
            {file.name}
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mt-5 rounded-xl bg-red-50 p-4 text-red-600">
          {error}
        </div>
      )}

      {/* Extraction area */}
      {documentText && (
        <div className="mt-8 rounded-2xl bg-white p-6 shadow-sm">

          <h2 className="text-xl font-semibold text-gray-700">
            Extract Aircraft Data
          </h2>

          <p className="mt-1 text-sm text-gray-400">
            Extract structured aircraft details from the document
          </p>

          <button
            onClick={extractAircraftData}
            disabled={extracting}
            className="
              mt-4
              rounded-xl
              bg-[#e0e7ff]
              px-6
              py-3
              font-medium
              text-[#6366f1]
              transition
              hover:bg-[#c7d2fe]
              disabled:opacity-50
            "
          >
            {extracting
              ? 'Extracting...'
              : 'Extract Details'}
          </button>

          {/* Structured output UI */}
          {aircraftData?.fields && (
            <div className="mt-6">

              <h3 className="mb-4 text-lg font-semibold text-gray-700">
                Extracted Aircraft Details
              </h3>

              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">

                <table className="w-full text-left">

                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-5 py-3 text-sm font-semibold text-gray-600">
                        Field
                      </th>

                      <th className="px-5 py-3 text-sm font-semibold text-gray-600">
                        Value
                      </th>

                      <th className="px-5 py-3 text-sm font-semibold text-gray-600">
                        Confidence
                      </th>
                    </tr>
                  </thead>

                  <tbody>
                    {aircraftData.fields.map(
                      (field, index) => (
                        <tr
                          key={`${field.name}-${index}`}
                          className="border-t border-gray-100"
                        >
                          <td className="px-5 py-4 font-medium text-gray-700">
                            {field.name}
                          </td>

                          <td className="px-5 py-4 text-gray-900">
                            {field.value || 'Not found'}
                          </td>

                          <td className="px-5 py-4">
                            <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-700">
                              {field.confidence}%
                            </span>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>

                </table>

              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}