import { FileText, Image as ImageIcon, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { formatBytes } from "../lib/uploadPolicy";

GlobalWorkerOptions.workerSrc = pdfWorker;

export function PdfImageUploader({
  onFile,
  acceptedMime,
  maxBytes
}: {
  onFile: (file: File | null) => void;
  acceptedMime: string[];
  maxBytes: number;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  async function handleFile(nextFile: File | null) {
    setError(null);
    setPreview(null);
    setFile(nextFile);
    onFile(nextFile);
    if (!nextFile) return;
    if (!acceptedMime.includes(nextFile.type)) {
      setError(`Use one of: ${acceptedMime.join(", ")}.`);
      setFile(null);
      onFile(null);
      return;
    }
    if (nextFile.size > maxBytes) {
      setError(`File exceeds max size of ${formatBytes(maxBytes)}.`);
      setFile(null);
      onFile(null);
      return;
    }
    if (nextFile.type.startsWith("image/")) {
      setPreview(URL.createObjectURL(nextFile));
      return;
    }
    if (nextFile.type === "application/pdf") {
      try {
        const pdf = await getDocument({ data: await nextFile.arrayBuffer() }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas unavailable");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        setPreview(canvas.toDataURL("image/png"));
      } catch {
        setError("PDF preview could not be rendered, but the original file can still be submitted.");
      }
      return;
    }
  }

  return (
    <section className="upload-panel">
      <label className="drop-zone">
        <input
          type="file"
          accept={acceptedMime.join(",")}
          onChange={(event) => handleFile(event.currentTarget.files?.[0] ?? null)}
        />
        <span><FileText size={22} /></span>
        <strong>Upload written work</strong>
        <small>{acceptedMime.join(", ")} up to {formatBytes(maxBytes)}. The original file is preserved for grading.</small>
      </label>
      {error && <p className="field-error">{error}</p>}
      {file && (
        <article className="file-preview">
          <div className="preview-media">
            {preview ? <img src={preview} alt="Uploaded work preview" /> : <ImageIcon size={34} />}
          </div>
          <div>
            <strong>{file.name}</strong>
            <p>{file.type || "application/octet-stream"} · {formatBytes(file.size)}</p>
          </div>
          <button className="icon-button" type="button" aria-label="Remove upload" onClick={() => handleFile(null)}>
            <Trash2 size={18} />
          </button>
        </article>
      )}
    </section>
  );
}
