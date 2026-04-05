"use client";

import { useEffect, useState } from "react";

export default function APIDocsPage() {
  const [spec, setSpec] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch("/api/docs")
      .then((r) => r.json())
      .then(setSpec)
      .catch(() => {});
  }, []);

  if (!spec) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Indlæser API-dokumentation...</p>
      </div>
    );
  }

  const info = spec.info as { title: string; version: string; description: string };
  const paths = spec.paths as Record<string, Record<string, unknown>>;

  const methodColors: Record<string, string> = {
    get: "bg-blue-500",
    post: "bg-green-500",
    patch: "bg-orange-500",
    delete: "bg-red-500",
    put: "bg-purple-500",
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">{info.title}</h1>
          <p className="text-gray-600 mt-1">Version {info.version}</p>
          <p className="text-gray-600 mt-2 text-sm">{info.description}</p>
          <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm">
            <p className="font-medium text-blue-800">Autentificering</p>
            <p className="text-blue-700 mt-1">
              Alle endpoints kræver en <code className="bg-blue-100 px-1 rounded">Authorization: Bearer &lt;api_key&gt;</code> header.
            </p>
            <p className="text-blue-700 mt-1">
              API-nøglen konfigureres under Indstillinger &rarr; System &rarr; API-nøgle.
            </p>
          </div>
          <div className="mt-3 p-3 bg-gray-100 rounded-lg text-sm text-gray-600">
            <p>OpenAPI spec: <code className="bg-white px-1 rounded">/api/docs</code></p>
          </div>
        </div>

        {/* Endpoints */}
        <div className="space-y-4">
          {Object.entries(paths).map(([path, methods]) =>
            Object.entries(methods as Record<string, Record<string, unknown>>).map(([method, endpoint]) => {
              const ep = endpoint as {
                summary?: string;
                description?: string;
                tags?: string[];
                parameters?: Array<{ name: string; in: string; description?: string; schema?: { type: string; enum?: string[] } }>;
                requestBody?: { content?: { "application/json"?: { schema?: Record<string, unknown>; example?: unknown; examples?: Record<string, { value: unknown }> } } };
                responses?: Record<string, { description?: string; content?: Record<string, unknown> }>;
              };

              return (
                <div key={`${method}-${path}`} className="border bg-white rounded-xl shadow-sm overflow-hidden">
                  <div className="px-5 py-4 flex items-center gap-3">
                    <span className={`${methodColors[method] || "bg-gray-500"} text-white text-xs font-bold uppercase px-2.5 py-1 rounded`}>
                      {method}
                    </span>
                    <code className="text-sm font-mono text-gray-800">/api/v1{path}</code>
                    <span className="text-sm text-gray-500 ml-auto">{ep.summary}</span>
                  </div>
                  {(ep.description || ep.parameters || ep.requestBody) && (
                    <div className="px-5 pb-4 pt-0 space-y-3 border-t border-gray-100">
                      {ep.description && (
                        <p className="text-sm text-gray-600 pt-3">{ep.description}</p>
                      )}
                      {ep.parameters && ep.parameters.length > 0 && (
                        <div className="pt-2">
                          <p className="text-xs font-medium text-gray-500 uppercase mb-2">Query parametre</p>
                          <table className="w-full text-sm">
                            <tbody>
                              {ep.parameters.map((p) => (
                                <tr key={p.name} className="border-t border-gray-50">
                                  <td className="py-1.5 pr-3 font-mono text-xs text-gray-800">{p.name}</td>
                                  <td className="py-1.5 pr-3 text-xs text-gray-500">{p.schema?.type}{p.schema?.enum ? ` (${p.schema.enum.join(", ")})` : ""}</td>
                                  <td className="py-1.5 text-xs text-gray-500">{p.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {ep.requestBody?.content?.["application/json"] && (
                        <div className="pt-2">
                          <p className="text-xs font-medium text-gray-500 uppercase mb-2">Request body</p>
                          <RequestBodyExamples data={ep.requestBody.content["application/json"]} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function RequestBodyExamples({ data }: { data: { example?: unknown; examples?: Record<string, { value: unknown }> } }) {
  if (data.example) {
    return (
      <pre className="bg-gray-50 p-3 rounded-lg text-xs overflow-x-auto">
        {JSON.stringify(data.example, null, 2)}
      </pre>
    );
  }
  if (data.examples) {
    return (
      <div className="space-y-2">
        {Object.entries(data.examples).map(([name, ex]) => (
          <div key={name}>
            <p className="text-xs text-gray-500 mb-1">{name}:</p>
            <pre className="bg-gray-50 p-3 rounded-lg text-xs overflow-x-auto">
              {JSON.stringify(ex.value, null, 2)}
            </pre>
          </div>
        ))}
      </div>
    );
  }
  return null;
}
